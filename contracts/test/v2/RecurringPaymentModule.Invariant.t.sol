// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {RpmP2Base} from "./RecurringPaymentModule.P2Base.t.sol";
import {RpmHandler} from "./RecurringPaymentModule.InvHandler.t.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";

/// @notice INV (module): ledger conservation, once-per-period payment, monotonic counters, window caps,
/// terminal states, with REQUIRED coverage of payments, failures, auto-pauses, resumes and completions.
/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 100
/// forge-config: default.invariant.fail_on_revert = false
contract RecurringPaymentModuleInvariantTest is StdInvariant, RpmP2Base {
    RpmHandler internal h;
    uint96 internal constant INV_PER_TX = 300e6;
    uint96 internal constant INV_WINDOW_MAX = 600e6;
    uint32 internal constant INV_WINDOW_LEN = 2 days;

    function setUp() public override {
        super.setUp();
        _configureRpm(true, INV_PER_TX, INV_WINDOW_MAX, INV_WINDOW_LEN); // tight enough to produce BUDGET failures
        _setBalance(1_000e6);
        h = new RpmHandler(t, rpm, usdc, [approver1, approver2, approver3], guardian, keeper, sink);
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](20);
        sels[0] = h.deposit.selector;
        sels[1] = h.drain.selector;
        sels[2] = h.toggleBlocked.selector;
        sels[3] = h.createSchedule.selector;
        sels[4] = h.resume.selector;
        sels[5] = h.pauseSchedule.selector;
        sels[6] = h.cancelSchedule.selector;
        sels[7] = h.corePause.selector;
        sels[8] = h.coreUnpause.selector;
        sels[9] = h.warp.selector;
        sels[10] = h.execute.selector;
        sels[11] = h.persistentKeeper.selector;
        sels[12] = h.sweepDue.selector;
        sels[13] = h.createAndExecute.selector;
        sels[14] = h.createAndExecute.selector; // double weight: schedules that actually pay are the raw material
        sels[15] = h.createSchedule.selector;
        sels[16] = h.prefundCreate.selector;
        sels[17] = h.donate.selector;
        sels[18] = h.recover.selector;
        sels[19] = h.resume.selector; // resumes (half of them without skipping) feed the catch-up path
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
    }

    // ------------------------------------------------------------ per-schedule ledger
    function invariant_TotalPaidEqualsSumOfScheduleExecutedAmountsPerSchedule() public view {
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            IRPM.Schedule memory s = rpm.getSchedule(id);
            assertEq(s.totalPaid, h.ghostPaid(id), "totalPaid == sum of events");
            assertEq(uint256(s.totalPaid), uint256(s.executedCount) * s.amount, "totalPaid == executedCount * amount");
        }
    }

    function invariant_EachPeriodIsPaidOnceAndEveryPaymentHasOneReceipt() public view {
        assertFalse(h.doublePaid(), "a period index was paid twice");
        assertFalse(h.multiPayInOneCall(), "one execute call paid more than once");
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            assertEq(h.paidCount(id), rpm.getSchedule(id).executedCount, "distinct paid periods == executedCount");
        }
    }

    function invariant_ExecutedCountNeverDecreasesAndFailuresNeverMoveState() public view {
        assertFalse(h.countDecreased());
        assertFalse(h.failureMovedState());
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            assertGe(rpm.getSchedule(id).executedCount, h.maxSeenCount(id));
        }
    }

    function invariant_PaymentsAlwaysMatchStoredTermsCallerAndStatus() public view {
        assertFalse(h.wrongPayment(), "recipient / amount / executor / dueAt mismatch");
        assertFalse(h.paidFromInactive(), "paid while not Active");
    }

    function invariant_CancelledOrCompletedScheduleNeverPaysAgain() public view {
        assertFalse(h.terminalChanged(), "terminal schedule changed");
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            uint8 ts = h.terminalStatus(id);
            if (ts == 0) continue;
            IRPM.Schedule memory s = rpm.getSchedule(id);
            assertEq(uint8(s.status), ts);
            assertEq(s.totalPaid, h.terminalPaid(id));
            assertEq(s.executedCount, h.terminalCount(id));
        }
    }

    // ------------------------------------------------------------ money
    function invariant_ModulePaymentsNeverExceedTheCoreWindowCapPerWindow() public view {
        uint256 n = h.windowStartsLength();
        for (uint256 i; i < n; ++i) {
            assertLe(h.windowPaid(h.windowStarts(i)), INV_WINDOW_MAX, "paid in one window > windowMax");
        }
        (,, uint96 perTx, uint96 wmax,,, uint96 spent) = t.modules(address(rpm));
        assertEq(perTx, INV_PER_TX);
        assertLe(spent, wmax);
    }

    function invariant_TreasuryUsdcConservationIncludingModuleDrawsPrefundingAndRecovery() public view {
        assertEq(
            usdc.balanceOf(address(t)),
            h.initialBalance() + h.ghostDeposits() + h.ghostRecovered() - h.ghostPayroll() - h.ghostPaidTotal()
                - h.ghostPrefunded(),
            "treasury = initial + deposits + recovered - payroll - module draws - prefunding"
        );
        assertEq(h.ghostCorePaid(), h.ghostPaidTotal(), "core ModulePaid == module ScheduleExecuted");
        uint256 recipients;
        for (uint256 i; i < 6; ++i) recipients += usdc.balanceOf(h.actors(i));
        assertEq(recipients, h.ghostPaidTotal(), "recipients received exactly what receipts say");
        assertEq(usdc.balanceOf(h.sink()), h.sinkInitial() + h.ghostPayroll(), "only payroll proposals reach the sink");
    }

    /// @dev Payments are drawn by the core straight from the treasury; module-held USDC only comes from prefunding
    /// or donations and only leaves through action 3 back to the treasury.
    function invariant_ModuleBalanceIsPrefundedPlusDonatedMinusRecovered() public view {
        assertEq(
            usdc.balanceOf(address(rpm)),
            h.ghostPrefunded() + h.ghostDonated() - h.ghostRecovered(),
            "module balance == prefunded + donated - recovered"
        );
        assertFalse(h.wrongRecovery(), "recovery event / remainder / treasury delta mismatch");
        assertFalse(h.recoveryFailedWithFunds(), "action 3 failed although the module held USDC");
    }

    function invariant_CatchUpBoundaryOnlyWidensTheBacklogGuardInsideItsRange() public view {
        assertFalse(h.wrongBoundary(), "boundary must be resume time (no skip) or zero (skip)");
        assertFalse(h.backlogInsideRange(), "BACKLOG auto-pause inside the authorized range");
        assertFalse(h.paidBeyondGuard(), "paid a period the ordinary guard must have blocked");
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            assertLe(rpm.catchUpUntil(id), vm.getBlockTimestamp(), "a boundary is never in the future");
        }
    }

    // ------------------------------------------------------------ coverage (required, not telemetry)
    function _add(string memory key, uint256 n) internal returns (uint256 total) {
        string memory k = string.concat("RPM_COV_", key);
        total = vm.envOr(k, uint256(0)) + n;
        vm.setEnv(k, vm.toString(total));
    }

    /// @dev Handler state is reverted between runs, so counters are accumulated in process env. After 32 runs every
    /// state must have been reached at least once; the last log line of the run shows the final totals.
    function afterInvariant() public {
        uint256 runs = _add("RUNS", 1);
        uint256 pay = _add("PAY", h.nPayments());
        uint256 fail = _add("FAIL", h.nFailures());
        uint256 apF = _add("AUTOPAUSE_FAILURES", h.nAutoPauseFailures());
        uint256 apB = _add("AUTOPAUSE_BACKLOG", h.nAutoPauseBacklog());
        uint256 res = _add("RESUME", h.nResumes());
        uint256 done = _add("COMPLETE", h.nCompletions());
        uint256 cre = _add("CREATE", h.nCreates());
        uint256 sp = _add("SCHED_PAUSE", h.nSchedPauses());
        uint256 can = _add("CANCEL", h.nCancels());
        uint256 cp = _add("CORE_PAUSE", h.nCorePauses());
        uint256 cpu = _add("CORE_UNPAUSE", h.nCoreUnpauses());
        uint256 rr = _add("RETRY_REJECTED", h.nRetryRejected());
        uint256 pre = _add("PREFUNDS", h.nPrefunds());
        uint256 rec = _add("RECOVERIES", h.nRecoveries());
        uint256 recEmpty = _add("RECOVER_EMPTY", h.nRecoverEmpty());
        uint256 don = _add("DONATIONS", h.nDonations());
        uint256 ns = _add("NOSKIP_RESUMES", h.nNoSkipResumes());
        uint256 cu = _add("CATCHUP_PAYMENTS", h.nCatchUpPayments());
        console2.log("COV runs/creates/payments", runs, cre, pay);
        console2.log("COV failures/autoPauseFAILURES/autoPauseBACKLOG", fail, apF, apB);
        console2.log("COV resumes/completions/schedPauses", res, done, sp);
        console2.log("COV cancels", can);
        console2.log("COV corePauses/coreUnpauses/retryRejected", cp, cpu, rr);
        console2.log("COV prefunds/recoveries/recoverEmpty", pre, rec, recEmpty);
        console2.log("COV donations", don);
        console2.log("COV noSkipResumes/catchUpPayments", ns, cu);
        if (runs >= 32) {
            assertGt(pay, 0, "no successful payment ever happened");
            assertGt(fail, 0, "no soft failure ever happened");
            assertGt(apF + apB, 0, "no auto-pause ever happened");
            assertGt(apF, 0, "no FAILURES auto-pause");
            assertGt(apB, 0, "no BACKLOG auto-pause");
            assertGt(res, 0, "no resume ever happened");
            assertGt(done, 0, "no completion ever happened");
            assertGt(can, 0, "no cancel ever happened");
            assertGt(cp, 0, "no core pause ever happened");
            assertGt(pre, 0, "no prefunded create ever happened");
            assertGt(rec, 0, "no successful recovery ever happened");
            assertGt(ns, 0, "no no-skip resume ever happened");
        }
    }
}
