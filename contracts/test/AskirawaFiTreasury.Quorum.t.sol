// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaFiTreasury} from "../AskirawaFiTreasury.sol";
import {AskirawaFiTreasuryTestBase} from "./AskirawaFiTreasury.Base.t.sol";

/// vote(), quorum gating of execute(), self-vote / double-vote rules, cancel().
/// Default fixture: approvers {owner, alice, bob}, quorum 2.
contract AskirawaFiTreasuryQuorumTest is AskirawaFiTreasuryTestBase {
    bytes32 internal constant ID = keccak256("proposal-1");

    // ── vote happy path ──────────────────────────────────────────────────────

    function test_VoteRecordsVoteAndIncrementsCount() public {
        _proposeTransfer(owner, ID, recipient, 100e6);
        assertFalse(treasury.voted(ID, alice));

        _vote(alice, ID);
        assertTrue(treasury.voted(ID, alice));
        assertFalse(treasury.voted(ID, bob));
        assertEq(_prop(ID).approvalCount, 1);

        _vote(bob, ID);
        assertTrue(treasury.voted(ID, bob));
        assertEq(_prop(ID).approvalCount, 2);
    }

    function test_VoteEmitsVotedWithCountAndQuorum() public {
        _proposeTransfer(owner, ID, recipient, 100e6);

        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.Voted(ID, alice, 1, 2);
        _vote(alice, ID);

        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.Voted(ID, bob, 2, 2);
        _vote(bob, ID);
    }

    function test_VotesAreScopedPerProposal() public {
        bytes32 id2 = keccak256("proposal-2");
        _proposeTransfer(owner, ID, recipient, 1e6);
        _proposeTransfer(owner, id2, recipient, 1e6);
        _vote(alice, ID);
        assertFalse(treasury.voted(id2, alice));
        _vote(alice, id2); // alice may vote on a different proposal
        assertEq(_prop(id2).approvalCount, 1);
    }

    function test_VoteDoesNotMoveFunds() public {
        _proposeApprove(ID, recipient, 100e6);
        assertEq(treasury.balance(), TREASURY_SEED);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_VoteAllowedOneSecondBeforeExpiry() public {
        uint64 exp = _proposeTransfer(owner, ID, recipient, 1e6);
        vm.warp(exp - 1);
        _vote(alice, ID);
        assertEq(_prop(ID).approvalCount, 1);
    }

    function test_VotesBeyondQuorumAreAccepted() public {
        // 4 approvers, quorum 2: a 3rd vote after quorum is still recorded.
        AskirawaFiTreasury t = new AskirawaFiTreasury(address(usdc), owner, _addrs4(owner, alice, bob, carol), 2);
        vm.prank(owner);
        t.proposeTransfer(ID, recipient, 1e6, _exp());
        vm.prank(alice);
        t.vote(ID);
        vm.prank(bob);
        t.vote(ID);
        vm.prank(carol);
        t.vote(ID);
        (,,,,,, uint16 n) = t.proposals(ID);
        assertEq(n, 3);
    }

    // ── vote reverts ─────────────────────────────────────────────────────────

    function test_RevertVoteNonApprover() public {
        _proposeTransfer(owner, ID, recipient, 1e6);
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        vm.prank(stranger);
        treasury.vote(ID);
    }

    function test_RevertVoteProposalNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalNotFound.selector, ID));
        vm.prank(alice);
        treasury.vote(ID);
    }

    function test_RevertSelfVote() public {
        _proposeTransfer(alice, ID, recipient, 1e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.SelfVote.selector, ID, alice));
        vm.prank(alice);
        treasury.vote(ID);
        assertEq(_prop(ID).approvalCount, 0);
    }

    function test_RevertSelfVoteOwnerAsProposer() public {
        _proposeTransfer(owner, ID, recipient, 1e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.SelfVote.selector, ID, owner));
        vm.prank(owner);
        treasury.vote(ID);
    }

    function test_RevertDoubleVote() public {
        _proposeTransfer(owner, ID, recipient, 1e6);
        _vote(alice, ID);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.AlreadyVoted.selector, ID, alice));
        vm.prank(alice);
        treasury.vote(ID);
        assertEq(_prop(ID).approvalCount, 1);
    }

    function test_RevertVoteAtExpiry() public {
        uint64 exp = _proposeTransfer(owner, ID, recipient, 1e6);
        vm.warp(exp);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalExpired.selector, ID));
        vm.prank(alice);
        treasury.vote(ID);
    }

    function test_RevertVoteAfterCancel() public {
        _proposeTransfer(owner, ID, recipient, 1e6);
        vm.prank(owner);
        treasury.cancel(ID);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyCancelled.selector, ID));
        vm.prank(alice);
        treasury.vote(ID);
    }

    function test_RevertVoteAfterExecuted() public {
        _proposeApprove(ID, recipient, 1e6);
        _execute(ID, _one(recipient), _oneU(1e6));
        // owner (proposer) would hit SelfVote, but state checks come first.
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExecuted.selector, ID));
        vm.prank(owner);
        treasury.vote(ID);
    }

    // ── quorum gating ────────────────────────────────────────────────────────

    function test_ExecuteRevertsWithZeroVotes() public {
        _proposeTransfer(owner, ID, recipient, 1e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, ID, uint16(0), uint8(2)));
        treasury.execute(ID, _one(recipient), _oneU(1e6));
    }

    function test_ExecuteRevertsBelowQuorum() public {
        _proposeTransfer(owner, ID, recipient, 1e6);
        _vote(alice, ID);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, ID, uint16(1), uint8(2)));
        treasury.execute(ID, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_ExecuteSucceedsExactlyAtQuorum() public {
        _proposeApprove(ID, recipient, 1e6);
        _execute(ID, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    function test_QuorumOneNeedsSingleNonProposerVote() public {
        AskirawaFiTreasury t = new AskirawaFiTreasury(address(usdc), owner, _addrs3(owner, alice, bob), 1);
        usdc.mint(address(t), 10e6);
        vm.prank(owner);
        t.proposeTransfer(ID, recipient, 3e6, _exp());
        // proposer's own approval is impossible: still zero votes.
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, ID, uint16(0), uint8(1)));
        t.execute(ID, _one(recipient), _oneU(3e6));
        vm.prank(alice);
        t.vote(ID);
        t.execute(ID, _one(recipient), _oneU(3e6));
        assertEq(usdc.balanceOf(recipient), 3e6);
    }

    function test_ProposerPlusOneVoterCannotReachQuorumTwoWithThreeApprovers() public {
        // The two non-proposer approvers are required; one is not enough.
        _proposeTransfer(alice, ID, recipient, 1e6);
        _vote(owner, ID);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, ID, uint16(1), uint8(2)));
        treasury.execute(ID, _one(recipient), _oneU(1e6));
        _vote(bob, ID);
        treasury.execute(ID, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    /// SUSPECTED CONTRACT BUG (liveness): validation accepts quorum == approverCount,
    /// but the proposer cannot vote on their own proposal, so at most
    /// approverCount-1 votes are ever possible. With quorum == approverCount NO
    /// proposal (including a CONFIG fix) can ever execute, locking all funds.
    /// This test pins the CURRENT behaviour; do not read it as desired behaviour.
    function test_SUSPECTED_BUG_QuorumEqualToApproverCountIsUnreachable() public {
        AskirawaFiTreasury t = new AskirawaFiTreasury(address(usdc), owner, _addrs3(owner, alice, bob), 3);
        usdc.mint(address(t), 10e6);
        vm.prank(owner);
        t.proposeTransfer(ID, recipient, 1e6, _exp());
        vm.prank(alice);
        t.vote(ID);
        vm.prank(bob);
        t.vote(ID);
        // Every possible voter has voted; the proposer cannot.
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.SelfVote.selector, ID, owner));
        vm.prank(owner);
        t.vote(ID);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, ID, uint16(2), uint8(3)));
        t.execute(ID, _one(recipient), _oneU(1e6));
    }

    // ── cancel ───────────────────────────────────────────────────────────────

    function test_OwnerCancelsProposal() public {
        _proposeTransfer(alice, ID, recipient, 1e6);
        vm.expectEmit(true, true, false, false, address(treasury));
        emit AskirawaFiTreasury.Cancelled(ID, owner);
        vm.prank(owner);
        treasury.cancel(ID);
        assertTrue(_prop(ID).cancelled);
        assertFalse(_prop(ID).executed);
    }

    function test_OwnerCanCancelAfterQuorumReached() public {
        _proposeApprove(ID, recipient, 1e6);
        vm.prank(owner);
        treasury.cancel(ID);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyCancelled.selector, ID));
        treasury.execute(ID, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_RevertCancelByApproverWhoIsNotOwner() public {
        _proposeTransfer(alice, ID, recipient, 1e6);
        vm.expectRevert(AskirawaFiTreasury.NotOwner.selector);
        vm.prank(alice); // even the proposer cannot cancel
        treasury.cancel(ID);
    }

    function test_RevertCancelByStranger() public {
        _proposeTransfer(alice, ID, recipient, 1e6);
        vm.expectRevert(AskirawaFiTreasury.NotOwner.selector);
        vm.prank(stranger);
        treasury.cancel(ID);
    }

    function test_RevertCancelNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalNotFound.selector, ID));
        vm.prank(owner);
        treasury.cancel(ID);
    }

    function test_RevertCancelTwice() public {
        _proposeTransfer(alice, ID, recipient, 1e6);
        vm.prank(owner);
        treasury.cancel(ID);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyCancelled.selector, ID));
        vm.prank(owner);
        treasury.cancel(ID);
    }

    function test_RevertCancelExecuted() public {
        _proposeApprove(ID, recipient, 1e6);
        _execute(ID, _one(recipient), _oneU(1e6));
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExecuted.selector, ID));
        vm.prank(owner);
        treasury.cancel(ID);
    }

    function test_RevertCancelExpired() public {
        uint64 exp = _proposeTransfer(alice, ID, recipient, 1e6);
        vm.warp(exp);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalExpired.selector, ID));
        vm.prank(owner);
        treasury.cancel(ID);
    }

    function test_CancelledIdCannotBeReused() public {
        _proposeTransfer(alice, ID, recipient, 1e6);
        vm.prank(owner);
        treasury.cancel(ID);
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExists.selector, ID));
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 1e6, exp);
    }
}
