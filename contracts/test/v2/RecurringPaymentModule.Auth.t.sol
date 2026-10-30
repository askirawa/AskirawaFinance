// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {RpmP2Base} from "./RecurringPaymentModule.P2Base.t.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {RecurringPaymentModule} from "../../v2/RecurringPaymentModule.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";
import {V2ReentrantToken} from "./mocks/V2ReentrantToken.sol";
import {V2PlainContract} from "./mocks/V2ConfigurableModule.sol";
import {V2HostileExecutor, V2Forwarder} from "./mocks/V2HostileExecutor.sol";

/// @notice Executor / authority model (module design section 4), S-REENT for the module, and the budget caps
/// that only the CORE enforces (tiny window, disabled module, core pause, codehash swap).
contract RecurringPaymentModuleAuthTest is RpmP2Base {
    bytes4 internal constant REENT = 0x3ee5aeb5; // ReentrancyGuardReentrantCall()
    V2ReentrantToken internal rtok;

    // ------------------------------------------------------------ restricted executor cannot be bypassed
    function test_Auth_RestrictedExecutorCannotBeBypassedByAnyOutsiderRoute() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.executor = keeper;
        uint256 sid = _create(p);
        bytes32 d = _digest(sid);
        V2Forwarder fw = new V2Forwarder();
        // contract intermediary: msg.sender at the module is the forwarder, whatever tx.origin is
        vm.prank(outsider, keeper); // tx.origin == the designated executor must not matter
        vm.expectRevert(IRPM.Unauthorized.selector);
        fw.go(address(rpm), sid);
        vm.prank(outsider, approver1); // tx.origin == an approver must not matter
        vm.expectRevert(IRPM.Unauthorized.selector);
        fw.go(address(rpm), sid);
        address[7] memory denied = [outsider, payee1, guardian, proposerOnly, address(rpm), address(t), address(fw)];
        for (uint256 i; i < denied.length; ++i) {
            vm.prank(denied[i]);
            vm.expectRevert(IRPM.Unauthorized.selector);
            rpm.execute(sid);
        }
        assertEq(_digest(sid), d);
        assertEq(usdc.balanceOf(payee1), 0);
        // the dueSchedules view applies the same rule
        assertEq(rpm.dueSchedules(0, 10).length, 0, "a stranger's keeper query does not list it");
        vm.prank(keeper);
        assertEq(rpm.dueSchedules(0, 10).length, 1);
    }

    function test_Auth_ExecutorHasNoOtherPowersAndCannotSteerThePayment() public {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.executor = keeper;
        uint256 sid = _create(p);
        vm.startPrank(keeper);
        vm.expectRevert(IRPM.Unauthorized.selector);
        rpm.pause(sid);
        vm.expectRevert(IRPM.Unauthorized.selector);
        rpm.cancel(sid);
        vm.expectRevert(IRPM.OnlyTreasury.selector);
        rpm.onApproved(1, CREATE, abi.encode(_p(keeper, AMOUNT, DAILY, 0)));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, keeper));
        t.payFromModule(keeper, AMOUNT, bytes32(0));
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposePayroll(_pay(keeper, AMOUNT), _exp(), MEMO);
        vm.stopPrank();
        // the one thing the executor can do pays exactly the stored recipient and amount
        uint256 coreBal = t.balance();
        _payOnce(sid, keeper);
        assertEq(usdc.balanceOf(keeper), 0, "the executor never receives funds");
        assertEq(usdc.balanceOf(payee1), AMOUNT);
        assertEq(coreBal - t.balance(), AMOUNT);
        assertEq(_s(sid).recipient, payee1);
        assertEq(_s(sid).amount, AMOUNT);
    }

    // ------------------------------------------------------------ hostile executor contract (S-REENT, module side)
    function _useReentrantCore() internal {
        rtok = new V2ReentrantToken();
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        t = new AskirawaTreasury(address(rtok), MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum,
            c.guardian, c.payrollDelay, c.configDelay, address(_newRecovery()));
        rpm = new RecurringPaymentModule(address(t), RETRY_DELAY, MAX_FAILURES);
        rtok.mint(address(t), TREASURY_FUNDS);
        _configureRpm(true, RPM_PER_TX, RPM_WINDOW_MAX, RPM_WINDOW_LEN);
    }

    function _hostileRound(V2HostileExecutor h, uint256 sid, uint256 period, uint96 totalAfter) internal {
        rtok.arm(address(h), abi.encodeCall(V2HostileExecutor.onHook, ()), true, false, _fireAfter);
        uint64 dueAt = _s(sid).nextDue;
        uint256 payee = rtok.balanceOf(payee1);
        uint256 coreBal = rtok.balanceOf(address(t));
        vm.recordLogs();
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.ModulePaid(address(rpm), payee1, AMOUNT, _ref(sid, period));
        vm.expectEmit(true, true, true, true, address(rpm));
        emit IRPM.ScheduleExecuted(sid, period, payee1, AMOUNT, dueAt, _now(), address(h), totalAfter);
        h.run(address(rpm), sid);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 executed;
        uint256 paid;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(rpm) && logs[i].topics[0] == IRPM.ScheduleExecuted.selector) ++executed;
            if (logs[i].emitter == address(t) && logs[i].topics[0] == AskirawaTreasury.ModulePaid.selector) ++paid;
        }
        assertEq(executed, 1, "exactly one receipt");
        assertEq(paid, 1, "exactly one core payment");
        assertEq(rtok.balanceOf(payee1), payee + AMOUNT, "stored recipient got the stored amount");
        assertEq(rtok.balanceOf(address(t)), coreBal - AMOUNT, "treasury paid it once");
        assertEq(rtok.balanceOf(address(h)), 0, "executor got nothing");
        assertEq(rtok.balanceOf(address(rpm)), 0, "module never holds funds");
    }

    bool internal _fireAfter;

    function _assertAllReentriesBlocked(V2HostileExecutor h, uint256 runs) internal view {
        assertEq(h.hookRuns(), runs, "the hook really fired inside the payment");
        (bool ok, bytes4 err) = h.viaExecute();
        assertFalse(ok); assertEq(err, REENT, "re-entering execute");
        (ok, err) = h.viaOnApproved();
        assertFalse(ok); assertEq(err, REENT, "re-entering onApproved");
        (ok, err) = h.viaPay();
        assertFalse(ok); assertEq(err, REENT, "re-entering payFromModule");
        (ok, err) = h.viaFund();
        assertFalse(ok); assertEq(err, REENT, "re-entering fundModule");
        (ok, err) = h.viaCoreExecute();
        assertFalse(ok); assertEq(err, REENT, "re-entering core execute");
        (ok, err) = h.viaPause();
        assertFalse(ok); assertEq(err, REENT, "re-entering core pause");
    }

    function _hostile(bool fireAfter) internal {
        _fireAfter = fireAfter;
        _useReentrantCore();
        V2HostileExecutor h = new V2HostileExecutor();
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs());
        p.executor = address(h);
        uint256 sid = _create(p);
        h.setTargets(address(t), address(rpm), sid);
        uint64 start = _s(sid).startTime;
        vm.prank(outsider);
        vm.expectRevert(IRPM.Unauthorized.selector);
        rpm.execute(sid);

        _hostileRound(h, sid, 0, AMOUNT);
        _assertAllReentriesBlocked(h, 1);
        assertEq(_s(sid).executedCount, 1);
        assertEq(_s(sid).totalPaid, AMOUNT);
        // the executor tries again in the same period: nothing more can be pulled
        vm.expectRevert(abi.encodeWithSelector(IRPM.NotDue.selector, start + 1 days));
        h.run(address(rpm), sid);
        // next period behaves identically
        vm.warp(start + 1 days);
        _hostileRound(h, sid, 1, 2 * AMOUNT);
        _assertAllReentriesBlocked(h, 2); // the hook counter is cumulative
        assertEq(rtok.balanceOf(payee1), 2 * AMOUNT);
        assertEq(rtok.balanceOf(address(h)), 0);
    }

    function test_Reent_HostileExecutorReenteringBeforeTheTransferCannotDoubleOrRedirectAPayment() public {
        _hostile(false);
    }

    function test_Reent_HostileExecutorReenteringAfterTheTransferCannotDoubleOrRedirectAPayment() public {
        _hostile(true);
    }

    // ------------------------------------------------------------ budget caps enforced by the core
    function test_Core_TinyWindowMaxStopsAValidScheduleWithBudgetFailuresAndRaisingItResumesPaying() public {
        _configureRpm(true, AMOUNT, AMOUNT, 30 days); // room for exactly one payment per 30 days
        uint256 sid = _mkDaily();
        uint64 start = _s(sid).startTime;
        assertEq(_payOnce(sid, outsider), 0);
        vm.warp(start + 1 days);
        for (uint256 i; i < MAX_FAILURES; ++i) {
            if (i != 0) vm.warp(_s(sid).nextRetryAt);
            _failOnce(sid, outsider, R_BUDGET);
        }
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(usdc.balanceOf(payee1), AMOUNT, "the cap held");
        assertEq(_s(sid).executedCount, 1, "the schedule terms were never the problem");
        // governance raises the cap; quorum resumes; payments flow again
        _configureRpm(true, AMOUNT, 10 * AMOUNT, 30 days);
        _resume(sid, true);
        vm.warp(_s(sid).nextDue);
        uint256 period = _payOnce(sid, outsider);
        assertEq(period, uint256(_s(sid).executedCount) - 1 + rpm.skippedPeriods(sid));
        assertEq(usdc.balanceOf(payee1), 2 * AMOUNT);
    }

    function test_Core_PerCallLimitLoweredBelowTheScheduleAmountIsABudgetFailure() public {
        uint256 sid = _mkDaily();
        _configureRpm(true, AMOUNT - 1, RPM_WINDOW_MAX, RPM_WINDOW_LEN);
        _failOnce(sid, outsider, R_BUDGET);
        assertEq(usdc.balanceOf(payee1), 0);
    }

    function test_Core_DisablingTheModuleStopsPaymentsAndReEnablingResumesThem() public {
        uint256 sid = _mkDaily();
        _configureRpm(false, RPM_PER_TX, RPM_WINDOW_MAX, RPM_WINDOW_LEN);
        assertEq(t.moduleSpendRemaining(address(rpm)), 0);
        _failOnce(sid, outsider, R_OTHER); // ModuleDisabled(module) is an unknown selector to the module
        assertEq(usdc.balanceOf(payee1), 0);
        assertEq(_s(sid).executedCount, 0);
        _configureRpm(true, RPM_PER_TX, RPM_WINDOW_MAX, RPM_WINDOW_LEN);
        vm.warp(_s(sid).nextRetryAt);
        _payOnce(sid, outsider);
        assertEq(usdc.balanceOf(payee1), AMOUNT);
    }

    function test_Core_PausingTheCoreStopsEveryScheduleAtOnce() public {
        uint256 s1 = _mkDaily();
        uint256 s2 = _create(_p(payee2, AMOUNT, DAILY, _execTs()));
        _pause();
        _failOnce(s2, outsider, R_PAUSED);
        _failOnce(s1, keeper, R_PAUSED);
        assertEq(usdc.balanceOf(payee1) + usdc.balanceOf(payee2), 0);
    }

    function test_Core_CodehashSwapStopsPaymentsAndRestoringTheCodeResumesThem() public {
        uint256 sid = _mkDaily();
        bytes memory orig = address(rpm).code;
        // behaviourally identical module (trailing unreachable byte) but a different runtime hash
        vm.etch(address(rpm), bytes.concat(orig, hex"00"));
        _failOnce(sid, outsider, R_OTHER); // core reverts ModuleCodeChanged
        vm.etch(address(rpm), orig);
        vm.warp(_s(sid).nextRetryAt);
        _payOnce(sid, outsider);
    }

    function test_Core_ReplacedModuleCodeCannotDrawOrFundDirectly() public {
        bytes memory orig = address(rpm).code;
        vm.etch(address(rpm), type(V2PlainContract).runtimeCode);
        vm.startPrank(address(rpm));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCodeChanged.selector, address(rpm)));
        t.payFromModule(payee1, AMOUNT, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCodeChanged.selector, address(rpm)));
        t.fundModule(AMOUNT, bytes32(0));
        vm.stopPrank();
        assertEq(t.moduleSpendRemaining(address(rpm)), 0);
        vm.etch(address(rpm), orig);
        assertEq(t.moduleSpendRemaining(address(rpm)), RPM_WINDOW_MAX);
    }

    // ------------------------------------------------------------ duplicate execution (fuzz)
    function testFuzz_EachPeriodIsPaidAtMostOnceUnderRandomWarpsAndCallers(uint256 seed) public {
        uint64 start = _now() + 10 days;
        IRPM.ScheduleParams memory p1 = _p(payee1, AMOUNT, DAILY, start);
        IRPM.ScheduleParams memory p2 = _p(payee2, AMOUNT, WEEKLY, start);
        IRPM.ScheduleParams memory p3 = _p(payeeA, AMOUNT, DAILY, start);
        p3.executor = keeper;
        _create(p1);
        _create(p2);
        _create(p3);
        vm.warp(start);
        address[6] memory callers = [outsider, keeper, approver1, payee1, proposerOnly, address(uint160(seed))];
        vm.recordLogs();
        for (uint256 i; i < 48; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 mode = r % 6;
            if (mode == 1) vm.warp(_now() + 1 + (r >> 8) % 3600);
            else if (mode == 2) vm.warp(_now() + 6 hours);
            else if (mode == 3) vm.warp(_now() + 1 days);
            else if (mode == 4) vm.warp(_now() + (r >> 8) % 30 hours);
            if ((r >> 60) % 9 == 0) usdc.setBlocked(payee1, !usdc.blocked(payee1));
            _tryRun(1 + (r >> 20) % 3, callers[(r >> 40) % 6]);
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256[4] memory cnt;
        uint256 coreReceipts;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(t) && logs[i].topics[0] == AskirawaTreasury.ModulePaid.selector) ++coreReceipts;
            if (logs[i].emitter != address(rpm) || logs[i].topics[0] != IRPM.ScheduleExecuted.selector) continue;
            uint256 id = uint256(logs[i].topics[1]);
            (uint256 period,,,,) = abi.decode(logs[i].data, (uint256, uint96, uint64, uint64, uint96));
            assertEq(period, cnt[id], "every period is paid exactly once, in order");
            ++cnt[id];
        }
        uint256 total = cnt[1] + cnt[2] + cnt[3];
        assertEq(coreReceipts, total, "one core payment per receipt");
        assertEq(usdc.balanceOf(payee1), cnt[1] * AMOUNT);
        assertEq(usdc.balanceOf(payee2), cnt[2] * AMOUNT);
        assertEq(usdc.balanceOf(payeeA), cnt[3] * AMOUNT);
        uint256 elapsed = _now() - start;
        assertLe(cnt[1], elapsed / 1 days + 1, "never ahead of the calendar");
        assertLe(cnt[2], elapsed / 7 days + 1);
        assertLe(cnt[3], elapsed / 1 days + 1);
        for (uint256 id = 1; id <= 3; ++id) {
            assertEq(_s(id).executedCount, cnt[id]);
            assertEq(_s(id).totalPaid, cnt[id] * AMOUNT);
        }
    }
}
