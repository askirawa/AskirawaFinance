// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {RpmP2Base} from "./RecurringPaymentModule.P2Base.t.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice Quorum-authorized catch-up: a resume WITHOUT skipping stores catchUpUntil[id] = approval-execution
/// timestamp; the backlog guard fires only while nextDue > catchUpUntil; a skip resume clears it to zero.
/// Every schedule here is a daily payee1 schedule unless stated; the clock is driven explicitly.
contract RecurringPaymentModuleCatchUpTest is RpmP2Base {
    uint64 internal constant DAY = 1 days;

    // ------------------------------------------------------------ helpers
    /// @dev Warps to `warpTo` and lets any caller trigger the backlog guard; asserts it paused with BACKLOG.
    function _toBacklogPause(uint256 sid, uint64 warpTo) internal {
        vm.warp(warpTo);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(sid, IRPM.AutoPauseReason.BACKLOG);
        _run(sid, outsider);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused), "backlog paused");
    }

    /// @dev No-skip resume whose approval executes at exactly `boundary` (proposal is made one delay earlier).
    function _resumeAt(uint256 sid, uint64 boundary) internal returns (uint64 execAt) {
        assertLe(_now() + PAYROLL_DELAY, boundary, "test setup: boundary reachable");
        vm.warp(boundary - PAYROLL_DELAY);
        execAt = _resumeExpecting(sid, false, 0);
        assertEq(execAt, boundary, "resume executed on the requested second");
    }

    /// @dev Pays periods [from_, to_) one per call and checks the oracle due date of each.
    function _payRange(uint256 sid, uint256 from_, uint256 to_) internal {
        for (uint256 i = from_; i < to_; ++i) {
            assertEq(_s(sid).nextDue, _dueOf(sid, i), "calendar oracle");
            assertEq(_payOnce(sid, i % 2 == 0 ? keeper : outsider), i, "period index");
            assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Active), "still active inside the authorized range");
        }
    }

    /// @dev A payment that must also complete the schedule.
    function _payFinal(uint256 sid) internal {
        PaySnap memory k = _snap(sid);
        _expectPaid(sid, k.period, k.s.nextDue, keeper, k.s.totalPaid + k.s.amount);
        vm.expectEmit(true, false, false, false, address(rpm));
        emit IRPM.ScheduleCompleted(sid);
        _run(sid, keeper);
        _assertPaid(sid, k);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Completed));
    }

    function _catchUpSchedule(IRPM.ScheduleParams memory p) internal returns (uint256 sid, uint64 start, uint64 r) {
        sid = _create(p);
        start = _s(sid).startTime;
        _toBacklogPause(sid, start + 3 * DAY);
        r = _resumeAt(sid, start + 6 * DAY);
    }

    // ------------------------------------------------------------ storage defaults
    function test_CatchUp_BoundaryIsZeroForNewSchedulesAndUnknownIds() public {
        uint256 sid = _mkDaily();
        assertEq(rpm.catchUpUntil(sid), 0);
        assertEq(rpm.catchUpUntil(0), 0);
        assertEq(rpm.catchUpUntil(999), 0);
        vm.prank(approver1);
        rpm.pause(sid);
        assertEq(rpm.catchUpUntil(sid), 0, "a plain pause authorizes nothing");
    }

    // ------------------------------------------------------------ boundary semantics
    function test_CatchUp_ExactBoundarySecondIsIncluded_OnePaymentPerCall() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _toBacklogPause(sid, start + 3 * DAY);
        uint64 r = _resumeAt(sid, start + 6 * DAY); // period 6 is due exactly at the boundary
        assertEq(rpm.catchUpUntil(sid), r);
        assertEq(_s(sid).nextDue, start, "resume leaves the calendar alone");
        assertEq(rpm.skippedPeriods(sid), 0);
        assertEq(usdc.balanceOf(payee1), 0, "resume itself pays nothing");

        _payRange(sid, 0, 7); // periods 0..6 inclusive
        assertEq(usdc.balanceOf(payee1), 7 * AMOUNT);
        assertEq(_s(sid).executedCount, 7);
        assertEq(_s(sid).totalPaid, 7 * AMOUNT);
        assertEq(_s(sid).nextDue, start + 7 * DAY);
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, start + 7 * DAY));
        _run(sid, outsider);
    }

    function test_CatchUp_SecondAfterBoundaryIsNotAuthorized_PaysWhileInsideOrdinaryTolerance() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _toBacklogPause(sid, start + 3 * DAY);
        uint64 r = _resumeAt(sid, start + 6 * DAY - 1);
        assertEq(rpm.catchUpUntil(sid), r);
        _payRange(sid, 0, 6); // periods 0..5 are due at or before the boundary
        assertEq(_s(sid).nextDue, start + 6 * DAY, "period 6 is due exactly boundary + 1");
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, start + 6 * DAY));
        _run(sid, outsider);
        // period 6 is not authorized, so the ordinary tolerance applies: still payable until period 9 is due
        vm.warp(start + 9 * DAY - 1);
        _payRange(sid, 6, 7);
    }

    function test_CatchUp_SecondAfterBoundaryIsNotAuthorized_OrdinaryGuardFiresOnceThreePeriodsBehind() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _toBacklogPause(sid, start + 3 * DAY);
        _resumeAt(sid, start + 6 * DAY - 1);
        _payRange(sid, 0, 6);
        vm.warp(start + 9 * DAY); // add(start, 6 + 3) <= now and nextDue (start+6d) > boundary
        bytes32 d = _digest(sid);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(sid, IRPM.AutoPauseReason.BACKLOG);
        _run(sid, outsider);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(_s(sid).executedCount, 6, "nothing paid by the maintenance call");
        assertEq(usdc.balanceOf(payee1), 6 * AMOUNT);
        assertTrue(_digest(sid) != d, "only the status changed");
    }

    function test_CatchUp_GuardAppliesAgainAfterTheRangeIsConsumed_ThenNewResumeReplacesTheBoundary() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _toBacklogPause(sid, start + 3 * DAY);
        uint64 r1 = _resumeAt(sid, start + 4 * DAY);
        _payRange(sid, 0, 5); // periods 0..4
        vm.warp(start + 8 * DAY); // period 5 now three periods behind and beyond r1
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(sid, IRPM.AutoPauseReason.BACKLOG);
        _run(sid, outsider);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(_s(sid).executedCount, 5);
        assertEq(rpm.catchUpUntil(sid), r1, "pausing does not clear the old boundary");

        uint64 r2 = _resumeAt(sid, start + 9 * DAY);
        assertGt(r2, r1);
        assertEq(rpm.catchUpUntil(sid), r2, "new no-skip resume replaces the boundary");
        _payRange(sid, 5, 10); // periods 5..9
        assertEq(usdc.balanceOf(payee1), 10 * AMOUNT);
    }

    function test_CatchUp_NonZeroBoundaryDoesNotDisableTheGuardForLaterPeriods() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        vm.prank(approver1);
        rpm.pause(sid);
        uint64 r = _resumeAt(sid, start + DAY); // nothing is backlogged yet
        _payRange(sid, 0, 2);
        vm.warp(start + 5 * DAY); // period 2 (due start+2d) is behind by three periods and beyond r
        assertGt(start + 2 * DAY, r);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(sid, IRPM.AutoPauseReason.BACKLOG);
        _run(sid, outsider);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(_s(sid).executedCount, 2);
    }

    // ------------------------------------------------------------ core budget
    function test_CatchUp_CoreWindowBudgetFailsThenPaymentsContinueNextWindow() public {
        _configureRpm(true, 3 * AMOUNT, 3 * AMOUNT, 12 hours); // three payments per 12 hours
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _toBacklogPause(sid, start + 3 * DAY);
        uint64 r = _resumeAt(sid, start + 4 * DAY);
        _payRange(sid, 0, 3);
        assertEq(_windowSpent(), 3 * AMOUNT, "window exhausted");

        _failOnce(sid, outsider, R_BUDGET); // period 3: soft failure, nothing moves
        assertEq(_s(sid).nextDue, start + 3 * DAY);
        vm.warp(r + RETRY_DELAY - 1);
        vm.expectRevert(abi.encodeWithSelector(IRPM.RetryNotReady.selector, r + RETRY_DELAY));
        _run(sid, outsider);

        vm.warp(r + 12 hours); // next core window (also past the retry gate)
        assertEq(_payOnce(sid, keeper), 3);
        assertEq(_s(sid).failures, 0, "success clears failures");
        assertEq(_payOnce(sid, keeper), 4, "period 4 is due exactly at the boundary");
        assertEq(_windowSpent(), 2 * AMOUNT, "fresh window spend");
        assertEq(usdc.balanceOf(payee1), 5 * AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, start + 5 * DAY));
        _run(sid, outsider);
    }

    function test_CatchUp_FailureAutoPauseDuringCatchUpThenFreshResumeContinues() public {
        _configureRpm(true, 3 * AMOUNT, 3 * AMOUNT, 1 days);
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _toBacklogPause(sid, start + 3 * DAY);
        uint64 r1 = _resumeAt(sid, start + 4 * DAY);
        _payRange(sid, 0, 3);
        for (uint256 i; i < MAX_FAILURES; ++i) {
            if (i != 0) vm.warp(_s(sid).nextRetryAt);
            _failOnce(sid, outsider, R_BUDGET); // the last one auto-pauses with FAILURES
        }
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(_s(sid).executedCount, 3);

        uint64 r2 = _resumeExpecting(sid, false, 0); // runs one delay later; window has rolled by then
        assertGt(r2, r1);
        assertEq(rpm.catchUpUntil(sid), r2);
        assertEq(_s(sid).failures, 0, "resume clears failures");
        assertEq(_s(sid).nextRetryAt, 0);
        // periods 3, 4 and 5 (due start+5d = r1+1d <= r2) are all authorized; the window allows exactly three
        assertLe(start + 5 * DAY, r2);
        assertLt(r2, start + 6 * DAY);
        _payRange(sid, 3, 6);
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, start + 6 * DAY));
        _run(sid, outsider);
        assertEq(usdc.balanceOf(payee1), 6 * AMOUNT);
    }

    // ------------------------------------------------------------ schedule limits
    function test_CatchUp_MaxExecutionsStopsTheCatchUp() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.maxExecutions = 3;
        (uint256 sid,,) = _catchUpSchedule(p);
        _payRange(sid, 0, 2);
        _payFinal(sid);
        assertEq(_s(sid).executedCount, 3);
        assertEq(usdc.balanceOf(payee1), 3 * AMOUNT, "four more periods were due but the cap holds");
        vm.expectRevert(abi.encodeWithSelector(IRPM.InvalidStatus.selector, sid, IRPM.ScheduleStatus.Completed));
        _run(sid, outsider);
    }

    function test_CatchUp_MaxTotalStopsTheCatchUp() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.maxTotal = 2 * AMOUNT + AMOUNT / 2; // a third payment would exceed it
        (uint256 sid,,) = _catchUpSchedule(p);
        _payRange(sid, 0, 1);
        _payFinal(sid);
        assertEq(_s(sid).totalPaid, 2 * AMOUNT);
        assertEq(usdc.balanceOf(payee1), 2 * AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(IRPM.InvalidStatus.selector, sid, IRPM.ScheduleStatus.Completed));
        _run(sid, outsider);
    }

    function test_CatchUp_EndTimeCapsDueDatesNotExecutionTime() public {
        uint64 start = _execTs();
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, start);
        p.endTime = start + 2 * DAY + 1 hours; // periods 0..2 are due before the end, period 3 is not
        (uint256 sid,, uint64 r) = _catchUpSchedule(p);
        assertGt(r, p.endTime, "payments happen long after endTime");
        _payRange(sid, 0, 2);
        _payFinal(sid); // period 2; period 3 (due start+3d) is beyond endTime
        assertEq(usdc.balanceOf(payee1), 3 * AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(IRPM.InvalidStatus.selector, sid, IRPM.ScheduleStatus.Completed));
        _run(sid, outsider);
    }

    // ------------------------------------------------------------ retries
    function test_CatchUp_SoftFailureInTheMiddleRetriesAtTheGateAndCatchUpContinues() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _toBacklogPause(sid, start + 3 * DAY);
        uint64 r = _resumeAt(sid, start + 4 * DAY);
        _payRange(sid, 0, 1);
        _drain();
        _failOnce(sid, outsider, R_INSUFFICIENT); // period 1
        uint64 gate = _s(sid).nextRetryAt;
        assertEq(gate, r + RETRY_DELAY);
        _fund(10 * AMOUNT);
        vm.warp(gate - 1);
        vm.expectRevert(abi.encodeWithSelector(IRPM.RetryNotReady.selector, gate));
        _run(sid, keeper);
        vm.warp(gate);
        _payRange(sid, 1, 5); // failure did not lose or duplicate any period; gate lifted by success
        assertEq(_s(sid).failures, 0);
        assertEq(usdc.balanceOf(payee1), 5 * AMOUNT);
    }

    // ------------------------------------------------------------ skipped periods stay skipped
    function test_CatchUp_PreviouslySkippedPeriodsAreNotRevived() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        _toBacklogPause(sid, start + 3 * DAY);
        _resumeExpecting(sid, true, 5); // executes at start+4d: periods 0..4 skipped, unpaid
        assertEq(rpm.skippedPeriods(sid), 5);
        assertEq(_s(sid).nextDue, start + 5 * DAY);
        vm.prank(approver1);
        rpm.pause(sid);
        _resumeAt(sid, start + 6 * DAY);
        assertEq(rpm.skippedPeriods(sid), 5, "a no-skip resume never touches the skip count");
        assertEq(_payOnce(sid, outsider), 5);
        assertEq(_payOnce(sid, outsider), 6);
        assertEq(_s(sid).executedCount, 2);
        assertEq(usdc.balanceOf(payee1), 2 * AMOUNT, "periods 0..4 stay unpaid");
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, start + 7 * DAY));
        _run(sid, outsider);
    }

    // ------------------------------------------------------------ CatchUpAuthorized on every resume
    function test_CatchUp_EventEmittedOnEveryResume_ZeroWhenSkipping_AfterScheduleResumed() public {
        uint256 sid = _mkDaily();
        bool[3] memory skip = [false, true, false];
        uint64 last;
        for (uint256 i; i < skip.length; ++i) {
            vm.prank(approver1);
            rpm.pause(sid);
            uint256 pid = _proposeResume(sid, skip[i]);
            _reachQuorum(pid);
            _warpToExecutable(pid);
            uint64 execAt = _now();
            vm.recordLogs();
            _exec(pid);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            uint256 seen;
            uint256 resumedAt = type(uint256).max;
            for (uint256 j; j < logs.length; ++j) {
                if (logs[j].emitter != address(rpm)) continue;
                if (logs[j].topics[0] == IRPM.ScheduleResumed.selector) resumedAt = j;
                if (logs[j].topics[0] == IRPM.CatchUpAuthorized.selector) {
                    ++seen;
                    assertGt(j, resumedAt, "emitted after ScheduleResumed");
                    assertEq(uint256(logs[j].topics[1]), sid);
                    assertEq(abi.decode(logs[j].data, (uint64)), skip[i] ? 0 : execAt);
                }
            }
            assertEq(seen, 1, "exactly one CatchUpAuthorized per resume");
            assertEq(rpm.catchUpUntil(sid), skip[i] ? 0 : execAt);
            if (!skip[i]) {
                assertGt(execAt, last);
                last = execAt;
            }
        }
    }
}
