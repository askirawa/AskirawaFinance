// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RecurringPaymentModuleTestBase} from "./RecurringPaymentModule.Base.t.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice Shared helpers for module test part 2 (failures, authority, events, invariants).
/// No test functions live here. Every schedule is created through a real core proposal.
abstract contract RpmP2Base is RecurringPaymentModuleTestBase {
    IRPM.FailureReason internal constant R_PAUSED = IRPM.FailureReason.PAUSED;
    IRPM.FailureReason internal constant R_BUDGET = IRPM.FailureReason.BUDGET;
    IRPM.FailureReason internal constant R_INSUFFICIENT = IRPM.FailureReason.INSUFFICIENT_BALANCE;
    IRPM.FailureReason internal constant R_TOKEN = IRPM.FailureReason.TOKEN_REVERT;
    IRPM.FailureReason internal constant R_CONDITION = IRPM.FailureReason.CONDITION;
    IRPM.FailureReason internal constant R_OTHER = IRPM.FailureReason.OTHER;

    address internal sink = makeAddr("sink");

    /// @dev Daily schedule paying payee1 AMOUNT, open executor. When it returns the clock equals its first due time.
    function _mkDaily() internal returns (uint256) {
        return _create(_p(payee1, AMOUNT, DAILY, _execTs()));
    }

    /// @dev Real deposit through the core (mint, approve, deposit) by `outsider`.
    function _fund(uint256 n) internal {
        usdc.mint(outsider, n);
        vm.startPrank(outsider);
        usdc.approve(address(t), n);
        t.deposit(n);
        vm.stopPrank();
    }

    /// @dev Moves the whole treasury balance to `sink` (test-only cheat used to model an empty treasury).
    function _drain() internal {
        uint256 b = usdc.balanceOf(address(t));
        vm.prank(address(t));
        usdc.transfer(sink, b);
    }

    function _setBalance(uint256 n) internal {
        _drain();
        if (n != 0) _fund(n);
    }

    function _windowSpent() internal view returns (uint96 spent) {
        (,,,,,, spent) = t.modules(address(rpm));
    }

    function _expectFailed(uint256 sid, uint256 period, IRPM.FailureReason r, uint8 failures) internal {
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ExecutionFailed(sid, period, r, failures, _now() + RETRY_DELAY);
    }

    /// @dev One soft failure by `by`: exact event(s), nothing paid, no calendar movement, retry gate set.
    function _failOnce(uint256 sid, address by, IRPM.FailureReason r) internal {
        IRPM.Schedule memory b = _s(sid);
        uint256 period = uint256(b.executedCount) + rpm.skippedPeriods(sid);
        uint256 payeeBal = usdc.balanceOf(b.recipient);
        uint256 coreBal = t.balance();
        uint96 spent = _windowSpent();
        uint8 nf = b.failures + 1;
        _expectFailed(sid, period, r, nf);
        if (nf >= MAX_FAILURES) {
            vm.expectEmit(true, false, false, true, address(rpm));
            emit IRPM.ScheduleAutoPaused(sid, IRPM.AutoPauseReason.FAILURES);
        }
        _run(sid, by);
        IRPM.Schedule memory a = _s(sid);
        assertEq(a.executedCount, b.executedCount, "executedCount unchanged");
        assertEq(a.totalPaid, b.totalPaid, "totalPaid unchanged");
        assertEq(a.nextDue, b.nextDue, "calendar not advanced");
        assertEq(a.recipient, b.recipient);
        assertEq(a.amount, b.amount);
        assertEq(a.failures, nf, "failures + 1");
        assertEq(a.nextRetryAt, _now() + RETRY_DELAY, "retry gate");
        assertEq(rpm.skippedPeriods(sid), period - b.executedCount, "skip count untouched");
        assertEq(usdc.balanceOf(b.recipient), payeeBal, "nothing paid");
        assertEq(t.balance(), coreBal, "treasury untouched");
        assertEq(_windowSpent(), spent, "core budget untouched by a failed draw");
        assertEq(uint8(a.status), uint8(nf >= MAX_FAILURES ? IRPM.ScheduleStatus.Paused : IRPM.ScheduleStatus.Active));
    }

    /// @dev Low-level execute so a test can spam without reverts aborting; returns whether the call succeeded.
    function _tryRun(uint256 sid, address by) internal returns (bool ok) {
        vm.prank(by);
        (ok,) = address(rpm).call(abi.encodeCall(IRPM.execute, (sid)));
    }

    /// @dev Resume through a real proposal, asserting the exact ScheduleResumed and CatchUpAuthorized arguments
    /// (the boundary is the approval-execution timestamp for a no-skip resume, zero for a skip resume).
    /// Returns the execution timestamp.
    function _resumeExpecting(uint256 sid, bool skipMissed, uint256 skipped) internal returns (uint64 execAt) {
        uint256 pid = _proposeResume(sid, skipMissed);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        execAt = _now();
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.ScheduleResumed(sid, skipped);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.CatchUpAuthorized(sid, skipMissed ? 0 : execAt);
        _exec(pid);
        assertEq(rpm.catchUpUntil(sid), skipMissed ? 0 : execAt, "boundary stored");
    }
}
