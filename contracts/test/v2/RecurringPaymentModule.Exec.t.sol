// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RecurringPaymentModuleTestBase} from "./RecurringPaymentModule.Base.t.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {IRecurringPaymentModule} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice M-SCHED-03 (not due), 04 (pays once per period), 05 (no double pay), 06 (executor rules).
contract RecurringPaymentModuleExecTest is RecurringPaymentModuleTestBase {
    // ------------------------------------------------------------ M-SCHED-03
    function test_Sched03_ExecuteBeforeDueRevertsNotDueAndChangesNothing() public {
        uint64 start = _execTs() + 3 days;
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, start));
        bytes32 d = _digest(sid);
        uint256 payeeBal = usdc.balanceOf(payee1);
        uint256 coreBal = t.balance();
        address[3] memory callers = [outsider, approver1, keeper];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.NotDue.selector, start));
            rpm.execute(sid);
        }
        vm.warp(start - 1);
        vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.NotDue.selector, start));
        rpm.execute(sid);
        assertFalse(rpm.isDue(sid));
        assertEq(_digest(sid), d, "schedule state untouched");
        assertEq(usdc.balanceOf(payee1), payeeBal);
        assertEq(t.balance(), coreBal);
        // exactly at the boundary the very same call succeeds
        vm.warp(start);
        assertTrue(rpm.isDue(sid));
        _payOnce(sid, outsider);
    }

    function test_Sched03_UnknownScheduleIdsRevertForEveryMutator() public {
        _create(_p(payee1, AMOUNT, DAILY, _now() + 5 days));
        uint256[3] memory ids = [uint256(0), 2, type(uint256).max];
        for (uint256 i; i < ids.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.UnknownSchedule.selector, ids[i]));
            rpm.execute(ids[i]);
            vm.prank(approver1);
            vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.UnknownSchedule.selector, ids[i]));
            rpm.pause(ids[i]);
            vm.prank(approver1);
            vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.UnknownSchedule.selector, ids[i]));
            rpm.cancel(ids[i]);
            assertFalse(rpm.isDue(ids[i]));
            assertEq(rpm.nextDueAt(ids[i]), 0);
        }
    }

    // ------------------------------------------------------------ M-SCHED-04
    function test_Sched04_DailyPaysExactlyOncePerPeriodWithExactReceipts() public {
        uint64 start = _execTs() + 2 days;
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, start));
        address[4] memory by = [outsider, keeper, approver1, proposerOnly];
        for (uint256 n; n < by.length; ++n) {
            vm.warp(start + n * 1 days);
            assertEq(_payOnce(sid, by[n]), n, "period index");
            assertEq(_s(sid).nextDue, start + (n + 1) * 1 days, "anchored next due");
            assertEq(_s(sid).executedCount, n + 1);
            assertEq(usdc.balanceOf(payee1), (n + 1) * AMOUNT, "exactly one payment per period");
        }
        assertEq(uint8(_st(sid)), uint8(IRecurringPaymentModule.ScheduleStatus.Active));
    }

    function test_Sched04_WeeklyPaysOnAnchoredWeekBoundaries() public {
        uint64 start = _execTs() + 1 days;
        uint256 sid = _create(_p(payee2, AMOUNT, WEEKLY, start));
        for (uint256 n; n < 3; ++n) {
            vm.warp(start + n * 7 days);
            _payOnce(sid, keeper);
            assertEq(_s(sid).nextDue, start + (n + 1) * 7 days);
        }
        assertEq(usdc.balanceOf(payee2), 3 * AMOUNT);
    }

    function test_Sched04_MonthlyJan31AnchorPaysOnReferenceDates() public {
        uint64 start = refTs(2027, 1, 31, 9, 0, 0);
        uint256 sid = _create(_p(payee1, AMOUNT, MONTHLY, start));
        uint64[6] memory due = [
            refTs(2027, 1, 31, 9, 0, 0), refTs(2027, 2, 28, 9, 0, 0), refTs(2027, 3, 31, 9, 0, 0),
            refTs(2027, 4, 30, 9, 0, 0), refTs(2027, 5, 31, 9, 0, 0), refTs(2027, 6, 30, 9, 0, 0)
        ];
        for (uint256 n; n < 6; ++n) {
            vm.warp(due[n]);
            assertEq(_s(sid).nextDue, due[n], "stored nextDue equals the independent calendar");
            _payOnce(sid, outsider);
            if (n < 5) {
                // one second before the following boundary the schedule is not due
                vm.warp(due[n + 1] - 1);
                assertFalse(rpm.isDue(sid));
            }
        }
        assertEq(_s(sid).nextDue, refTs(2027, 7, 31, 9, 0, 0), "back to the 31st");
        assertEq(usdc.balanceOf(payee1), 6 * AMOUNT);
    }

    function test_Sched04_LateExecutionDoesNotShiftTheCalendar() public {
        uint64 start = _execTs() + 1 days;
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, start));
        vm.warp(start + 10 hours);
        _payOnce(sid, outsider);
        assertEq(_s(sid).nextDue, start + 1 days, "next due is anchored on the start, not on execution time");
        vm.warp(start + 1 days + 23 hours);
        _payOnce(sid, outsider);
        assertEq(_s(sid).nextDue, start + 2 days);
    }

    function test_Sched04_OverdueCatchUpPaysOnePeriodPerCallWithDistinctPeriodIndexes() public {
        uint64 start = _execTs() + 1 days;
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, start));
        vm.warp(start + 2 days + 1 hours); // periods 0, 1, 2 are due; within the 3-period backlog tolerance
        for (uint256 n; n < 3; ++n) assertEq(_payOnce(sid, outsider), n);
        assertEq(usdc.balanceOf(payee1), 3 * AMOUNT, "three overdue periods, three payments, no more");
        vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.NotDue.selector, start + 3 days));
        rpm.execute(sid);
    }

    // ------------------------------------------------------------ M-SCHED-05
    function test_Sched05_SecondExecuteInTheSamePeriodReverts() public {
        uint64 start = _execTs() + 1 days;
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, start));
        vm.warp(start);
        _payOnce(sid, outsider);
        bytes32 d = _digest(sid);
        address[3] memory callers = [outsider, keeper, approver2];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.NotDue.selector, start + 1 days));
            rpm.execute(sid);
        }
        vm.warp(start + 1 days - 1);
        vm.expectRevert(abi.encodeWithSelector(IRecurringPaymentModule.NotDue.selector, start + 1 days));
        rpm.execute(sid);
        assertEq(_digest(sid), d, "no state change from rejected duplicates");
        assertEq(usdc.balanceOf(payee1), AMOUNT, "paid once");
        assertEq(rpm.skippedPeriods(sid), 0);
        vm.warp(start + 1 days);
        assertEq(_payOnce(sid, outsider), 1, "next boundary pays the next period");
    }

    // ------------------------------------------------------------ M-SCHED-06
    function test_Sched06_RestrictedExecutorHonored_OutsidersProposersAndGuardianRejected() public {
        uint64 start = _execTs() + 1 days;
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, start);
        p.executor = keeper;
        uint256 sid = _create(p);
        vm.warp(start);
        bytes32 d = _digest(sid);
        address[4] memory denied = [outsider, proposerOnly, guardian, payee1];
        for (uint256 i; i < denied.length; ++i) {
            vm.prank(denied[i]);
            vm.expectRevert(IRecurringPaymentModule.Unauthorized.selector);
            rpm.execute(sid);
        }
        assertEq(_digest(sid), d, "rejected callers change nothing");
        assertEq(usdc.balanceOf(payee1), 0);
        assertEq(_payOnce(sid, keeper), 0, "designated executor pays");
        assertEq(_s(sid).executor, keeper);
    }

    function test_Sched06_EveryCurrentApproverMayAlwaysExecuteARestrictedSchedule() public {
        uint64 start = _execTs() + 3 days;
        address[3] memory approvers_ = [approver1, approver2, approver3];
        uint256[3] memory ids;
        for (uint256 i; i < 3; ++i) {
            IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, start);
            p.executor = keeper;
            ids[i] = _create(p);
        }
        vm.warp(start);
        for (uint256 i; i < 3; ++i) {
            _payOnce(ids[i], approvers_[i]);
            assertEq(_s(ids[i]).executedCount, 1);
        }
        assertEq(usdc.balanceOf(payee1), 3 * AMOUNT);
    }

    function test_Sched06_OpenModeAllowsAnyCaller() public {
        uint64 start = _execTs() + 1 days;
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, start)); // executor == address(0)
        address[5] memory callers = [outsider, proposerOnly, guardian, keeper, payee1];
        for (uint256 i; i < callers.length; ++i) {
            vm.warp(start + i * 1 days);
            assertEq(_payOnce(sid, callers[i]), i);
        }
    }

    function test_Sched06_ApproverStatusIsCurrentNotASnapshot() public {
        uint64 start = _execTs() + 5 days;
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, start);
        p.executor = keeper;
        uint256 sid = _create(p);
        address approver4 = makeAddr("approver4");
        _govPass(_govConfig(_arr(approver1, approver2, approver4), guardian));
        assertFalse(t.isApprover(approver3));
        vm.warp(start);
        vm.prank(approver3);
        vm.expectRevert(IRecurringPaymentModule.Unauthorized.selector);
        rpm.execute(sid);
        assertEq(_payOnce(sid, approver4), 0, "newly seated approver may execute");
    }
}
