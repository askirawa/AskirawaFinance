// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {RecurringPaymentModuleTestBase} from "./RecurringPaymentModule.Base.t.sol";
import {IRecurringPaymentModule} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice M-SCHED-08: maxExecutions, maxTotal and endTime complete a schedule exactly; remaining() accounting.
contract RecurringPaymentModuleLimitsTest is RecurringPaymentModuleTestBase {
    IRecurringPaymentModule.ScheduleStatus internal constant COMPLETED = IRecurringPaymentModule.ScheduleStatus.Completed;
    IRecurringPaymentModule.ScheduleStatus internal constant ACTIVE = IRecurringPaymentModule.ScheduleStatus.Active;

    /// @dev Pays the next period at its exact due time and expects (or not) completion in the same call.
    function _payDue(uint256 sid, bool completes) internal {
        vm.warp(_s(sid).nextDue);
        PaySnap memory k = _snap(sid);
        _expectPaid(sid, k.period, k.s.nextDue, outsider, k.s.totalPaid + k.s.amount);
        if (completes) {
            vm.expectEmit(true, false, false, false, address(rpm));
            emit IRecurringPaymentModule.ScheduleCompleted(sid);
        }
        _run(sid, outsider);
        _assertPaid(sid, k);
        assertEq(uint8(_st(sid)), uint8(completes ? COMPLETED : ACTIVE), completes ? "must complete now" : "must stay active");
    }

    function _assertTerminalFrozen(uint256 sid, uint256 paid) internal {
        bytes memory err = abi.encodeWithSelector(IRecurringPaymentModule.InvalidStatus.selector, sid, COMPLETED);
        vm.warp(_now() + 30 days);
        vm.expectRevert(err);
        rpm.execute(sid);
        vm.prank(approver1);
        vm.expectRevert(err);
        rpm.pause(sid);
        vm.prank(approver1);
        vm.expectRevert(err);
        rpm.cancel(sid);
        assertFalse(rpm.isDue(sid));
        (uint256 e, uint256 a) = rpm.remaining(sid);
        assertEq(e + a, 0);
        assertEq(usdc.balanceOf(payee1), paid, "no payment after completion");
    }

    // ------------------------------------------------------------ maxExecutions
    function test_Sched08_MaxExecutionsCompletesOnTheLastPaymentExactly() public {
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs() + 1 days);
        p.maxExecutions = 3;
        uint256 sid = _create(p);
        _payDue(sid, false);
        _payDue(sid, false);
        _payDue(sid, true);
        assertEq(_s(sid).executedCount, 3);
        assertEq(_s(sid).totalPaid, 3 * AMOUNT);
        _assertTerminalFrozen(sid, 3 * AMOUNT);
    }

    function test_Sched08_MaxExecutionsOneCompletesOnFirstPayment() public {
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, WEEKLY, _execTs() + 1 days);
        p.maxExecutions = 1;
        uint256 sid = _create(p);
        _payDue(sid, true);
        _assertTerminalFrozen(sid, AMOUNT);
    }

    // ------------------------------------------------------------ maxTotal
    function test_Sched08_MaxTotalNotMultipleOfAmount_StopsBeforeExceedingIt() public {
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs() + 1 days);
        p.maxTotal = 250e6;
        uint256 sid = _create(p);
        _payDue(sid, false);
        (uint256 e, uint256 a) = rpm.remaining(sid);
        assertEq(e, 1, "only one more full payment fits");
        assertEq(a, 150e6, "headroom is not rounded to a multiple of amount");
        _payDue(sid, true); // 200e6 paid; another 100e6 would exceed 250e6
        assertEq(_s(sid).totalPaid, 200e6);
        _assertTerminalFrozen(sid, 200e6);
    }

    function test_Sched08_MaxTotalExactMultiple_PaysUpToAndIncludingTheCap() public {
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs() + 1 days);
        p.maxTotal = 3 * AMOUNT;
        uint256 sid = _create(p);
        _payDue(sid, false);
        _payDue(sid, false);
        (uint256 e, uint256 a) = rpm.remaining(sid);
        assertEq(e, 1);
        assertEq(a, AMOUNT);
        _payDue(sid, true);
        assertEq(_s(sid).totalPaid, 3 * AMOUNT, "paid exactly the cap");
        _assertTerminalFrozen(sid, 3 * AMOUNT);
    }

    function test_Sched08_WhicheverOfCountAndTotalIsReachedFirstWins() public {
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs() + 1 days);
        p.maxExecutions = 5;
        p.maxTotal = 250e6;
        uint256 sid = _create(p);
        (uint256 e, uint256 a) = rpm.remaining(sid);
        assertEq(e, 2, "amount bound is tighter than count bound");
        assertEq(a, 250e6);
        _payDue(sid, false);
        _payDue(sid, true);
        assertEq(_s(sid).executedCount, 2);
        IRecurringPaymentModule.ScheduleParams memory q = _p(payee2, AMOUNT, DAILY, _execTs() + 1 days);
        q.maxExecutions = 2;
        q.maxTotal = 10_000e6;
        uint256 sid2 = _create(q);
        (e, a) = rpm.remaining(sid2);
        assertEq(e, 2);
        assertEq(a, 2 * AMOUNT, "amount headroom capped by remaining count capacity");
    }

    // ------------------------------------------------------------ endTime
    function test_Sched08_EndTimeIsInclusiveForDueDatesAndCompletesWithTheLastDuePeriod() public {
        uint64 s = _execTs() + 1 days;
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, s);
        p.endTime = s + 2 days; // period 2 is due exactly at endTime
        uint256 sid = _create(p);
        _payDue(sid, false);
        _payDue(sid, false);
        _payDue(sid, true);
        assertEq(_s(sid).executedCount, 3, "periods 0,1,2 (due at or before endTime)");
        _assertTerminalFrozen(sid, 3 * AMOUNT);
    }

    function test_Sched08_EndTimeOneSecondBeforeAPeriodExcludesThatPeriod() public {
        uint64 s = _execTs() + 1 days;
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, s);
        p.endTime = s + 2 days - 1;
        uint256 sid = _create(p);
        _payDue(sid, false);
        _payDue(sid, true);
        assertEq(_s(sid).executedCount, 2);
        _assertTerminalFrozen(sid, 2 * AMOUNT);
    }

    function test_Sched08_EndTimeConstrainsDueDatesNotLateExecution() public {
        uint64 s = _execTs() + 1 days;
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, s);
        p.endTime = s + 1 days;
        uint256 sid = _create(p);
        vm.warp(s + 1 days + 1 hours); // execution time already after endTime; both periods were due before it
        assertEq(_payOnce(sid, outsider), 0);
        assertEq(uint8(_st(sid)), uint8(ACTIVE), "period 1 (due at endTime) still owed");
        assertEq(_payOnce(sid, outsider), 1);
        assertEq(uint8(_st(sid)), uint8(COMPLETED));
        assertEq(usdc.balanceOf(payee1), 2 * AMOUNT);
    }

    function test_Sched08_SkipPastEndTimeThenExecuteCompletesWithoutPayment() public {
        uint64 s = _execTs() + 1 days;
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, s);
        p.endTime = s + 3 days + 12 hours;
        uint256 sid = _create(p);
        vm.warp(s);
        _payOnce(sid, outsider);
        vm.prank(approver1);
        rpm.pause(sid);
        vm.warp(s + 5 days);
        _resume(sid, true); // executes at s + 6 days; first boundary after is period 7 (s + 7 days) > endTime
        assertEq(_s(sid).nextDue, s + 7 days);
        assertEq(uint8(_st(sid)), uint8(ACTIVE));
        vm.warp(s + 7 days);
        vm.recordLogs();
        vm.expectEmit(true, false, false, false, address(rpm));
        emit IRecurringPaymentModule.ScheduleCompleted(sid);
        _run(sid, outsider);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != IRecurringPaymentModule.ScheduleExecuted.selector, "no payment receipt");
        }
        assertEq(uint8(_st(sid)), uint8(COMPLETED));
        assertEq(_s(sid).executedCount, 1);
        assertEq(usdc.balanceOf(payee1), AMOUNT, "no payment at the hard stop");
    }

    // ------------------------------------------------------------ remaining()
    function test_Sched08_RemainingForUnlimitedUsesStorageCeilings() public {
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, _execTs() + 1 days));
        (uint256 e, uint256 a) = rpm.remaining(sid);
        assertEq(e, type(uint32).max, "count ceiling when no maxExecutions");
        assertEq(a, uint256(type(uint32).max) * AMOUNT, "amount capped by count capacity");
        vm.warp(_s(sid).nextDue);
        _payOnce(sid, outsider);
        (e, a) = rpm.remaining(sid);
        assertEq(e, uint256(type(uint32).max) - 1);
        assertEq(a, (uint256(type(uint32).max) - 1) * AMOUNT);
    }

    function test_Sched08_RemainingIsZeroForUnknownCancelledAndCompletedAndCountsPaused() public {
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs() + 1 days);
        p.maxExecutions = 4;
        uint256 sid = _create(p);
        vm.prank(guardian);
        rpm.pause(sid);
        (uint256 e, uint256 a) = rpm.remaining(sid);
        assertEq(e, 4, "paused schedules still report capacity");
        assertEq(a, 4 * AMOUNT);
        vm.prank(guardian);
        rpm.cancel(sid);
        (e, a) = rpm.remaining(sid);
        assertEq(e + a, 0, "cancelled");
        (e, a) = rpm.remaining(404);
        assertEq(e + a, 0, "unknown");
    }
}
