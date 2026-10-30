// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {RpmP2Base} from "./RecurringPaymentModule.P2Base.t.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice S-FAIL-01..08: soft failures, retry gating, auto-pause, recovery, failure classes, spam resistance.
contract RecurringPaymentModuleFailTest is RpmP2Base {
    // ------------------------------------------------------------ S-FAIL-01
    function test_SFail01_EmptyTreasurySoftFailsWithInsufficientBalanceAndNoStateChange() public {
        uint256 sid = _mkDaily();
        _drain();
        bytes32 before_ = _digest(sid);
        uint64 t0 = _now();
        _failOnce(sid, outsider, R_INSUFFICIENT); // asserts executedCount / totalPaid / calendar / balances
        IRPM.Schedule memory a = _s(sid);
        assertEq(a.executedCount, 0);
        assertEq(a.totalPaid, 0);
        assertEq(a.failures, 1);
        assertEq(a.nextRetryAt, t0 + RETRY_DELAY);
        assertEq(uint8(a.status), uint8(IRPM.ScheduleStatus.Active), "one failure does not pause");
        assertTrue(_digest(sid) != before_, "only failure bookkeeping changed");
        assertFalse(rpm.isDue(sid), "retry gate closes isDue");
    }

    function test_SFail01_AnyCallerKindRecordsTheSameFailureClass() public {
        address[3] memory callers = [outsider, keeper, approver1];
        for (uint256 i; i < callers.length; ++i) {
            uint256 sid = _mkDaily();
            _drain();
            _failOnce(sid, callers[i], R_INSUFFICIENT);
        }
    }

    // ------------------------------------------------------------ S-FAIL-02
    function test_SFail02_RetryRevertsBeforeNextRetryAtForEveryCaller() public {
        uint256 sid = _mkDaily();
        _drain();
        _failOnce(sid, outsider, R_INSUFFICIENT);
        uint64 retryAt = _s(sid).nextRetryAt;
        bytes32 d = _digest(sid);
        address[3] memory callers = [outsider, keeper, approver2];
        uint64[3] memory at = [_now(), retryAt - 3 hours, retryAt - 1];
        for (uint256 i; i < 3; ++i) {
            vm.warp(at[i]);
            assertFalse(rpm.isDue(sid));
            vm.expectRevert(abi.encodeWithSelector(IRPM.RetryNotReady.selector, retryAt));
            _run(sid, callers[i]);
        }
        assertEq(_digest(sid), d, "rejected retries change nothing");
    }

    function test_SFail02_AtTheExactRetrySecondTheRetrySucceedsOnceFunded() public {
        uint256 sid = _mkDaily();
        _drain();
        _failOnce(sid, outsider, R_INSUFFICIENT);
        uint64 retryAt = _s(sid).nextRetryAt;
        _fund(10 * AMOUNT);
        vm.warp(retryAt - 1);
        vm.expectRevert(abi.encodeWithSelector(IRPM.RetryNotReady.selector, retryAt));
        _run(sid, outsider);
        vm.warp(retryAt);
        assertTrue(rpm.isDue(sid));
        assertEq(_payOnce(sid, outsider), 0, "same calendar period as the failed attempt");
        assertEq(usdc.balanceOf(payee1), AMOUNT);
    }

    function test_SFail02_AtTheExactRetrySecondAStillFailingPaymentRecordsAnotherFailure() public {
        uint256 sid = _mkDaily();
        _drain();
        _failOnce(sid, outsider, R_INSUFFICIENT);
        vm.warp(_s(sid).nextRetryAt);
        _failOnce(sid, keeper, R_INSUFFICIENT);
        assertEq(_s(sid).failures, 2);
    }

    // ------------------------------------------------------------ S-FAIL-03
    function test_SFail03_AutoPausesAfterMaxFailuresWithFailuresReason() public {
        uint256 sid = _mkDaily();
        _drain();
        for (uint256 i; i < MAX_FAILURES; ++i) {
            if (i != 0) vm.warp(_s(sid).nextRetryAt);
            assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Active), "active until the last failure");
            _failOnce(sid, outsider, R_INSUFFICIENT); // the last one also expects ScheduleAutoPaused(FAILURES)
        }
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(_s(sid).failures, MAX_FAILURES);
        assertFalse(rpm.isDue(sid));
        vm.warp(_now() + 30 days);
        vm.expectRevert(abi.encodeWithSelector(IRPM.InvalidStatus.selector, sid, IRPM.ScheduleStatus.Paused));
        _run(sid, outsider);
        assertEq(_s(sid).failures, MAX_FAILURES, "no failure counted while paused");
    }

    // ------------------------------------------------------------ S-FAIL-04
    function test_SFail04_DepositThenRetrySucceedsAndResetsFailuresAndRetryGate() public {
        uint256 sid = _mkDaily();
        _drain();
        _failOnce(sid, outsider, R_INSUFFICIENT);
        vm.warp(_s(sid).nextRetryAt);
        _failOnce(sid, outsider, R_INSUFFICIENT);
        assertEq(_s(sid).failures, 2);
        _fund(AMOUNT);
        vm.warp(_s(sid).nextRetryAt);
        assertEq(_payOnce(sid, keeper), 0);
        IRPM.Schedule memory a = _s(sid);
        assertEq(a.failures, 0, "failures reset");
        assertEq(a.nextRetryAt, 0, "retry gate cleared");
        assertEq(a.executedCount, 1);
        assertEq(uint8(a.status), uint8(IRPM.ScheduleStatus.Active));
    }

    // ------------------------------------------------------------ S-FAIL-05
    function test_SFail05_RecipientBlockedByUsdcIsClassifiedTokenRevert() public {
        uint256 sid = _mkDaily();
        usdc.setBlocked(payee1, true);
        _failOnce(sid, outsider, R_TOKEN);
        // the failed draw leaves no trace in the core budget (asserted inside _failOnce); lifting the block recovers
        usdc.setBlocked(payee1, false);
        vm.warp(_s(sid).nextRetryAt);
        assertEq(_payOnce(sid, outsider), 0);
    }

    // ------------------------------------------------------------ S-FAIL-06
    function test_SFail06_GloballyPausedUsdcIsClassifiedTokenRevert() public {
        uint256 sid = _mkDaily();
        usdc.setGlobalPause(true);
        _failOnce(sid, outsider, R_TOKEN);
        usdc.setGlobalPause(false);
        vm.warp(_s(sid).nextRetryAt);
        assertEq(_payOnce(sid, outsider), 0);
    }

    function test_SFail06_CorePausedIsClassifiedPausedAndRecoversAfterUnpause() public {
        uint256 sid = _mkDaily();
        _pause();
        _failOnce(sid, outsider, R_PAUSED);
        _unpausePass(); // warps past the retry gate (config delay 2 days)
        assertGe(_now(), _s(sid).nextRetryAt);
        assertEq(_payOnce(sid, outsider), 0);
    }

    // ------------------------------------------------------------ S-FAIL-07
    function test_SFail07_BudgetExhaustedMidWindowIsClassifiedBudgetThenNextWindowPays() public {
        _configureRpm(true, AMOUNT, 250e6, 1 days); // two payments fit one window, the third does not
        uint64 start = _now() + 10 days;
        uint256 s1 = _create(_p(payee1, AMOUNT, DAILY, start));
        uint256 s2 = _create(_p(payee2, AMOUNT, DAILY, start));
        uint256 s3 = _create(_p(payeeA, AMOUNT, DAILY, start));
        vm.warp(start);
        _payOnce(s1, outsider);
        _payOnce(s2, outsider);
        assertEq(_windowSpent(), 200e6);
        _failOnce(s3, outsider, R_BUDGET);
        assertEq(usdc.balanceOf(payeeA), 0);
        // still the same window: a retry after the gate fails again for the same reason
        vm.warp(_s(s3).nextRetryAt);
        _failOnce(s3, outsider, R_BUDGET);
        assertEq(_s(s3).failures, 2);
        // the next fixed window opens at start + 1 day; s3 (still on period 0) is first to draw
        vm.warp(start + 1 days);
        assertEq(_payOnce(s3, outsider), 0, "s3 resumes paying its original period");
        assertEq(_payOnce(s1, outsider), 1);
        _failOnce(s2, outsider, R_BUDGET); // window full again (200e6 + 100e6 > 250e6)
        assertEq(_windowSpent(), 200e6);
        assertEq(usdc.balanceOf(payeeA), AMOUNT);
        assertEq(usdc.balanceOf(payee2), AMOUNT, "s2 paid only its first period");
    }

    // ------------------------------------------------------------ S-FAIL-08
    function test_SFail08_OutsiderSpamAddsAtMostOneFailurePerRetryDelay() public {
        uint256 sid = _mkDaily();
        _drain();
        vm.recordLogs();
        uint64 t0 = _now();
        uint256 okCalls;
        for (uint256 i; i <= 25; ++i) { // 12.5 hours in 30 minute steps, 4 spam calls per step
            vm.warp(t0 + i * 30 minutes);
            for (uint256 k; k < 4; ++k) {
                if (_tryRun(sid, k % 2 == 0 ? outsider : keeper)) ++okCalls;
            }
            uint256 expected = (i * 30 minutes) / RETRY_DELAY + 1;
            if (expected > MAX_FAILURES) expected = MAX_FAILURES;
            assertEq(_s(sid).failures, expected, "one failure per retryDelay window");
        }
        assertEq(okCalls, MAX_FAILURES, "only the first call of each window was accepted");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 failedEvents;
        uint256 autoPaused;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(rpm)) continue;
            if (logs[i].topics[0] == IRPM.ExecutionFailed.selector) ++failedEvents;
            if (logs[i].topics[0] == IRPM.ScheduleAutoPaused.selector) ++autoPaused;
        }
        assertEq(failedEvents, MAX_FAILURES);
        assertEq(autoPaused, 1);
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Paused));
        assertEq(_s(sid).executedCount, 0);
    }

    function test_SFail08_SpamWithinOneWindowIsEveryTimeRetryNotReady() public {
        uint256 sid = _mkDaily();
        _drain();
        _failOnce(sid, outsider, R_INSUFFICIENT);
        uint64 retryAt = _s(sid).nextRetryAt;
        bytes32 d = _digest(sid);
        for (uint256 i; i < 40; ++i) {
            vm.warp(_now() + 1);
            if (_now() >= retryAt) break;
            vm.expectRevert(abi.encodeWithSelector(IRPM.RetryNotReady.selector, retryAt));
            _run(sid, i % 2 == 0 ? outsider : payee2);
        }
        assertEq(_s(sid).failures, 1);
        assertEq(_digest(sid), d, "40 rejected spam calls changed nothing");
    }
}
