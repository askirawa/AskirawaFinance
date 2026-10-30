// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";
import {AskirawaTreasuryHandler} from "./AskirawaTreasury.InvHandler.t.sol";

/// @notice INV 01, 02, 04, 05 plus payroll-never-overspends and conservation.
/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 100
/// forge-config: default.invariant.fail_on_revert = false
contract AskirawaTreasuryInvariantTest is StdInvariant, AskirawaTreasuryTestBase {
    AskirawaTreasuryHandler internal h;

    function setUp() public override {
        super.setUp();
        _enableModule();
        h = new AskirawaTreasuryHandler(t, usdc, mod, [approver1, approver2, approver3], guardian, proposerOnly);
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](13);
        sels[0] = h.deposit.selector;
        sels[1] = h.directTransfer.selector;
        sels[2] = h.proposePayroll.selector;
        sels[3] = h.proposeModuleAction.selector;
        sels[4] = h.approve.selector;
        sels[5] = h.cancel.selector;
        sels[6] = h.warp.selector;
        sels[7] = h.execute.selector;
        sels[8] = h.pause.selector;
        sels[9] = h.unpause.selector;
        sels[10] = h.moduleDraw.selector;
        sels[11] = h.payrollFlow.selector;
        sels[12] = h.actionFlow.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
        // setBlocked is intentionally exercised through a second selector set
        bytes4[] memory more = new bytes4[](1);
        more[0] = h.setBlocked.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: more}));
    }

    /// INV-01: conservation of USDC.
    function invariant_UsdcConservation() public view {
        assertEq(
            usdc.balanceOf(address(t)),
            h.initialBalance() + h.ghostDeposits() + h.ghostDirect() - h.ghostPayroll() - h.ghostModule(),
            "balance = initial + deposits + direct - payroll - module draws (rescues of USDC: none)"
        );
    }

    /// INV-02: an executed proposal never returns to Pending (or any other state).
    function invariant_ExecutedNeverReturnsToPending() public view {
        uint256 n = h.executedLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.executedIds(i);
            assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Executed));
            assertEq(uint8(t.status(id)), uint8(AskirawaTreasury.ProposalStatus.Executed));
        }
    }

    /// An executed payroll total never exceeded the balance at execution.
    function invariant_PayrollNeverExceededBalanceAtExecution() public view {
        assertFalse(h.overspend());
    }

    /// INV-04: module window spend never exceeds windowMax; remaining never exceeds windowMax.
    function invariant_WindowSpendNeverExceedsWindowMax() public view {
        (,,, uint96 wmax,,, uint96 spent) = t.modules(address(mod));
        assertLe(spent, wmax);
        assertLe(t.moduleSpendRemaining(address(mod)), wmax);
    }

    /// INV-05: every USDC outflow from the treasury is matched by an event with the same amount,
    /// and every deposit by a Deposited event.
    function invariant_NoUsdcMovesWithoutAnEvent() public view {
        assertFalse(h.unloggedOutflow(), "outflow without matching event");
        assertFalse(h.unloggedDeposit(), "deposit without matching event");
    }

    /// Consistency: every proposal the handler created consumed one sequential id.
    function invariant_ProposalCounterCoversCreatedProposals() public view {
        assertGe(t.nextProposalId(), 2 + h.nProposed());
    }

    /// Sanity: the stored statuses of tracked ids are always valid terminal-or-pending values.
    function invariant_TrackedProposalsHaveSaneStatus() public view {
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint8 st = uint8(t.getProposal(h.ids(i)).status);
            assertTrue(st >= 1 && st <= 4);
        }
    }

    /// @dev Handler state is rolled back at the start of every run, so a per-run assertion would demand that EVERY
    /// run hit EVERY state. Instead the counters accumulate in the process environment (which survives run resets)
    /// and, once enough runs have happened, each state must have been reached at least once. Failing here fails
    /// the invariant, so a handler that silently stops reaching deep states cannot pass.
    function _add(string memory key, uint256 n) internal returns (uint256 total) {
        string memory k = string.concat("TRY_COV_", key);
        total = vm.envOr(k, uint256(0)) + n;
        vm.setEnv(k, vm.toString(total));
    }

    function afterInvariant() public {
        uint256 runs = _add("RUNS", 1);
        uint256 pay = _add("PAYROLL", h.nExecutedPayroll());
        uint256 act = _add("ACTION", h.nExecutedAction());
        uint256 draws = _add("DRAWS", h.nDraws());
        uint256 pauses = _add("PAUSES", h.nPauses());
        uint256 unpauses = _add("UNPAUSES", h.nUnpauses());
        uint256 deps = _add("DEPOSITS", h.nDeposits());
        console2.log("COV core runs/payroll/action", runs, pay, act);
        console2.log("COV core draws/pauses/unpauses", draws, pauses, unpauses);
        console2.log("COV core deposits", deps);
        if (runs >= 32) {
            assertGt(pay, 0, "no payroll proposal was ever executed");
            assertGt(act, 0, "no module action was ever executed");
            assertGt(draws, 0, "no module draw ever happened");
            assertGt(pauses, 0, "no pause ever happened");
            assertGt(unpauses, 0, "no unpause ever happened");
            assertGt(deps, 0, "no deposit ever happened");
        }
    }
}
