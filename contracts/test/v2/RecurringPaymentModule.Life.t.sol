// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RecurringPaymentModuleTestBase} from "./RecurringPaymentModule.Base.t.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {IRecurringPaymentModule} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice M-SCHED-07: pause (approver / guardian), quorum-only resume with and without skipMissed, terminal cancel.
contract RecurringPaymentModuleLifeTest is RecurringPaymentModuleTestBase {
    IRecurringPaymentModule.ScheduleStatus internal constant PAUSED = IRecurringPaymentModule.ScheduleStatus.Paused;
    IRecurringPaymentModule.ScheduleStatus internal constant ACTIVE = IRecurringPaymentModule.ScheduleStatus.Active;
    IRecurringPaymentModule.ScheduleStatus internal constant CANCELLED = IRecurringPaymentModule.ScheduleStatus.Cancelled;

    // ------------------------------------------------------------ helpers
    function _daily(uint64 start) internal returns (uint256) {
        return _create(_p(payee1, AMOUNT, DAILY, start));
    }

    function _pauseBy(uint256 sid, address by) internal {
        vm.prank(by);
        rpm.pause(sid);
    }

    /// @dev Proposes a resume now and drives it to execution; returns the execution timestamp.
    function _resumeAndExpect(uint256 sid, bool skip, uint256 expectedSkipDelta) internal returns (uint64 execAt) {
        uint256 pid = _proposeResume(sid, skip);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        execAt = _now();
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRecurringPaymentModule.ScheduleResumed(sid, expectedSkipDelta);
        _exec(pid);
    }

    // ------------------------------------------------------------ pause
    function test_Sched07_PauseByEachApproverAndByGuardian() public {
        address[4] memory who = [approver1, approver2, approver3, guardian];
        for (uint256 i; i < who.length; ++i) {
            uint256 sid = _daily(_now() + 5 days);
            IRecurringPaymentModule.Schedule memory before = _s(sid);
            vm.expectEmit(true, true, false, false, address(rpm));
            emit IRecurringPaymentModule.SchedulePaused(sid, who[i]);
            _pauseBy(sid, who[i]);
            IRecurringPaymentModule.Schedule memory a = _s(sid);
            assertEq(uint8(a.status), uint8(PAUSED));
            assertEq(a.nextDue, before.nextDue, "pause changes nothing but status");
            assertEq(a.executedCount, before.executedCount);
            assertEq(a.totalPaid, before.totalPaid);
        }
    }

    function test_Sched07_PauseRejectsOutsidersProposersExecutorAndRecipient() public {
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _now() + 5 days);
        p.executor = keeper;
        uint256 sid = _create(p);
        address[4] memory denied = [outsider, proposerOnly, keeper, payee1];
        for (uint256 i; i < denied.length; ++i) {
            vm.prank(denied[i]);
            vm.expectRevert(IRecurringPaymentModule.Unauthorized.selector);
            rpm.pause(sid);
        }
        assertEq(uint8(_st(sid)), uint8(ACTIVE));
    }

    function test_Sched07_PauseOnlyFromActive() public {
        uint256 sid = _daily(_now() + 5 days);
        _pauseBy(sid, approver1);
        vm.prank(approver2);
        vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.InvalidStatus.selector, sid, PAUSED));
        rpm.pause(sid);
        vm.prank(approver1);
        rpm.cancel(sid);
        vm.prank(approver2);
        vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.InvalidStatus.selector, sid, CANCELLED));
        rpm.pause(sid);
    }

    function test_Sched07_ZeroGuardianHasNoAuthority() public {
        uint256 sid = _daily(_now() + 30 days);
        _govPass(_govConfig(_arr(approver1, approver2, approver3), address(0)));
        assertEq(t.guardian(), address(0));
        // the former guardian address is no longer privileged
        vm.prank(guardian);
        vm.expectRevert(IRecurringPaymentModule.Unauthorized.selector);
        rpm.pause(sid);
        vm.prank(guardian);
        vm.expectRevert(IRecurringPaymentModule.Unauthorized.selector);
        rpm.cancel(sid);
        // and address(0) itself is not "the guardian" just because the guardian slot is empty
        vm.prank(address(0));
        vm.expectRevert(IRecurringPaymentModule.Unauthorized.selector);
        rpm.pause(sid);
        vm.prank(address(0));
        vm.expectRevert(IRecurringPaymentModule.Unauthorized.selector);
        rpm.cancel(sid);
        assertEq(uint8(_st(sid)), uint8(ACTIVE));
        _pauseBy(sid, approver2); // approvers keep the power
        assertEq(uint8(_st(sid)), uint8(PAUSED));
    }

    function test_Sched07_StoppingAuthorityTracksCurrentGovernance() public {
        uint256 sid = _daily(_now() + 30 days);
        address approver4 = makeAddr("approver4");
        address newGuardian = makeAddr("newGuardian");
        _govPass(_govConfig(_arr(approver1, approver2, approver4), newGuardian));
        address[2] memory gone = [approver3, guardian];
        for (uint256 i; i < gone.length; ++i) {
            vm.prank(gone[i]);
            vm.expectRevert(IRecurringPaymentModule.Unauthorized.selector);
            rpm.pause(sid);
        }
        _pauseBy(sid, newGuardian);
        assertEq(uint8(_st(sid)), uint8(PAUSED));
        vm.prank(approver4);
        rpm.cancel(sid);
        assertEq(uint8(_st(sid)), uint8(CANCELLED));
    }

    function test_Sched07_PausedScheduleCannotExecute() public {
        uint64 start = _execTs() + 1 days;
        uint256 sid = _daily(start);
        _pauseBy(sid, guardian);
        vm.warp(start + 1 hours);
        assertFalse(rpm.isDue(sid));
        vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.InvalidStatus.selector, sid, PAUSED));
        rpm.execute(sid);
        assertEq(usdc.balanceOf(payee1), 0);
        assertEq(rpm.dueSchedules(0, 10).length, 0);
    }

    // ------------------------------------------------------------ resume: quorum only
    function test_Sched07_ResumeOnlyThroughQuorumProposal() public {
        uint64 start = _execTs() + 20 days;
        uint256 sid = _daily(start);
        _pauseBy(sid, approver1);
        // direct calls are rejected, whoever makes them
        address[3] memory callers = [approver1, guardian, outsider];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(IRecurringPaymentModule.OnlyTreasury.selector);
            rpm.onApproved(1, RESUME, abi.encode(sid, false));
        }
        // a proposal with one approval (the proposer) cannot execute
        uint256 pid = _proposeResume(sid, false);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.QuorumNotReached.selector, pid, uint16(1), uint8(2)));
        _exec(pid);
        assertEq(uint8(_st(sid)), uint8(PAUSED));
        // quorum but delay not elapsed
        _approve(pid, approver2);
        AskirawaTreasury.Proposal memory pr = t.getProposal(pid);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.DelayNotElapsed.selector, pr.executableAt));
        _exec(pid);
        assertEq(uint8(_st(sid)), uint8(PAUSED));
        _warpToExecutable(pid);
        _exec(pid);
        assertEq(uint8(_st(sid)), uint8(ACTIVE));
    }

    function test_Sched07_ResumeRequiresPausedStatus() public {
        uint256 active = _daily(_now() + 20 days);
        uint256 pid = _proposeResume(active, false);
        _expectCallbackRevert(pid, abi.encodeWithSelector(IRecurringPaymentModule.InvalidStatus.selector, active, ACTIVE));
        pid = _proposeResume(77, true);
        _expectCallbackRevert(pid, abi.encodeWithSelector(IRecurringPaymentModule.UnknownSchedule.selector, uint256(77)));
        assertEq(uint8(_st(active)), uint8(ACTIVE));
    }

    function test_Sched07_ResumeWithoutSkipKeepsCalendarAndPaysOverdueOnePerCall() public {
        uint64 s = _execTs() + 1 days;
        uint256 sid = _daily(s);
        vm.warp(s);
        _payOnce(sid, outsider);
        _pauseBy(sid, approver1);
        vm.warp(s + 1 days + 2 hours);
        uint64 execAt = _resumeAndExpect(sid, false, 0);
        assertEq(execAt, s + 2 days + 2 hours);
        IRecurringPaymentModule.Schedule memory a = _s(sid);
        assertEq(uint8(a.status), uint8(ACTIVE));
        assertEq(a.nextDue, s + 1 days, "nextDue unchanged");
        assertEq(a.executedCount, 1);
        assertEq(rpm.skippedPeriods(sid), 0);
        assertEq(usdc.balanceOf(payee1), AMOUNT, "resume itself pays nothing");
        // periods 1 and 2 are both overdue and both get paid, one per call
        assertEq(_payOnce(sid, outsider), 1);
        assertEq(_payOnce(sid, outsider), 2);
        assertEq(_s(sid).executedCount, 3);
        assertEq(usdc.balanceOf(payee1), 3 * AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.NotDue.selector, s + 3 days));
        rpm.execute(sid);
    }

    function test_Sched07_ResumeWithSkipJumpsToFirstBoundaryAfterNow_SkippedNotPaid() public {
        uint64 s = _execTs() + 1 days;
        uint256 sid = _daily(s);
        vm.warp(s);
        _payOnce(sid, outsider);
        _pauseBy(sid, approver1);
        vm.warp(s + 1 days + 2 hours);
        uint256 pid = _proposeResume(sid, true);
        _reachQuorum(pid);
        _warpToExecutable(pid); // now = s + 2d + 2h: periods 1 and 2 are missed, period 3 is the first after now
        assertEq(refFirstAfter(s, DAILY, _now(), 50), 3, "oracle");
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRecurringPaymentModule.ScheduleResumed(sid, 2);
        _exec(pid);
        IRecurringPaymentModule.Schedule memory a = _s(sid);
        assertEq(uint8(a.status), uint8(ACTIVE));
        assertEq(a.nextDue, s + 3 days);
        assertEq(a.executedCount, 1, "skipped periods are not executions");
        assertEq(a.totalPaid, AMOUNT);
        assertEq(rpm.skippedPeriods(sid), 2);
        assertEq(usdc.balanceOf(payee1), AMOUNT, "missed periods are not paid");
        vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.NotDue.selector, s + 3 days));
        rpm.execute(sid);
        vm.warp(s + 3 days);
        assertEq(_payOnce(sid, keeper), 3, "periodIndex includes skipped periods");
        assertEq(_s(sid).executedCount, 2);
        assertEq(_s(sid).nextDue, s + 4 days);
        assertEq(usdc.balanceOf(payee1), 2 * AMOUNT, "only periods 0 and 3 were ever paid");
    }

    function test_Sched07_ResumeWithSkip_PeriodDueExactlyAtResumeTimeIsSkipped() public {
        uint64 s = _execTs() + 1 days;
        uint256 sid = _daily(s);
        vm.warp(s);
        _payOnce(sid, outsider);
        _pauseBy(sid, approver1);
        vm.warp(s + 1 days);
        uint64 execAt = _resumeAndExpect(sid, true, 2); // periods 1 and 2 skipped
        assertEq(execAt, s + 2 days, "resume lands exactly on period 2's boundary");
        assertEq(_s(sid).nextDue, s + 3 days, "strictly-after: the boundary period is skipped");
        assertEq(rpm.skippedPeriods(sid), 2);
        assertEq(_s(sid).executedCount, 1);
    }

    function test_Sched07_ResumeWithSkipWhenNothingMissedChangesNothing() public {
        uint64 s = _execTs() + 1 days;
        uint256 sid = _create(_p(payee1, AMOUNT, WEEKLY, s));
        vm.warp(s);
        _payOnce(sid, outsider);
        _pauseBy(sid, approver1);
        _resumeAndExpect(sid, true, 0);
        assertEq(_s(sid).nextDue, s + 7 days, "next period is still in the future");
        assertEq(rpm.skippedPeriods(sid), 0);
        assertEq(uint8(_st(sid)), uint8(ACTIVE));
    }

    function test_Sched07_MonthlyResumeWithSkipUsesCalendarBoundaries() public {
        uint64 s = refTs(2027, 1, 31, 9, 0, 0);
        uint256 sid = _create(_p(payee1, AMOUNT, MONTHLY, s));
        vm.warp(s);
        _payOnce(sid, outsider);
        _pauseBy(sid, guardian);
        vm.warp(refTs(2027, 4, 10, 12, 0, 0)); // resume executes 2027-04-11 12:00
        _resumeAndExpect(sid, true, 2); // periods 1 (Feb 28) and 2 (Mar 31) missed; period 3 = Apr 30 09:00
        assertEq(refFirstAfter(s, MONTHLY, refTs(2027, 4, 11, 12, 0, 0), 20), 3, "oracle");
        assertEq(_s(sid).nextDue, refTs(2027, 4, 30, 9, 0, 0));
        assertEq(rpm.skippedPeriods(sid), 2);
        vm.warp(refTs(2027, 4, 30, 9, 0, 0));
        assertEq(_payOnce(sid, outsider), 3);
        assertEq(_s(sid).nextDue, refTs(2027, 5, 31, 9, 0, 0), "calendar resumes on the 31st");
        assertEq(usdc.balanceOf(payee1), 2 * AMOUNT);
    }

    function test_Sched07_SkippedPeriodsDoNotConsumeMaxExecutionsOrMaxTotal() public {
        uint64 s = _execTs() + 1 days;
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, s);
        p.maxExecutions = 3;
        p.maxTotal = 3 * AMOUNT;
        uint256 sid = _create(p);
        vm.warp(s);
        _payOnce(sid, outsider);
        _pauseBy(sid, approver1);
        vm.warp(s + 5 days);
        _resumeAndExpect(sid, true, 6); // resume at s+6d -> first boundary after is period 7; current 1 -> 6 skipped
        assertEq(rpm.skippedPeriods(sid), 6, "more periods skipped than maxExecutions");
        assertEq(uint8(_st(sid)), uint8(ACTIVE), "not completed by skipping");
        (uint256 execLeft, uint256 amtLeft) = rpm.remaining(sid);
        assertEq(execLeft, 2);
        assertEq(amtLeft, 2 * AMOUNT);
        assertEq(_s(sid).nextDue, s + 7 days);
        vm.warp(s + 7 days);
        assertEq(_payOnce(sid, outsider), 7);
        assertEq(uint8(_st(sid)), uint8(ACTIVE));
        vm.warp(s + 8 days);
        PaySnap memory k = _snap(sid);
        assertEq(k.period, 8);
        _expectPaid(sid, k.period, k.s.nextDue, outsider, k.s.totalPaid + k.s.amount);
        vm.expectEmit(true, false, false, false, address(rpm));
        emit IRecurringPaymentModule.ScheduleCompleted(sid);
        _run(sid, outsider);
        _assertPaid(sid, k);
        assertEq(uint8(_st(sid)), uint8(IRecurringPaymentModule.ScheduleStatus.Completed));
        assertEq(_s(sid).executedCount, 3);
        assertEq(_s(sid).totalPaid, 3 * AMOUNT);
        assertEq(usdc.balanceOf(payee1), 3 * AMOUNT);
    }

    // ------------------------------------------------------------ cancel
    function test_Sched07_CancelByApproverAndGuardianFromActiveAndPaused() public {
        address[4] memory who = [approver1, approver3, guardian, approver2];
        for (uint256 i; i < who.length; ++i) {
            uint256 sid = _daily(_now() + 10 days);
            if (i % 2 == 1) _pauseBy(sid, approver1);
            vm.expectEmit(true, true, false, false, address(rpm));
            emit IRecurringPaymentModule.ScheduleCancelled(sid, who[i]);
            vm.prank(who[i]);
            rpm.cancel(sid);
            assertEq(uint8(_st(sid)), uint8(CANCELLED));
        }
    }

    function test_Sched07_CancelRejectsUnauthorizedCallers() public {
        uint256 sid = _daily(_now() + 10 days);
        address[3] memory denied = [outsider, proposerOnly, keeper];
        for (uint256 i; i < denied.length; ++i) {
            vm.prank(denied[i]);
            vm.expectRevert(IRecurringPaymentModule.Unauthorized.selector);
            rpm.cancel(sid);
        }
        assertEq(uint8(_st(sid)), uint8(ACTIVE));
    }

    function test_Sched07_CancelIsTerminal_NoPauseExecuteOrResume() public {
        uint64 s = _execTs() + 1 days;
        uint256 sid = _daily(s);
        vm.warp(s);
        _payOnce(sid, outsider);
        vm.prank(guardian);
        rpm.cancel(sid);
        bytes32 d = _digest(sid);
        bytes memory err = abi.encodeWithSelector(IRecurringPaymentModule.InvalidStatus.selector, sid, CANCELLED);
        vm.prank(approver1);
        vm.expectRevert(err);
        rpm.cancel(sid);
        vm.prank(approver1);
        vm.expectRevert(err);
        rpm.pause(sid);
        vm.warp(s + 1 days);
        vm.expectRevert(err);
        rpm.execute(sid);
        assertFalse(rpm.isDue(sid));
        uint256 pid = _proposeResume(sid, false);
        _expectCallbackRevert(pid, err);
        pid = _proposeResume(sid, true);
        _expectCallbackRevert(pid, err);
        assertEq(_digest(sid), d, "cancelled schedule is frozen");
        assertEq(usdc.balanceOf(payee1), AMOUNT);
        (uint256 e, uint256 a) = rpm.remaining(sid);
        assertEq(e + a, 0, "no remaining capacity on a cancelled schedule");
    }
}
