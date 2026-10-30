// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {RpmP2Base} from "./RecurringPaymentModule.P2Base.t.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice Exact-argument checks for every module event (all topics and all data words).
contract RecurringPaymentModuleEventsTest is RpmP2Base {
    bytes32 internal constant MEMO_X = keccak256("PLACEHOLDER_SCHEDULE_MEMO");

    function _create_expecting(IRPM.ScheduleParams memory p, uint64 effective) internal returns (uint256 sid) {
        uint256 pid = _proposeCreate(p);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        sid = rpm.scheduleCount() + 1;
        vm.expectEmit(true, true, true, true, address(rpm));
        emit IRPM.ScheduleCreated(sid, pid, p.recipient, p.amount, p.frequency, p.startTime, effective,
            p.endTime, p.maxExecutions, p.maxTotal, p.minTreasuryBalanceAfter, p.executor, p.memoRef);
        _exec(pid);
        assertEq(rpm.scheduleCount(), sid);
    }

    function _full(uint64 startTime) internal view returns (IRPM.ScheduleParams memory p) {
        p = _p(payee1, 123e6, WEEKLY, startTime);
        p.endTime = startTime + 400 days;
        p.maxExecutions = 7;
        p.maxTotal = 900e6;
        p.minTreasuryBalanceAfter = 11e6;
        p.executor = keeper;
        p.memoRef = MEMO_X;
    }

    function test_Event_ScheduleCreated_FutureStartKeepsRequestedAndEffectiveEqual() public {
        uint64 start = _now() + 5 days;
        _create_expecting(_full(start), start);
    }

    function test_Event_ScheduleCreated_PastStartIsClampedToExecutionTimeInEffectiveStart() public {
        uint64 requested = _now() - 3 days;
        IRPM.ScheduleParams memory p = _full(requested);
        p.endTime = _now() + 100 days;
        uint64 effective = _execTs();
        uint256 sid = _create_expecting(p, effective);
        assertEq(_s(sid).startTime, effective, "stored anchor is the effective start");
        assertEq(_s(sid).nextDue, effective);
        assertEq(_s(sid).createdByProposal, t.nextProposalId() - 1);
    }

    function test_Event_ScheduleExecuted_ExactArgumentsAcrossTwoPeriods() public {
        uint64 start = _execTs();
        uint256 sid = _create(_p(payee1, 77e6, DAILY, start));
        vm.warp(start + 5 hours); // executed late: dueAt != executedAt
        vm.expectEmit(true, true, true, true, address(rpm));
        emit IRPM.ScheduleExecuted(sid, 0, payee1, 77e6, start, start + 5 hours, approver2, 77e6);
        _run(sid, approver2);
        vm.warp(start + 1 days + 90 minutes);
        vm.expectEmit(true, true, true, true, address(rpm));
        emit IRPM.ScheduleExecuted(sid, 1, payee1, 77e6, start + 1 days, start + 1 days + 90 minutes, keeper, 154e6);
        _run(sid, keeper);
        assertEq(usdc.balanceOf(payee1), 154e6);
    }

    function test_Event_ExecutionFailed_ExactArgumentsOnConsecutiveFailures() public {
        uint256 sid = _mkDaily();
        _drain();
        uint64 t0 = _now();
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ExecutionFailed(sid, 0, IRPM.FailureReason.INSUFFICIENT_BALANCE, 1, t0 + RETRY_DELAY);
        _run(sid, outsider);
        vm.warp(t0 + RETRY_DELAY + 10);
        _fund(AMOUNT);
        usdc.setGlobalPause(true);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ExecutionFailed(sid, 0, IRPM.FailureReason.TOKEN_REVERT, 2, t0 + 2 * RETRY_DELAY + 10);
        _run(sid, outsider);
    }

    function test_Event_ScheduleAutoPaused_FailuresAndBacklogCodes() public {
        uint256 s1 = _mkDaily();
        _drain();
        for (uint256 i; i < MAX_FAILURES - 1; ++i) {
            _run(s1, outsider);
            vm.warp(_s(s1).nextRetryAt);
        }
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ExecutionFailed(s1, 0, IRPM.FailureReason.INSUFFICIENT_BALANCE, MAX_FAILURES, _now() + RETRY_DELAY);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(s1, IRPM.AutoPauseReason.FAILURES);
        _run(s1, outsider);
        assertEq(uint8(IRPM.AutoPauseReason.FAILURES), 1, "stable ordinal");
        assertEq(uint8(IRPM.AutoPauseReason.BACKLOG), 0, "stable ordinal");

        _fund(10 * AMOUNT);
        uint256 s2 = _mkDaily();
        vm.warp(_s(s2).startTime + 3 days);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(s2, IRPM.AutoPauseReason.BACKLOG);
        _run(s2, outsider);
    }

    function test_Event_SchedulePausedAndCancelled_CarryTheActualCaller() public {
        uint256 s1 = _mkDaily();
        vm.expectEmit(true, true, false, false, address(rpm));
        emit IRPM.SchedulePaused(s1, approver3);
        vm.prank(approver3);
        rpm.pause(s1);
        vm.expectEmit(true, true, false, false, address(rpm));
        emit IRPM.ScheduleCancelled(s1, guardian);
        vm.prank(guardian);
        rpm.cancel(s1); // Paused -> Cancelled is allowed

        uint256 s2 = _create(_p(payee2, AMOUNT, DAILY, _execTs()));
        vm.expectEmit(true, true, false, false, address(rpm));
        emit IRPM.SchedulePaused(s2, guardian);
        vm.prank(guardian);
        rpm.pause(s2);
        vm.expectEmit(true, true, false, false, address(rpm));
        emit IRPM.ScheduleCancelled(s2, approver1);
        vm.prank(approver1);
        rpm.cancel(s2);
        assertEq(uint8(_st(s1)), uint8(IRPM.ScheduleStatus.Cancelled));
        assertEq(uint8(_st(s2)), uint8(IRPM.ScheduleStatus.Cancelled));
    }

    function test_Event_ScheduleResumed_SkippedPeriodsIsTheDeltaOfThisResume() public {
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        vm.prank(approver1);
        rpm.pause(sid);
        _resumeExpecting(sid, false, 0);
        vm.prank(approver1);
        rpm.pause(sid);
        vm.warp(start + 2 days + 3 hours);
        uint256 pid = _proposeResume(sid, true);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        uint256 first = (_now() - start) / 1 days + 1;
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleResumed(sid, first);
        _exec(pid);
        // second resume: the delta, not the lifetime total
        vm.prank(approver1);
        rpm.pause(sid);
        vm.warp(_now() + 2 days);
        uint256 pid2 = _proposeResume(sid, true);
        _reachQuorum(pid2);
        _warpToExecutable(pid2);
        uint256 total = (_now() - start) / 1 days + 1;
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleResumed(sid, total - first);
        _exec(pid2);
        assertEq(rpm.skippedPeriods(sid), total);
    }

    function test_Event_ScheduleCompleted_AfterTheLastAllowedPaymentByCount() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.maxExecutions = 2;
        uint256 sid = _create(p);
        uint64 start = _s(sid).startTime;
        _run(sid, outsider);
        vm.warp(start + 1 days);
        vm.expectEmit(true, true, true, true, address(rpm));
        emit IRPM.ScheduleExecuted(sid, 1, payee1, AMOUNT, start + 1 days, start + 1 days, outsider, 2 * AMOUNT);
        vm.expectEmit(true, false, false, false, address(rpm));
        emit IRPM.ScheduleCompleted(sid);
        _run(sid, outsider);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Completed));
    }

    function test_Event_ScheduleCompleted_AfterTheLastPaymentByEndTimeAndByMaxTotal() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.endTime = _execTs() + 36 hours; // due dates start, +1d fit; +2d does not
        uint256 s1 = _create(p);
        uint64 start = _s(s1).startTime;
        _run(s1, outsider);
        vm.warp(start + 1 days);
        vm.expectEmit(true, false, false, false, address(rpm));
        emit IRPM.ScheduleCompleted(s1);
        _run(s1, outsider);
        assertEq(uint8(_st(s1)), uint8(IRPM.ScheduleStatus.Completed));

        IRPM.ScheduleParams memory q = _p(payee2, AMOUNT, DAILY, _execTs());
        q.maxTotal = 2 * AMOUNT + AMOUNT / 2; // a third payment would exceed it
        uint256 s2 = _create(q);
        uint64 st2 = _s(s2).startTime;
        _run(s2, outsider);
        assertEq(uint8(_st(s2)), uint8(IRPM.ScheduleStatus.Active));
        vm.warp(st2 + 1 days);
        vm.expectEmit(true, true, true, true, address(rpm));
        emit IRPM.ScheduleExecuted(s2, 1, payee2, AMOUNT, st2 + 1 days, st2 + 1 days, outsider, 2 * AMOUNT);
        vm.expectEmit(true, false, false, false, address(rpm));
        emit IRPM.ScheduleCompleted(s2); // no affordable third payment: completes right after the second
        _run(s2, outsider);
        assertEq(uint8(_st(s2)), uint8(IRPM.ScheduleStatus.Completed));
        assertEq(usdc.balanceOf(payee2), 2 * AMOUNT);
        vm.warp(st2 + 2 days);
        vm.expectRevert(abi.encodeWithSelector(IRPM.InvalidStatus.selector, s2, IRPM.ScheduleStatus.Completed));
        _run(s2, outsider);
    }

    function test_Event_ScheduleCompleted_MaintenanceCallCompletesWithoutPaying() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.endTime = _execTs() + 36 hours;
        uint256 sid = _create(p);
        uint64 start = _s(sid).startTime;
        vm.prank(approver1);
        rpm.pause(sid);
        vm.warp(start + 10 days);
        uint256 pid = _proposeResume(sid, true); // skips beyond the end: next due is after endTime
        _reachQuorum(pid);
        _warpToExecutable(pid);
        _exec(pid);
        vm.warp(_s(sid).nextDue);
        vm.recordLogs();
        _run(sid, outsider);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 relevant;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(rpm) || logs[i].emitter == address(t) || logs[i].emitter == address(usdc)) {
                ++relevant;
                assertEq(logs[i].topics[0], IRPM.ScheduleCompleted.selector);
                assertEq(uint256(logs[i].topics[1]), sid);
            }
        }
        assertEq(relevant, 1, "completed without a payment");
        assertEq(usdc.balanceOf(payee1), 0);
    }
}
