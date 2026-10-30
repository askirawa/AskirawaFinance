// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {RpmP2Base} from "./RecurringPaymentModule.P2Base.t.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice M-SCHED-09 (minTreasuryBalanceAfter), 10 (backlog guard), 11 (a failed attempt never double advances)
/// and the revert-data classification table (unknown / short data maps to OTHER).
contract RecurringPaymentModuleSchedTest is RpmP2Base {
    uint96 internal constant MIN_AFTER = 50e6;

    // ------------------------------------------------------------ M-SCHED-09
    function test_MSched09_MinTreasuryBalanceAfterSoftFailsWithConditionThenPaysOnceFunded() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.minTreasuryBalanceAfter = MIN_AFTER;
        uint256 sid = _create(p);
        _setBalance(AMOUNT + MIN_AFTER - 1); // exactly one unit short of keeping the floor
        _failOnce(sid, outsider, R_CONDITION);
        assertEq(usdc.balanceOf(payee1), 0);
        _fund(1);
        vm.warp(_s(sid).nextRetryAt);
        assertEq(_payOnce(sid, outsider), 0);
        assertEq(t.balance(), MIN_AFTER, "the floor is kept after the payment");
        assertEq(_s(sid).failures, 0);
    }

    function test_MSched09_ConditionFailuresAutoPauseLikeAnyOtherFailure() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.minTreasuryBalanceAfter = MIN_AFTER;
        uint256 sid = _create(p);
        _setBalance(AMOUNT); // enough to pay, not enough to keep the floor
        for (uint256 i; i < MAX_FAILURES; ++i) {
            if (i != 0) vm.warp(_s(sid).nextRetryAt);
            _failOnce(sid, outsider, R_CONDITION);
        }
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
    }

    // ------------------------------------------------------------ M-SCHED-10
    function test_MSched10_BacklogBoundaryOneSecondBeforeStillPays() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        vm.warp(start + 3 days - 1);
        assertEq(_payOnce(sid, outsider), 0, "2 days 23:59:59 overdue is within the tolerance");
    }

    /// @dev Drives a fresh daily schedule into a BACKLOG auto-pause (exactly 3 periods overdue) and asserts that
    /// the maintenance call emitted only the auto-pause event and changed nothing but the status.
    function _backlogPause(uint256 sid) internal {
        uint64 start = _s(sid).startTime;
        vm.warp(start + 3 days); // periods 0..2 unpaid, add(start, 3) <= now
        bytes32 d = _digest(sid);
        uint256 coreBal = t.balance();

        vm.recordLogs();
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(sid, IRPM.AutoPauseReason.BACKLOG);
        _run(sid, outsider);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 moduleOrCoreLogs;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(rpm) || logs[i].emitter == address(t) || logs[i].emitter == address(usdc)) {
                ++moduleOrCoreLogs;
                assertEq(logs[i].topics[0], IRPM.ScheduleAutoPaused.selector);
            }
        }
        assertEq(moduleOrCoreLogs, 1, "only the auto-pause event: no payment, no failure record");
        IRPM.Schedule memory s = _s(sid);
        assertEq(uint8(s.status), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(s.executedCount, 0);
        assertEq(s.failures, 0, "backlog is not a failed attempt");
        assertEq(s.nextRetryAt, 0);
        assertEq(s.nextDue, start);
        assertEq(usdc.balanceOf(payee1), 0);
        assertEq(t.balance(), coreBal);
        assertTrue(_digest(sid) != d);
        vm.expectRevert(abi.encodeWithSelector(IRPM.InvalidStatus.selector, sid, IRPM.ScheduleStatus.Paused));
        _run(sid, outsider);
    }

    function test_MSched10_BacklogAutoPauseThenResumeWithoutSkipNoLongerRepausesAndPaysEveryDuePeriod() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _backlogPause(sid);

        // resume WITHOUT skipping: the quorum snapshots the approval time as the catch-up boundary
        uint64 boundary = _resumeExpecting(sid, false, 0);
        assertEq(boundary, start + 4 days, "approval executes one payroll delay after the pause");
        assertEq(rpm.catchUpUntil(sid), boundary);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Active));
        assertEq(rpm.skippedPeriods(sid), 0);
        assertEq(_s(sid).nextDue, start, "resume does not move the calendar");

        // the very first execute pays period 0 (it used to re-pause with BACKLOG)
        // periods 0..4 are due at or before the boundary: five payments, one per call
        for (uint256 i; i < 5; ++i) {
            assertEq(_payOnce(sid, i % 2 == 0 ? keeper : outsider), i, "oldest unpaid period first");
            assertEq(usdc.balanceOf(payee1), (i + 1) * AMOUNT);
            assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Active), "no re-pause on the authorized range");
        }
        assertEq(_s(sid).executedCount, 5);
        assertEq(_s(sid).nextDue, start + 5 days);
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, start + 5 days));
        _run(sid, outsider);
    }

    function test_MSched10_BacklogAutoPauseThenSkipResumePaysOnlyNextPeriodAndClearsBoundary() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _backlogPause(sid);
        // a prior no-skip resume left a boundary; a later skip resume must clear it
        _resumeExpecting(sid, false, 0);
        assertGt(rpm.catchUpUntil(sid), 0);
        vm.prank(approver1);
        rpm.pause(sid);

        uint256 pid = _proposeResume(sid, true);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        uint256 n = (_now() - start) / 1 days + 1;
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleResumed(sid, n);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.CatchUpAuthorized(sid, 0);
        _exec(pid);
        assertEq(rpm.catchUpUntil(sid), 0, "skip clears the boundary");
        assertEq(rpm.skippedPeriods(sid), n);
        assertEq(_s(sid).nextDue, start + n * 1 days);
        assertEq(_s(sid).executedCount, 0, "skipped periods are not payments");
        assertEq(_s(sid).totalPaid, 0);
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, start + n * 1 days));
        _run(sid, outsider);
        vm.warp(start + n * 1 days);
        assertEq(_payOnce(sid, outsider), n, "period index includes the skipped periods");
        assertEq(usdc.balanceOf(payee1), AMOUNT, "exactly one payment for the whole backlog");
        assertEq(_s(sid).executedCount, 1);
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, start + (n + 1) * 1 days));
        _run(sid, outsider);
    }

    function test_MSched10_WeeklyBacklogUsesWeeklyPeriods() public {
        uint256 sid = _create(_p(payee1, AMOUNT, WEEKLY, _execTs()));
        uint64 start = _s(sid).startTime;
        vm.warp(start + 21 days - 1);
        assertEq(_payOnce(sid, outsider), 0);
        // period 1 became due at start+7d; period 1 + 3 = 4 weeks
        vm.warp(start + 28 days);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(sid, IRPM.AutoPauseReason.BACKLOG);
        _run(sid, outsider);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(usdc.balanceOf(payee1), AMOUNT);
    }

    // ------------------------------------------------------------ M-SCHED-11
    function test_MSched11_FailedAttemptsNeverAdvanceThePeriodNorTheDueDate() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _drain();
        _failOnce(sid, outsider, R_INSUFFICIENT); // event period 0
        vm.warp(_s(sid).nextRetryAt);
        _failOnce(sid, outsider, R_INSUFFICIENT); // still period 0
        _fund(10 * AMOUNT);
        vm.warp(_s(sid).nextRetryAt);
        assertEq(_payOnce(sid, outsider), 0, "payment lands on the period that failed");
        assertEq(_s(sid).nextDue, start + 1 days, "advanced exactly once");
        // next period: another failure reports period 1, not 2
        _drain();
        vm.warp(start + 1 days);
        _failOnce(sid, outsider, R_INSUFFICIENT);
        assertEq(_s(sid).nextDue, start + 1 days);
        assertEq(_s(sid).executedCount, 1);
    }

    function test_MSched11_AfterSkippedPeriodsAFailureReportsTheCalendarPeriod() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        vm.warp(start + 3 days);
        _run(sid, outsider); // backlog auto-pause
        uint256 pid = _proposeResume(sid, true);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        _exec(pid);
        uint256 n = rpm.skippedPeriods(sid);
        assertGt(n, 0);
        vm.warp(_s(sid).nextDue);
        _drain();
        _failOnce(sid, outsider, R_INSUFFICIENT); // asserts period == executedCount + skipped == n
        assertEq(_s(sid).executedCount, 0);
        assertEq(rpm.skippedPeriods(sid), n);
        _fund(AMOUNT);
        vm.warp(_s(sid).nextRetryAt);
        assertEq(_payOnce(sid, outsider), n);
    }

    // ------------------------------------------------------------ classification (OTHER and the rest)
    function _classify(bytes memory revertData, IRPM.FailureReason expected) internal {
        uint256 sid = _mkDaily();
        vm.mockCallRevert(address(t), abi.encodeWithSelector(AskirawaTreasury.payFromModule.selector), revertData);
        _failOnce(sid, outsider, expected);
        vm.clearMockedCalls();
    }

    function test_Classify_ShortAndUnknownRevertDataMapsToOther() public {
        _classify("", R_OTHER);
        _classify(hex"01", R_OTHER);
        _classify(hex"aabbcc", R_OTHER);
        _classify(hex"deadbeef", R_OTHER);
        _classify(abi.encodeWithSignature("Panic(uint256)", 0x11), R_OTHER);
        _classify(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, address(rpm)), R_OTHER);
        _classify(abi.encodeWithSelector(AskirawaTreasury.ModuleCodeChanged.selector, address(rpm)), R_OTHER);
        // a known selector with its first byte flipped is unknown
        bytes4 s = AskirawaTreasury.TreasuryPaused.selector;
        _classify(abi.encodePacked(bytes4(uint32(s) ^ 0x01000000)), R_OTHER);
    }

    function test_Classify_KnownSelectorsMapToTheirReasonAndOnlyFourBytesAreInspected() public {
        _classify(abi.encodeWithSelector(AskirawaTreasury.TreasuryPaused.selector), R_PAUSED);
        _classify(abi.encodePacked(AskirawaTreasury.TreasuryPaused.selector, hex"01020304"), R_PAUSED);
        _classify(abi.encodeWithSelector(AskirawaTreasury.BudgetExceeded.selector), R_BUDGET);
        _classify(abi.encodeWithSelector(AskirawaTreasury.InsufficientBalance.selector, 1, 2), R_INSUFFICIENT);
        _classify(abi.encodeWithSelector(AskirawaTreasury.BalanceDeltaMismatch.selector, 1, 2, 3), R_TOKEN);
        _classify(abi.encodeWithSignature("Error(string)", "legacy"), R_TOKEN);
        _classify(abi.encodeWithSignature("SafeERC20FailedOperation(address)", address(usdc)), R_TOKEN);
        _classify(abi.encodeWithSignature("EnforcedPause()"), R_TOKEN);
        _classify(abi.encodeWithSignature("ERC20InsufficientBalance(address,uint256,uint256)", address(t), 1, 2), R_TOKEN);
    }

    function test_Classify_RevertingBalanceReadInTheConditionPathIsClassifiedToo() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.minTreasuryBalanceAfter = MIN_AFTER;
        uint256 sid = _create(p);
        vm.mockCallRevert(address(t), abi.encodeWithSelector(AskirawaTreasury.balance.selector), hex"abcd");
        _expectFailed(sid, 0, R_OTHER, 1);
        _run(sid, outsider);
        vm.clearMockedCalls();
        vm.mockCallRevert(address(t), abi.encodeWithSelector(AskirawaTreasury.balance.selector),
            abi.encodeWithSelector(AskirawaTreasury.TreasuryPaused.selector));
        vm.warp(_s(sid).nextRetryAt);
        _expectFailed(sid, 0, R_PAUSED, 2);
        _run(sid, outsider);
        vm.clearMockedCalls();
        assertEq(_s(sid).failures, 2);
        assertEq(_s(sid).executedCount, 0);
        assertEq(usdc.balanceOf(payee1), 0);
    }
}
