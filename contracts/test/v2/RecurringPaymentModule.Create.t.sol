// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RecurringPaymentModuleTestBase} from "./RecurringPaymentModule.Base.t.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {IRecurringPaymentModule} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice M-SCHED-01 (creation only via approved proposal), M-SCHED-02 (field validation),
/// M-SCHED-11 (past start clamps to the proposal execution time).
contract RecurringPaymentModuleCreateTest is RecurringPaymentModuleTestBase {
    // ------------------------------------------------------------ helpers
    /// @dev Proposes, reaches quorum, and asserts the callback revert and that nothing was created.
    function _expectCreateRevert(IRecurringPaymentModule.ScheduleParams memory p, bytes memory inner) internal {
        uint256 before = rpm.scheduleCount();
        uint256 pid = _proposeCreate(p);
        _expectCallbackRevert(pid, inner);
        assertEq(rpm.scheduleCount(), before, "failed callback must not create a schedule");
        assertTrue(_status(pid) != AskirawaTreasury.ProposalStatus.Executed, "proposal must not be Executed");
    }

    function _rawParams(address to, uint96 amount, uint8 freq, uint64 start) internal pure returns (bytes memory) {
        return abi.encode(to, amount, freq, start, uint64(0), uint32(0), uint96(0), uint96(0), address(0), bytes32(0));
    }

    // ------------------------------------------------------------ M-SCHED-01
    function test_Sched01_CreateStoresEveryApprovedTermAndEmitsScheduleCreated() public {
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, WEEKLY, _now() + 10 days);
        p.endTime = _now() + 300 days;
        p.maxExecutions = 12;
        p.maxTotal = 5_000e6;
        p.minTreasuryBalanceAfter = 7e6;
        p.executor = keeper;
        p.memoRef = keccak256("PLACEHOLDER_INVOICE");
        uint256 pid = _proposeCreate(p);
        _reachQuorum(pid);
        assertEq(rpm.scheduleCount(), 0, "approval alone creates nothing");
        _warpToExecutable(pid);
        assertEq(rpm.scheduleCount(), 0, "delay elapsed alone creates nothing");

        vm.expectEmit(true, true, true, true, address(rpm));
        emit IRecurringPaymentModule.ScheduleCreated(
            1, pid, payee1, AMOUNT, WEEKLY, p.startTime, p.startTime, p.endTime, 12, 5_000e6, 7e6, keeper, p.memoRef
        );
        _exec(pid);

        assertEq(rpm.scheduleCount(), 1);
        IRecurringPaymentModule.Schedule memory s = _s(1);
        assertEq(s.recipient, payee1);
        assertEq(s.amount, AMOUNT);
        assertEq(uint8(s.frequency), uint8(WEEKLY));
        assertEq(s.startTime, p.startTime);
        assertEq(s.nextDue, p.startTime);
        assertEq(s.nextRetryAt, 0);
        assertEq(s.endTime, p.endTime);
        assertEq(uint8(s.status), uint8(IRecurringPaymentModule.ScheduleStatus.Active));
        assertEq(s.executedCount, 0);
        assertEq(s.maxExecutions, 12);
        assertEq(s.failures, 0);
        assertEq(s.totalPaid, 0);
        assertEq(s.maxTotal, 5_000e6);
        assertEq(s.minTreasuryBalanceAfter, 7e6);
        assertEq(s.executor, keeper);
        assertEq(s.createdByProposal, pid);
        assertEq(s.memoRef, p.memoRef);
        assertEq(rpm.skippedPeriods(1), 0);
        assertEq(rpm.nextScheduleId(), 2);
    }

    function test_Sched01_IdsAreSequentialStartAtOneAndNeverReused() public {
        assertEq(rpm.scheduleCount(), 0);
        uint256 pid1 = _proposeCreate(_p(payee1, AMOUNT, DAILY, _now() + 5 days));
        _pass(pid1);
        uint256 pid2 = _proposeCreate(_p(payee2, AMOUNT * 2, MONTHLY, _now() + 5 days));
        _pass(pid2);
        assertEq(rpm.scheduleCount(), 2);
        assertEq(_s(1).recipient, payee1);
        assertEq(_s(2).recipient, payee2);
        assertEq(_s(1).createdByProposal, pid1);
        assertEq(_s(2).createdByProposal, pid2);
        // a failed creation in between does not burn or shift an id
        IRecurringPaymentModule.ScheduleParams memory bad = _p(address(0), AMOUNT, DAILY, _now() + 5 days);
        _expectCreateRevert(bad, abi.encodeWithSelector(IRecurringPaymentModule.InvalidRecipient.selector, address(0)));
        assertEq(_create(_p(payeeA, AMOUNT, DAILY, _now() + 5 days)), 3);
        assertEq(rpm.getSchedule(4).recipient, address(0), "id 4 unassigned");
    }

    function test_Sched01_OnApprovedFromAnyoneButTheTreasuryReverts() public {
        bytes memory data = abi.encode(_p(payee1, AMOUNT, DAILY, _now() + 5 days));
        address[6] memory callers = [outsider, approver1, guardian, keeper, address(this), address(rpm)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(IRecurringPaymentModule.OnlyTreasury.selector);
            rpm.onApproved(1, CREATE, data);
        }
        // the restriction precedes action decoding: even an unknown code reports OnlyTreasury
        vm.prank(approver2);
        vm.expectRevert(IRecurringPaymentModule.OnlyTreasury.selector);
        rpm.onApproved(1, 99, data);
        assertEq(rpm.scheduleCount(), 0, "nothing was created");
    }

    function test_Sched01_UnknownActionCodeRevertsThroughTheCore() public {
        bytes memory data = abi.encode(_p(payee1, AMOUNT, DAILY, _now() + 5 days));
        // 3 is ACTION_RECOVER_FUNDS now; the first unassigned code is 4
        uint256 pid = _proposeRaw(4, data);
        _expectCallbackRevert(pid, abi.encodeWithSelector(IRecurringPaymentModule.UnknownAction.selector, uint8(4)));
        pid = _proposeRaw(255, data);
        _expectCallbackRevert(pid, abi.encodeWithSelector(IRecurringPaymentModule.UnknownAction.selector, uint8(255)));
        pid = _proposeRaw(0, data);
        _expectCallbackRevert(pid, abi.encodeWithSelector(IRecurringPaymentModule.UnknownAction.selector, uint8(0)));
        assertEq(rpm.scheduleCount(), 0);
    }

    // ------------------------------------------------------------ M-SCHED-02 validation of every field
    function test_Sched02_RecipientZeroTreasuryOrModuleRejected() public {
        address[3] memory bad = [address(0), address(t), address(rpm)];
        for (uint256 i; i < bad.length; ++i) {
            _expectCreateRevert(
                _p(bad[i], AMOUNT, DAILY, _now() + 5 days),
                abi.encodeWithSelector(IRecurringPaymentModule.InvalidRecipient.selector, bad[i])
            );
        }
        // any other recipient (here a contract: the mock USDC) is accepted at creation
        assertEq(_s(_create(_p(address(usdc), AMOUNT, DAILY, _now() + 5 days))).recipient, address(usdc));
    }

    function test_Sched02_AmountZeroAndAbovePerTxMaxRejectedAtBoundary() public {
        _expectCreateRevert(
            _p(payee1, 0, DAILY, _now() + 5 days),
            abi.encodeWithSelector(IRecurringPaymentModule.InvalidAmount.selector, uint96(0), RPM_PER_TX)
        );
        _expectCreateRevert(
            _p(payee1, RPM_PER_TX + 1, DAILY, _now() + 5 days),
            abi.encodeWithSelector(IRecurringPaymentModule.InvalidAmount.selector, RPM_PER_TX + 1, RPM_PER_TX)
        );
        uint256 sid = _create(_p(payee1, RPM_PER_TX, DAILY, _now() + 5 days));
        assertEq(_s(sid).amount, RPM_PER_TX, "amount == perTxMax is accepted");
        uint256 sid2 = _create(_p(payee1, 1, DAILY, _now() + 5 days));
        assertEq(_s(sid2).amount, 1, "one raw unit is accepted");
    }

    function test_Sched02_AmountLimitFollowsTheCurrentCoreBudget() public {
        _configureRpm(true, 500e6, RPM_WINDOW_MAX, RPM_WINDOW_LEN);
        _expectCreateRevert(
            _p(payee1, 600e6, DAILY, _now() + 5 days),
            abi.encodeWithSelector(IRecurringPaymentModule.InvalidAmount.selector, uint96(600e6), uint96(500e6))
        );
        assertEq(_s(_create(_p(payee1, 500e6, DAILY, _now() + 5 days))).amount, 500e6);
    }

    function test_Sched02_StartMoreThan366DaysOutRejected_ExactlyAtLimitAccepted() public {
        uint64 limit = _execTs() + 366 days;
        _expectCreateRevert(
            _p(payee1, AMOUNT, DAILY, limit + 1), abi.encodeWithSelector(IRecurringPaymentModule.InvalidScheduleParameters.selector)
        );
        limit = _execTs() + 366 days;
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, limit));
        assertEq(_s(sid).startTime, limit, "start exactly 366 days out is kept");
        assertEq(_s(sid).nextDue, limit);
    }

    function test_Sched02_EndTimeNotAfterStartRejected_OneSecondAfterAccepted() public {
        uint64 start = _now() + 20 days;
        bytes memory err = abi.encodeWithSelector(IRecurringPaymentModule.InvalidScheduleParameters.selector);
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, start);
        p.endTime = start; // equal
        _expectCreateRevert(p, err);
        p.endTime = start - 1; // before
        _expectCreateRevert(p, err);
        p.endTime = start + 1;
        uint256 sid = _create(p);
        assertEq(_s(sid).endTime, start + 1);
    }

    function test_Sched02_EndTimeCheckedAgainstEffectiveStartNotRequestedStart() public {
        bytes memory err = abi.encodeWithSelector(IRecurringPaymentModule.InvalidScheduleParameters.selector);
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, 1); // past -> clamps to exec time
        p.endTime = _execTs(); // equals the effective start
        _expectCreateRevert(p, err);
        p.endTime = _execTs() - 1; // after requested start (1), before effective start
        _expectCreateRevert(p, err);
        p.endTime = _execTs() + 1;
        uint64 expectedStart = _execTs();
        uint256 sid = _create(p);
        assertEq(_s(sid).startTime, expectedStart);
    }

    function test_Sched02_MaxTotalBelowAmountRejected_EqualAndZeroAccepted() public {
        bytes memory err = abi.encodeWithSelector(IRecurringPaymentModule.InvalidScheduleParameters.selector);
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _now() + 5 days);
        p.maxTotal = AMOUNT - 1;
        _expectCreateRevert(p, err);
        p.maxTotal = AMOUNT;
        assertEq(_s(_create(p)).maxTotal, AMOUNT, "maxTotal == amount accepted");
        p.maxTotal = 0;
        assertEq(_s(_create(p)).maxTotal, 0, "zero means unlimited");
    }

    function test_Sched02_BadFrequencyRejectedAtAbiDecoding() public {
        uint64 start = _now() + 5 days;
        uint256 pid = _proposeRaw(CREATE, _rawParams(payee1, AMOUNT, 3, start));
        _expectCallbackRevert(pid, ""); // enum decode failure carries no revert data
        pid = _proposeRaw(CREATE, _rawParams(payee1, AMOUNT, 255, start));
        _expectCallbackRevert(pid, "");
        assertEq(rpm.scheduleCount(), 0);
        // the same raw encoding with every valid ordinal is accepted (proves the encoding itself is right)
        for (uint8 f; f < 3; ++f) {
            _pass(_proposeRaw(CREATE, _rawParams(payee1, AMOUNT, f, _now() + 5 days)));
            assertEq(uint8(_s(rpm.scheduleCount()).frequency), f);
        }
    }

    function test_Sched02_ShortOrGarbageDataRejected() public {
        uint256 pid = _proposeRaw(CREATE, hex"c0ffee");
        _reachQuorum(pid);
        _warpToExecutable(pid);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCallbackFailed.selector, pid, bytes("")));
        _exec(pid);
        assertEq(rpm.scheduleCount(), 0);
    }

    // ------------------------------------------------------------ M-SCHED-11 past start clamps to the execution time
    function test_Sched11_PastStartClampsToExecutionTimeAndIsImmediatelyDue() public {
        uint64 requested = _now() - 3 days; // already in the past at proposal time
        uint64 execAt = _execTs();
        uint256 pid = _proposeCreate(_p(payee1, AMOUNT, DAILY, requested));
        _reachQuorum(pid);
        _warpToExecutable(pid);
        assertEq(_now(), execAt, "execution time as predicted");
        vm.expectEmit(true, true, true, true, address(rpm));
        emit IRecurringPaymentModule.ScheduleCreated(
            1, pid, payee1, AMOUNT, DAILY, requested, execAt, 0, 0, 0, 0, address(0), bytes32(0)
        );
        _exec(pid);
        assertEq(_s(1).startTime, execAt, "effective start = execution time");
        assertEq(_s(1).nextDue, execAt);
        assertTrue(rpm.isDue(1), "due in the creation block");
        _run(1, outsider);
        assertEq(_s(1).executedCount, 1);
        assertEq(_s(1).nextDue, execAt + 1 days, "next period anchored on the clamped start");
    }

    function test_Sched11_StartZeroOneAndRequestTimeAllClamp() public {
        uint64[3] memory starts = [uint64(0), uint64(1), _now()];
        for (uint256 i; i < starts.length; ++i) {
            uint64 execAt = _execTs();
            uint256 sid = _create(_p(payee1, AMOUNT, WEEKLY, starts[i]));
            assertEq(_s(sid).startTime, execAt);
            assertEq(_s(sid).nextDue, execAt);
        }
    }

    function test_Sched11_StartExactlyAtExecutionTimeAndFutureStartAreNotChanged() public {
        uint64 execAt = _execTs();
        assertEq(_s(_create(_p(payee1, AMOUNT, DAILY, execAt))).startTime, execAt);
        uint64 future = _execTs() + 1;
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, future));
        assertEq(_s(sid).startTime, future);
        assertFalse(rpm.isDue(sid), "future start is not due");
    }

    function test_Sched11_MonthlyAnchorDayAndTimeComeFromTheExecutionMoment() public {
        // proposal at 2027-03-30 10:20:30 -> execution (after the 1-day delay) at 2027-03-31 10:20:30
        vm.warp(refTs(2027, 3, 30, 10, 20, 30));
        uint64 execAt = _execTs();
        assertEq(execAt, refTs(2027, 3, 31, 10, 20, 30));
        uint256 sid = _create(_p(payee1, AMOUNT, MONTHLY, refTs(2027, 3, 1, 0, 0, 0)));
        assertEq(_s(sid).startTime, execAt, "anchor is the execution moment, not the requested day");
        _run(sid, keeper);
        assertEq(_s(sid).nextDue, refTs(2027, 4, 30, 10, 20, 30), "clamped to April 30, same time of day");
        vm.warp(_s(sid).nextDue);
        _run(sid, keeper);
        assertEq(_s(sid).nextDue, refTs(2027, 5, 31, 10, 20, 30), "back to the 31st, no clamp accumulation");
        assertEq(_s(sid).executedCount, 2);
    }

    function testFuzz_Sched11_AnyNonFutureStartClampsToExecutionTime(uint64 raw) public {
        uint64 execAt = _execTs();
        uint64 requested = uint64(bound(raw, 0, execAt));
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, requested));
        assertEq(_s(sid).startTime, execAt);
        assertEq(_s(sid).nextDue, execAt);
    }

    function testFuzz_Sched11_FutureStartWithinRangeIsKept(uint256 raw) public {
        uint64 execAt = _execTs();
        uint64 requested = uint64(bound(raw, uint256(execAt) + 1, uint256(execAt) + 366 days));
        uint256 sid = _create(_p(payee1, AMOUNT, WEEKLY, requested));
        assertEq(_s(sid).startTime, requested);
        assertEq(_s(sid).nextDue, requested);
    }
}
