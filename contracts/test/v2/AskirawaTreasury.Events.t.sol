// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryPayBase} from "./AskirawaTreasury.PayBase.t.sol";

/// @notice EVENTS: every event declared by the core is asserted with exact arguments
/// (all topics and data) in at least one test. Rows reference where each event is checked.
///  EpochCreated, Proposed (all six kinds), GovernanceItem, Voted, QuorumReached, Rejected, Cancelled -> this file
///  Deposited, PayrollItem, PaymentSent, Executed (Payroll)      -> this file (and PayExec / Pay)
///  Paused, Unpaused, ModuleConfigured, ModulePaid, ModuleFunded, Rescued -> this file (and Pause / Mod / ModDraw / Rescue)
contract AskirawaTreasuryEventsTest is AskirawaTreasuryPayBase {
    // ------------------------------------------------------------ EpochCreated
    function test_EVT_EpochCreatedAtConstructionAndAtGovernanceExecution() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        vm.expectEmit(true, false, false, true);
        emit AskirawaTreasury.EpochCreated(1, c.quorum, c.payrollDelay, c.configDelay, c.guardian);
        _deploy(c, MIN_CONFIG_DELAY);

        AskirawaTreasury.GovernancePayload memory n = _cfg();
        n.quorum = 3;
        n.payrollDelay = 3 days;
        n.configDelay = 4 days;
        n.guardian = makeAddr("newGuardian");
        uint256 id = _proposeGov(approver1, n);
        _reachQuorum(id);
        _warpToExecutable(id);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.EpochCreated(2, 3, 3 days, 4 days, n.guardian);
        _exec(id);
    }

    // ------------------------------------------------------------ Proposed for every action kind
    function test_EVT_ProposedExactForEveryKind() public {
        _enableModule();
        uint64 exp = _exp();
        uint256 next = t.nextProposalId();
        uint256 epoch = t.currentEpoch();
        // payroll
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 12e6);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.Proposed(next, epoch, proposerOnly, AskirawaTreasury.Action.Payroll, 12e6, exp,
            keccak256(abi.encode(items)), MEMO);
        vm.prank(proposerOnly);
        t.proposePayroll(items, exp, MEMO);
        // governance
        AskirawaTreasury.GovernancePayload memory g = _cfg();
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.Proposed(next + 1, epoch, proposerOnly, AskirawaTreasury.Action.Governance, 0, exp,
            keccak256(abi.encode(g)), MEMO);
        vm.prank(proposerOnly);
        t.proposeGovernance(g, exp, MEMO);
        // module config
        AskirawaTreasury.ModuleConfigPayload memory mc =
            AskirawaTreasury.ModuleConfigPayload(address(mod), false, PER_TX, WINDOW_MAX, WINDOW_LEN);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.Proposed(next + 2, epoch, proposerOnly, AskirawaTreasury.Action.ModuleConfig, 0, exp,
            keccak256(abi.encode(mc)), MEMO);
        vm.prank(proposerOnly);
        t.proposeModuleConfig(address(mod), false, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO);
        // module action (total = funding)
        AskirawaTreasury.ModuleActionPayload memory ma = AskirawaTreasury.ModuleActionPayload(address(mod), 3, hex"aabb", 9e6);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.Proposed(next + 3, epoch, proposerOnly, AskirawaTreasury.Action.ModuleAction, 9e6, exp,
            keccak256(abi.encode(ma)), MEMO);
        vm.prank(proposerOnly);
        t.proposeModuleAction(address(mod), 3, hex"aabb", 9e6, exp, MEMO);
        // rescue
        AskirawaTreasury.RescuePayload memory rp = AskirawaTreasury.RescuePayload(address(other), rescueTo, 5e6);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.Proposed(next + 4, epoch, proposerOnly, AskirawaTreasury.Action.Rescue, 0, exp,
            keccak256(abi.encode(rp)), MEMO);
        vm.prank(proposerOnly);
        t.proposeRescue(address(other), rescueTo, 5e6, exp, MEMO);
        // unpause (needs a pause)
        _pause();
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.Proposed(next + 5, epoch, proposerOnly, AskirawaTreasury.Action.Unpause, 0, exp,
            keccak256(abi.encode(AskirawaTreasury.UnpausePayload(true, 1))), MEMO);
        vm.prank(proposerOnly);
        t.proposeUnpause(exp, MEMO);
    }

    function test_EVT_GovernanceItemCarriesTheWholePayload() public {
        AskirawaTreasury.GovernancePayload memory g = _cfg();
        g.quorum = 3;
        g.payrollDelay = 5 hours;
        g.configDelay = 3 days;
        g.guardian = makeAddr("govGuardian");
        uint64 exp = _exp();
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.GovernanceItem(1, g.approvers, g.proposers, 3, g.guardian, 5 hours, 3 days);
        vm.prank(proposerOnly);
        t.proposeGovernance(g, exp, MEMO);
    }

    // ------------------------------------------------------------ Voted / QuorumReached / Rejected / Cancelled
    function test_EVT_ProposerAutoApprovalEmitsVoted() public {
        uint64 exp = _exp();
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.Voted(1, approver1, 1, 1, 0);
        vm.prank(approver1);
        t.proposePayroll(items, exp, MEMO);
    }

    function test_EVT_VotedAndQuorumReachedExact() public {
        uint256 id = _propose(approver1, _pay(payee1, 1e6));
        uint64 nowTs = _now();
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.Voted(id, approver2, 1, 2, 0);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.QuorumReached(id, nowTs, nowTs + PAYROLL_DELAY);
        _approve(id, approver2);
        // a further approval emits Voted only (quorum event fires once)
        vm.recordLogs();
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.Voted(id, approver3, 1, 3, 0);
        _approve(id, approver3);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 fromTreasury;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(t)) continue;
            ++fromTreasury;
            assertEq(logs[i].topics[0], AskirawaTreasury.Voted.selector, "only Voted; QuorumReached never repeats");
        }
        assertEq(fromTreasury, 1, "exactly one treasury event for a post-quorum approval");
    }

    function test_EVT_RejectedAndRejectionVotesExact() public {
        uint256 id = _propose(proposerOnly, _pay(payee1, 1e6));
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.Voted(id, approver1, 2, 0, 1);
        _reject(id, approver1);
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.Voted(id, approver2, 2, 0, 2);
        vm.expectEmit(true, false, false, false, address(t));
        emit AskirawaTreasury.Rejected(id);
        _reject(id, approver2);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Rejected));
    }

    function test_EVT_CancelledExactForProposerAndGuardian() public {
        uint256 a = _propose(proposerOnly, _pay(payee1, 1e6));
        vm.expectEmit(true, true, false, false, address(t));
        emit AskirawaTreasury.Cancelled(a, proposerOnly);
        vm.prank(proposerOnly);
        t.cancel(a);
        uint256 b = _propose(proposerOnly, _pay(payee1, 1e6));
        vm.expectEmit(true, true, false, false, address(t));
        emit AskirawaTreasury.Cancelled(b, guardian);
        vm.prank(guardian);
        t.cancel(b);
    }

    // ------------------------------------------------------------ money events
    function test_EVT_DepositedPayrollItemPaymentSentExecutedExact() public {
        usdc.mint(outsider, 40e6);
        vm.startPrank(outsider);
        usdc.approve(address(t), 40e6);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.Deposited(outsider, 40e6);
        t.deposit(40e6);
        vm.stopPrank();

        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](2);
        items[0] = AskirawaTreasury.Payment(payee1, 3e6);
        items[1] = AskirawaTreasury.Payment(payee2, 4e6);
        uint64 exp = _exp();
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.PayrollItem(1, 0, payee1, 3e6);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.PayrollItem(1, 1, payee2, 4e6);
        vm.prank(proposerOnly);
        uint256 id = t.proposePayroll(items, exp, MEMO);
        _reachQuorum(id);
        _warpToExecutable(id);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.PaymentSent(id, 0, payee1, 3e6);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.PaymentSent(id, 1, payee2, 4e6);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.Executed(id, AskirawaTreasury.Action.Payroll, 7e6);
        _exec(id);
    }

    function test_EVT_PausedUnpausedModuleAndRescueEventsExact() public {
        // Paused (indexed `by`)
        vm.expectEmit(true, false, false, false, address(t));
        emit AskirawaTreasury.Paused(approver3);
        vm.prank(approver3);
        t.pause();
        // Unpaused
        uint256 up = _proposeUnpause(approver1);
        _reachQuorum(up);
        _warpToExecutable(up);
        vm.expectEmit(true, false, false, false, address(t));
        emit AskirawaTreasury.Unpaused(up);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.Executed(up, AskirawaTreasury.Action.Unpause, 0);
        _exec(up);
        // ModuleConfigured
        uint256 mc = _proposeModuleConfig(approver1, true);
        _reachQuorum(mc);
        _warpToExecutable(mc);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.ModuleConfigured(address(mod), true, address(mod).codehash, PER_TX, WINDOW_MAX, WINDOW_LEN);
        _exec(mc);
        // ModulePaid / ModuleFunded
        bytes32 ref = keccak256("PLACEHOLDER_EVT_REF");
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.ModulePaid(address(mod), payee1, 11e6, ref);
        vm.prank(address(mod));
        t.payFromModule(payee1, 11e6, ref);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.ModuleFunded(address(mod), 12e6, ref);
        vm.prank(address(mod));
        t.fundModule(12e6, ref);
        // Rescued
        uint256 r = _proposeRescue(approver1);
        _reachQuorum(r);
        _warpToExecutable(r);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.Rescued(r, address(other), rescueTo, RESCUE_AMOUNT);
        _exec(r);
    }
}
