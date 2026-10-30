// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// NOTE ON THIS FILE'S NAME
// ------------------------
// AskirawaFiTreasury has NO scheduling feature: there are no schedules, no keeper
// and no automation hooks. Recurring payments are done by creating a NEW proposal
// (proposeTransfer / proposePayroll) for each payment cycle, each needing its own
// quorum. The file path is kept for continuity; this suite instead covers
// GOVERNANCE: approver-set / quorum changes through proposeConfigChange ->
// vote -> execute, and ownership transfer.

import {AskirawaFiTreasury} from "../AskirawaFiTreasury.sol";
import {AskirawaFiTreasuryTestBase} from "./AskirawaFiTreasury.Base.t.sol";

contract AskirawaFiTreasuryGovernanceTest is AskirawaFiTreasuryTestBase {
    bytes32 internal constant CFG = keccak256("config-1");
    bytes32 internal constant PAY = keccak256("payment-1");

    /// owner proposes a config change; alice + bob approve; anyone executes.
    function _applyConfig(address[] memory na, uint8 q) internal {
        _proposeConfig(owner, CFG, na, q);
        _vote(alice, CFG);
        _vote(bob, CFG);
        _execute(CFG, na, _cfgAmounts(na.length, q));
    }

    // ── approver set changes ─────────────────────────────────────────────────

    function test_ConfigChangeAddsApprover() public {
        address[] memory na = _addrs4(owner, alice, bob, carol);
        _applyConfig(na, 2);

        assertEq(treasury.approverCount(), 4);
        assertTrue(treasury.isApprover(carol));
        assertEq(treasury.quorum(), 2);
        assertTrue(_prop(CFG).executed);

        // The new approver can now propose and vote.
        _proposeTransfer(carol, PAY, recipient, 1e6);
        _vote(alice, PAY);
        assertEq(_prop(PAY).approvalCount, 1);
    }

    function test_ConfigChangeRemovesApprover() public {
        address[] memory na = _addrs3(owner, alice, carol);
        _applyConfig(na, 2);

        assertFalse(treasury.isApprover(bob));
        assertEq(treasury.approverCount(), 3);

        uint64 exp = _exp();
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        vm.prank(bob);
        treasury.proposeTransfer(PAY, recipient, 1e6, exp);

        _proposeTransfer(owner, PAY, recipient, 1e6);
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        vm.prank(bob);
        treasury.vote(PAY);
    }

    function test_ConfigChangeReplacesWholeSetAndReordersList() public {
        address[] memory na = _addrs3(carol, dave, alice);
        _applyConfig(na, 2);

        address[] memory list = treasury.approvers();
        assertEq(list.length, 3);
        assertEq(list[0], carol);
        assertEq(list[1], dave);
        assertEq(list[2], alice);
        assertFalse(treasury.isApprover(owner));
        assertFalse(treasury.isApprover(bob));
    }

    function test_ConfigChangeDeduplicatesApprovers() public {
        // [alice, alice, bob, carol], q=2 -> 3 distinct approvers
        address[] memory na = new address[](4);
        na[0] = alice;
        na[1] = alice;
        na[2] = bob;
        na[3] = carol;
        _applyConfig(na, 2);
        assertEq(treasury.approverCount(), 3);
    }

    function test_ConfigChangeEmitsEvents() public {
        address[] memory na = _addrs4(owner, alice, bob, carol);
        _proposeConfig(owner, CFG, na, 3);
        _vote(alice, CFG);
        _vote(bob, CFG);

        vm.expectEmit(true, false, false, true, address(treasury));
        emit AskirawaFiTreasury.Executed(CFG, 3, 0);
        vm.expectEmit(false, false, false, true, address(treasury));
        emit AskirawaFiTreasury.ApproversUpdated(na, 3);
        _execute(CFG, na, _cfgAmounts(4, 3));
    }

    function test_ConfigChangeDoesNotMoveFunds() public {
        _applyConfig(_addrs3(owner, alice, carol), 2);
        assertEq(treasury.balance(), TREASURY_SEED);
    }

    // ── quorum changes ───────────────────────────────────────────────────────

    function test_ConfigChangeRaisesQuorum() public {
        _applyConfig(_addrs4(owner, alice, bob, carol), 3);
        assertEq(treasury.quorum(), 3);

        // Two votes are no longer enough.
        _proposeTransfer(owner, PAY, recipient, 1e6);
        _vote(alice, PAY);
        _vote(bob, PAY);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, PAY, uint16(2), uint8(3)));
        treasury.execute(PAY, _one(recipient), _oneU(1e6));

        _vote(carol, PAY);
        treasury.execute(PAY, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    function test_ConfigChangeLowersQuorum() public {
        _applyConfig(_addrs3(owner, alice, bob), 1);
        assertEq(treasury.quorum(), 1);

        _proposeTransfer(owner, PAY, recipient, 1e6);
        _vote(alice, PAY);
        treasury.execute(PAY, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    function test_ConfigChangeBelowQuorumDoesNotApply() public {
        address[] memory na = _addrs3(owner, alice, carol);
        _proposeConfig(owner, CFG, na, 1);
        _vote(alice, CFG);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, CFG, uint16(1), uint8(2)));
        treasury.execute(CFG, na, _cfgAmounts(3, 1));
        assertEq(treasury.quorum(), 2);
        assertTrue(treasury.isApprover(bob));
    }

    function test_OwnerCanCancelConfigChange() public {
        address[] memory na = _addrs3(owner, alice, carol);
        _proposeConfig(alice, CFG, na, 1);
        _vote(bob, CFG);
        _vote(owner, CFG);
        vm.prank(owner);
        treasury.cancel(CFG);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyCancelled.selector, CFG));
        treasury.execute(CFG, na, _cfgAmounts(3, 1));
        assertEq(treasury.quorum(), 2);
    }

    function test_RevertConfigExecuteWithAlteredQuorum() public {
        address[] memory na = _addrs3(owner, alice, carol);
        _proposeConfig(owner, CFG, na, 2);
        _vote(alice, CFG);
        _vote(bob, CFG);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, CFG));
        treasury.execute(CFG, na, _cfgAmounts(3, 1)); // approved with q=2, executor tries q=1
    }

    function test_RevertConfigExecuteWithAlteredApprovers() public {
        address[] memory na = _addrs3(owner, alice, carol);
        _proposeConfig(owner, CFG, na, 2);
        _vote(alice, CFG);
        _vote(bob, CFG);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, CFG));
        treasury.execute(CFG, _addrs3(owner, alice, stranger), _cfgAmounts(3, 2));
    }

    function test_RevertConfigChangeCannotBeExecutedTwice() public {
        address[] memory na = _addrs3(owner, alice, carol);
        _applyConfig(na, 2);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExecuted.selector, CFG));
        treasury.execute(CFG, na, _cfgAmounts(3, 2));
    }

    // ── execute-time validation (propose-time validation is shallower) ───────

    /// proposeConfigChange validates the RAW list length; _setApprovers validates the
    /// DEDUPLICATED length at execute. A duplicate-padded list can therefore be
    /// proposed and approved, yet revert on execute (proposal stays pending).
    function test_ConfigWithDuplicatesFailsAtExecuteWhenQuorumExceedsDistinctCount() public {
        address[] memory na = _addrs3(alice, alice, bob); // 2 distinct, quorum 3
        _proposeConfig(owner, CFG, na, 3); // accepted: raw length 3 >= 3
        _vote(alice, CFG);
        _vote(bob, CFG);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, uint8(3), uint256(2)));
        treasury.execute(CFG, na, _cfgAmounts(3, 3));

        assertEq(treasury.approverCount(), 3);
        assertEq(treasury.quorum(), 2);
        assertFalse(_prop(CFG).executed);
    }

    /// A zero address in the new set is accepted by proposeConfigChange and only
    /// rejected at execute time.
    function test_ConfigWithZeroApproverFailsAtExecute() public {
        address[] memory na = _addrs3(alice, address(0), bob);
        _proposeConfig(owner, CFG, na, 2);
        _vote(alice, CFG);
        _vote(bob, CFG);
        vm.expectRevert(bytes("Treasury: zero approver"));
        treasury.execute(CFG, na, _cfgAmounts(3, 2));
        assertTrue(treasury.isApprover(owner)); // old set intact
    }

    // ── votes survive approver-set changes (observed behaviour) ──────────────

    /// OBSERVATION (possible design gap, not asserted as intended behaviour):
    /// approvalCount is never re-validated against the current approver set, so a
    /// vote cast by an approver who is later REMOVED still counts at execute().
    function test_RemovedApproversEarlierVoteStillCounts() public {
        _proposeTransfer(owner, PAY, recipient, 1e6);
        _vote(bob, PAY); // bob votes while still an approver

        _applyConfig(_addrs3(owner, alice, carol), 2); // bob removed
        assertFalse(treasury.isApprover(bob));

        _vote(alice, PAY);
        assertEq(_prop(PAY).approvalCount, 2);
        treasury.execute(PAY, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    // ── ownership ────────────────────────────────────────────────────────────

    function test_TransferOwnershipUpdatesOwnerAndEmits() public {
        vm.expectEmit(true, true, false, false, address(treasury));
        emit AskirawaFiTreasury.OwnershipTransferred(owner, carol);
        vm.prank(owner);
        treasury.transferOwnership(carol);
        assertEq(treasury.owner(), carol);
    }

    function test_NewOwnerCanCancelAndOldOwnerCannot() public {
        _proposeTransfer(alice, PAY, recipient, 1e6);
        vm.prank(owner);
        treasury.transferOwnership(carol);

        vm.expectRevert(AskirawaFiTreasury.NotOwner.selector);
        vm.prank(owner);
        treasury.cancel(PAY);

        vm.prank(carol);
        treasury.cancel(PAY);
        assertTrue(_prop(PAY).cancelled);
    }

    function test_OwnershipTransferDoesNotChangeApprovers() public {
        vm.prank(owner);
        treasury.transferOwnership(carol);
        assertFalse(treasury.isApprover(carol));
        assertTrue(treasury.isApprover(owner));
        assertEq(treasury.quorum(), 2);
    }

    function test_RevertTransferOwnershipByNonOwner() public {
        vm.expectRevert(AskirawaFiTreasury.NotOwner.selector);
        vm.prank(alice); // approver but not owner
        treasury.transferOwnership(alice);
        assertEq(treasury.owner(), owner);
    }

    function test_RevertTransferOwnershipToZero() public {
        vm.expectRevert(AskirawaFiTreasury.ZeroOwner.selector);
        vm.prank(owner);
        treasury.transferOwnership(address(0));
        assertEq(treasury.owner(), owner);
    }

    function test_OldOwnerCannotTransferOwnershipAgain() public {
        vm.prank(owner);
        treasury.transferOwnership(carol);
        vm.expectRevert(AskirawaFiTreasury.NotOwner.selector);
        vm.prank(owner);
        treasury.transferOwnership(owner);
    }

    function test_OwnerHasNoUnilateralWithdrawal() public {
        // The owner can cancel and deposit but cannot pull funds without quorum.
        uint256 before = usdc.balanceOf(owner);
        _proposeTransfer(owner, PAY, owner, 1e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, PAY, uint16(0), uint8(2)));
        vm.prank(owner);
        treasury.execute(PAY, _one(owner), _oneU(1e6));
        assertEq(usdc.balanceOf(owner), before);
    }
}
