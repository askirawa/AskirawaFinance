// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";

/// @notice G-VOTE 01-06 plus QuorumReached timing per action class.
contract AskirawaTreasuryVoteTest is AskirawaTreasuryTestBase {
    AskirawaTreasury.ProposalStatus internal constant PENDING = AskirawaTreasury.ProposalStatus.Pending;
    AskirawaTreasury.ProposalStatus internal constant REJECTED = AskirawaTreasury.ProposalStatus.Rejected;

    function _is(uint256 id, AskirawaTreasury.ProposalStatus s) internal view returns (bool) {
        return _status(id) == s;
    }

    function _alreadyVoted(uint256 id, address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(AskirawaTreasury.AlreadyVoted.selector, id, who);
    }

    function _notPending(uint256 id) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(AskirawaTreasury.NotPending.selector, id);
    }

    // ------------------------------------------------------------ G-VOTE-01
    function test_VOTE01_ApproverProposerAutoApprovesOnce() public {
        uint64 exp = _exp();
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 5e6);
        vm.expectEmit(true, true, true, false, address(t));
        emit AskirawaTreasury.Proposed(1, 1, approver1, AskirawaTreasury.Action.Payroll, 5e6, exp, bytes32(0), MEMO);
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.Voted(1, approver1, 1, 1, 0);
        vm.prank(approver1);
        uint256 id = t.proposePayroll(items, exp, MEMO);

        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        assertEq(p.approvals, 1);
        assertEq(p.rejections, 0);
        assertEq(t.voteOf(id, approver1), 1);
        address[] memory v = t.voters(id);
        assertEq(v.length, 1);
        assertEq(v[0], approver1);
        assertEq(p.approvedAt, 0, "quorum 2 not yet reached");

        vm.prank(approver1);
        vm.expectRevert(_alreadyVoted(id, approver1));
        t.approve(id);
        vm.prank(approver1);
        vm.expectRevert(_alreadyVoted(id, approver1));
        t.reject(id);
        assertEq(t.getProposal(id).approvals, 1, "still one approval");
    }

    function test_VOTE01_EveryProposalKindAutoApprovesApproverProposer() public {
        for (uint256 k; k < 6; ++k) {
            uint256 id = _proposeAny(Kind(k), approver2);
            assertEq(t.getProposal(id).approvals, 1, "auto-approval");
            assertEq(t.voteOf(id, approver2), 1);
        }
    }

    // ------------------------------------------------------------ G-VOTE-02
    function test_VOTE02_NonApproverProposerDoesNotCount() public {
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        assertEq(p.proposer, proposerOnly);
        assertEq(p.approvals, 0);
        assertEq(p.rejections, 0);
        assertEq(t.voteOf(id, proposerOnly), 0);
        assertEq(t.voters(id).length, 0);

        vm.prank(proposerOnly);
        vm.expectRevert(AskirawaTreasury.NotApprover.selector);
        t.approve(id);
        _approve(id, approver1);
        assertEq(uint8(_status(id)), uint8(PENDING), "1 of 2: proposer contributed nothing");
        _approve(id, approver2);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Approved));
    }

    // ------------------------------------------------------------ G-VOTE-03
    function test_VOTE03_DoubleVoteReverts() public {
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        _approve(id, approver2);
        vm.prank(approver2);
        vm.expectRevert(_alreadyVoted(id, approver2));
        t.approve(id);
        vm.prank(approver2);
        vm.expectRevert(_alreadyVoted(id, approver2));
        t.reject(id);

        _reject(id, approver3);
        vm.prank(approver3);
        vm.expectRevert(_alreadyVoted(id, approver3));
        t.reject(id);
        vm.prank(approver3);
        vm.expectRevert(_alreadyVoted(id, approver3));
        t.approve(id);
        assertEq(t.voteOf(id, approver2), 1);
        assertEq(t.voteOf(id, approver3), 2);
        assertEq(t.getProposal(id).approvals, 1);
        assertEq(t.getProposal(id).rejections, 1);
    }

    // ------------------------------------------------------------ G-VOTE-04
    function test_VOTE04_NonApproverCannotVote() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        address[4] memory nobody = [outsider, proposerOnly, guardian, payee1];
        for (uint256 i; i < nobody.length; ++i) {
            vm.prank(nobody[i]);
            vm.expectRevert(AskirawaTreasury.NotApprover.selector);
            t.approve(id);
            vm.prank(nobody[i]);
            vm.expectRevert(AskirawaTreasury.NotApprover.selector);
            t.reject(id);
        }
        assertEq(t.getProposal(id).approvals, 1);
        assertEq(t.getProposal(id).rejections, 0);
    }

    function test_VOTE04_NonexistentProposalIsNotPending() public {
        vm.prank(approver1);
        vm.expectRevert(_notPending(99));
        t.approve(99);
        vm.prank(approver1);
        vm.expectRevert(_notPending(0));
        t.reject(0);
    }

    // ------------------------------------------------------------ G-VOTE-05
    function test_VOTE05_RejectedExactlyWhenQuorumImpossible() public {
        // 3 approvers, quorum 2 -> Rejected once rejections > 3 - 2 = 1, i.e. at the 2nd rejection.
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        _reject(id, approver1);
        assertTrue(_is(id, PENDING), "1 rejection not enough");
        vm.expectEmit(true, false, false, false, address(t));
        emit AskirawaTreasury.Rejected(id);
        _reject(id, approver2);
        assertTrue(_is(id, REJECTED), "2nd rejection terminal");
        assertEq(t.getProposal(id).rejections, 2);

        vm.prank(approver3);
        vm.expectRevert(_notPending(id));
        t.approve(id);
        vm.prank(approver3);
        vm.expectRevert(_notPending(id));
        t.reject(id);
        vm.expectRevert(_notPending(id));
        t.execute(id);
        vm.prank(proposerOnly);
        vm.expectRevert(_notPending(id));
        t.cancel(id);
    }

    function test_VOTE05_AutoApprovedProposalRejectedByTwoOthers() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6); // 1 approval
        _reject(id, approver2);
        assertTrue(_is(id, PENDING));
        _reject(id, approver3);
        assertTrue(_is(id, REJECTED), "approver3 could never reach quorum 2 of 3");
    }

    function test_VOTE05_OneApprovalPlusOneRejectionStaysPending() public {
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        _reject(id, approver1);
        _approve(id, approver2);
        assertTrue(_is(id, PENDING), "approver3 could still approve");
        _approve(id, approver3);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Approved));
    }

    function _setupSet(uint256 n, uint256 q) internal {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = _accts(n, 0);
        c.quorum = uint8(q);
        c.proposers = _arr(proposerOnly, payee1);
        _govPass(c);
    }

    function testFuzz_VOTE05_PureRejectionsThreshold(uint8 nRaw, uint8 qRaw) public {
        uint256 n = bound(nRaw, 2, 20);
        uint256 q = bound(qRaw, 2, n);
        _setupSet(n, q);
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        for (uint256 i; i < n - q; ++i) {
            _reject(id, _acct(i));
            assertTrue(_is(id, PENDING), "rejections <= n-q keep it alive");
        }
        _reject(id, _acct(n - q));
        assertTrue(_is(id, REJECTED), "rejections == n-q+1 is terminal");
        assertEq(t.getProposal(id).rejections, n - q + 1);
    }

    function testFuzz_VOTE05_MixedVotesRejectedOnlyOnLastVoter(uint8 nRaw, uint8 qRaw) public {
        uint256 n = bound(nRaw, 2, 20);
        uint256 q = bound(qRaw, 2, n);
        _setupSet(n, q);
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        for (uint256 i; i < q - 1; ++i) _approve(id, _acct(i)); // q-1 approvals: no quorum
        assertTrue(_is(id, PENDING));
        for (uint256 i = q - 1; i < n; ++i) {
            _reject(id, _acct(i));
            // rejections so far = i - (q-2); terminal only when it exceeds n-q
            assertEq(_is(id, REJECTED), i == n - 1, "terminal exactly at the last remaining voter");
        }
    }

    // ------------------------------------------------------------ G-VOTE-06
    function test_VOTE06_VoteAtExpiryBoundary() public {
        uint64 exp = _now() + PAYROLL_DELAY + 1 hours;
        uint256 id = _proposePayrollExp(proposerOnly, payee1, 5e6, exp);
        vm.warp(exp - 1);
        _approve(id, approver1); // last second: allowed
        vm.warp(exp);
        vm.prank(approver2);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.Expired.selector, id));
        t.approve(id);
        vm.prank(approver3);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.Expired.selector, id));
        t.reject(id);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Expired));
        vm.warp(exp + 365 days);
        vm.prank(approver2);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.Expired.selector, id));
        t.approve(id);
    }

    function test_VOTE06_VoteAfterCancelReverts() public {
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        vm.prank(proposerOnly);
        t.cancel(id);
        vm.prank(approver1);
        vm.expectRevert(_notPending(id));
        t.approve(id);
        vm.prank(approver1);
        vm.expectRevert(_notPending(id));
        t.reject(id);
    }

    function test_VOTE06_VoteAfterExecuteReverts() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        _pass(id); // approver1 + approver2, then execute
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executed));
        vm.prank(approver3);
        vm.expectRevert(_notPending(id));
        t.approve(id);
        vm.prank(approver3);
        vm.expectRevert(_notPending(id));
        t.reject(id);
    }

    // ------------------------------------------------------------ QuorumReached
    function _quorumReachedFor(Kind k) internal {
        _prep(k);
        uint256 id = _proposeKind(k, proposerOnly, _exp());
        AskirawaTreasury.Proposal memory p0 = t.getProposal(id);
        assertEq(p0.approvedAt, 0);
        assertEq(p0.executableAt, 0);
        _approve(id, approver1);
        assertEq(t.getProposal(id).approvedAt, 0, "one approval: no quorum");

        uint64 ts = _now();
        uint64 delay = _delayOf(k);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.QuorumReached(id, ts, ts + delay);
        _approve(id, approver2);
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        assertEq(p.approvedAt, ts);
        assertEq(p.executableAt, ts + delay);
        assertEq(p.approvals, 2);

        // a later approval neither restarts nor shortens the delay
        vm.warp(ts + 5);
        _approve(id, approver3);
        AskirawaTreasury.Proposal memory p2 = t.getProposal(id);
        assertEq(p2.approvals, 3);
        assertEq(p2.approvedAt, ts);
        assertEq(p2.executableAt, ts + delay);
    }

    function test_VOTE_QuorumReachedPayroll() public { _quorumReachedFor(Kind.Payroll); }
    function test_VOTE_QuorumReachedGovernance() public { _quorumReachedFor(Kind.Governance); }
    function test_VOTE_QuorumReachedModuleConfig() public { _quorumReachedFor(Kind.ModuleConfig); }
    function test_VOTE_QuorumReachedModuleAction() public { _quorumReachedFor(Kind.ModuleAction); }
    function test_VOTE_QuorumReachedRescue() public { _quorumReachedFor(Kind.Rescue); }
    function test_VOTE_QuorumReachedUnpause() public { _quorumReachedFor(Kind.Unpause); }

    function test_VOTE_DelayClassesDiffer() public view {
        // fixture sanity: the two classes use different flat delays so a mix-up would be caught above
        assertTrue(t.payrollDelay() != t.configDelay());
    }

    function test_VOTE_QuorumDelayUsesProposalEpochNotCurrent() public {
        // Epoch-2 delays differ from epoch-1; a proposal snapshotted in epoch 2 uses epoch-2 delays.
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.payrollDelay = 3 days;
        c.configDelay = 4 days;
        _govPass(c);
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        _approve(id, approver1);
        _approve(id, approver2);
        assertEq(t.getProposal(id).executableAt, t.getProposal(id).approvedAt + 3 days);
    }
}
