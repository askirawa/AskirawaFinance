// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RpmP2Base} from "./RecurringPaymentModule.P2Base.t.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";
import {ScheduleMath} from "../../v2/libraries/ScheduleMath.sol";

/// @notice Fuzzed catch-up: random frequency, number of missed periods and warp length. Due dates come from the
/// independent reference oracle (_dueOf / refFirstAfter), never from the module's own arithmetic.
contract RecurringPaymentModuleCatchUpFuzzTest is RpmP2Base {
    function _freq(uint8 seed) internal pure returns (ScheduleMath.Frequency) {
        return ScheduleMath.Frequency(seed % 3);
    }

    /// @dev Creates a schedule, lets `missed` periods (plus `extra` seconds) pass so the guard auto-pauses it, then
    /// resumes WITHOUT skipping. Returns the schedule id and the catch-up boundary.
    function _backlogThenResume(uint8 freqSeed, uint256 missed, uint256 extra)
        internal returns (uint256 sid, uint64 boundary)
    {
        sid = _create(_p(payee1, AMOUNT, _freq(freqSeed), _execTs()));
        vm.warp(_dueOf(sid, missed) + extra);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(sid, IRPM.AutoPauseReason.BACKLOG);
        _run(sid, outsider);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        boundary = _resumeExpecting(sid, false, 0);
    }

    /// @dev Pays every period due at or before the boundary, one execute per period; returns the count.
    function _drainAuthorized(uint256 sid, uint64 boundary) internal returns (uint256 k) {
        while (_dueOf(sid, k) <= boundary) {
            assertEq(_s(sid).nextDue, _dueOf(sid, k));
            assertEq(_payOnce(sid, k % 2 == 0 ? keeper : outsider), k, "period index");
            ++k;
            assertEq(usdc.balanceOf(payee1), k * AMOUNT, "recipient balance after each payment");
        }
        assertEq(_s(sid).executedCount, k);
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, uint64(_dueOf(sid, k))));
        _run(sid, outsider);
    }

    function testFuzz_CatchUp_PaysExactlyEveryPeriodDueByTheBoundary(uint8 freqSeed, uint8 missedSeed, uint32 extraSeed)
        public
    {
        uint256 missed = bound(missedSeed, 3, 12);
        uint256 extra = bound(extraSeed, 0, 12 hours);
        (uint256 sid, uint64 boundary) = _backlogThenResume(freqSeed, missed, extra);
        uint256 k = _drainAuthorized(sid, boundary);
        assertGe(k, missed + 1, "at least every period that triggered the backlog");
        assertEq(k, refFirstAfter(_s(sid).startTime, _s(sid).frequency, boundary, 100), "oracle count of due periods");
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Active));
    }

    function testFuzz_CatchUp_OrdinaryGuardReturnsOnceTheRangeIsConsumed(uint8 freqSeed, uint8 missedSeed, uint32 extraSeed)
        public
    {
        uint256 missed = bound(missedSeed, 3, 12);
        uint256 extra = bound(extraSeed, 0, 12 hours);
        (uint256 sid, uint64 boundary) = _backlogThenResume(freqSeed, missed, extra);
        uint256 k = _drainAuthorized(sid, boundary);
        uint256 snap = vm.snapshotState();

        // one second before period k+3 is due, period k is still within the ordinary tolerance and is paid
        vm.warp(_dueOf(sid, k + 3) - 1);
        assertEq(_payOnce(sid, outsider), k);

        // at the exact second, period k is three periods behind and beyond the boundary: BACKLOG auto-pause
        vm.revertToState(snap);
        vm.warp(_dueOf(sid, k + 3));
        bytes32 d = _digest(sid);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleAutoPaused(sid, IRPM.AutoPauseReason.BACKLOG);
        _run(sid, outsider);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(_s(sid).executedCount, k);
        assertEq(usdc.balanceOf(payee1), k * AMOUNT, "maintenance call paid nothing");
        assertTrue(_digest(sid) != d);
    }

    function testFuzz_CatchUp_SkipResumePaysOnlyTheNextPeriodAndClearsTheBoundary(
        uint8 freqSeed, uint8 missedSeed, uint32 extraSeed
    ) public {
        uint256 missed = bound(missedSeed, 3, 12);
        uint256 extra = bound(extraSeed, 0, 12 hours);
        (uint256 sid,) = _backlogThenResume(freqSeed, missed, extra); // boundary set, schedule Active
        vm.prank(approver1);
        rpm.pause(sid);
        IRPM.Schedule memory before = _s(sid);
        uint256 pid = _proposeResume(sid, true);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        uint256 next = refFirstAfter(before.startTime, before.frequency, _now(), 100);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleResumed(sid, next);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.CatchUpAuthorized(sid, 0);
        _exec(pid);
        assertEq(rpm.catchUpUntil(sid), 0);
        assertEq(rpm.skippedPeriods(sid), next);
        assertEq(_s(sid).nextDue, _dueOf(sid, next));
        vm.warp(_dueOf(sid, next));
        assertEq(_payOnce(sid, outsider), next, "only the next period, with the skipped ones in the index");
        assertEq(usdc.balanceOf(payee1), AMOUNT, "no catch-up after a skip resume");
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, uint64(_dueOf(sid, next + 1))));
        _run(sid, outsider);
    }

    /// @dev After a catch-up resume, wait a random time and hammer execute: every payment must be for a period that
    /// is due, strictly one per call, and a period beyond the boundary is only ever paid while it is within the
    /// ordinary tolerance (fewer than three periods behind).
    function testFuzz_CatchUp_NoPaymentEverFallsOutsideTheAuthorizedOrOrdinaryRange(
        uint8 freqSeed, uint8 missedSeed, uint32 waitSeed
    ) public {
        (uint256 sid, uint64 boundary) = _backlogThenResume(freqSeed, bound(missedSeed, 3, 8), 0);
        vm.warp(_now() + bound(waitSeed, 0, 20 days));
        for (uint256 i; i < 40; ++i) {
            IRPM.Schedule memory b = _s(sid);
            if (b.status != IRPM.ScheduleStatus.Active) break;
            if (_now() < b.nextDue) break;
            _run(sid, outsider);
            IRPM.Schedule memory a = _s(sid);
            if (a.executedCount == b.executedCount) continue; // maintenance outcome (auto-pause) only
            assertEq(a.executedCount, b.executedCount + 1, "one payment per call");
            assertLe(b.nextDue, _now(), "a paid period was due");
            assertEq(usdc.balanceOf(payee1), uint256(a.executedCount) * AMOUNT);
            if (b.nextDue > boundary) {
                assertGt(_dueOf(sid, b.executedCount + 3), _now(), "beyond the boundary only inside the tolerance");
            }
        }
        assertLe(_s(sid).executedCount, refFirstAfter(_s(sid).startTime, _s(sid).frequency, _now(), 100));
    }
}
