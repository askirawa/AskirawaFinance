// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";

/// @notice G-EPOCH 01-06: snapshots, fencing, removed approvers, historical epochs.
contract AskirawaTreasuryEpochTest is AskirawaTreasuryTestBase {
    address internal newApprover = makeAddr("newApprover");
    address internal newProposer = makeAddr("newProposer");
    address internal newGuardian = makeAddr("newGuardian");

    /// @dev Epoch-2 config: approver3 removed, newApprover added, quorum 3, longer delays.
    function _cfg2() internal view returns (AskirawaTreasury.GovernancePayload memory c) {
        c.approvers = _arr(approver1, approver2, newApprover);
        c.proposers = _arr(newProposer, payee1);
        c.quorum = 3;
        c.guardian = newGuardian;
        c.payrollDelay = 3 days;
        c.configDelay = 4 days;
    }

    function _wrongEpoch(uint64 pe, uint256 ae) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(AskirawaTreasury.WrongEpoch.selector, uint256(pe), ae);
    }

    // ------------------------------------------------------------ G-EPOCH-01
    function test_EPOCH01_ProposalStoresEpochAndQuorumSnapshot() public {
        uint256 p1 = _proposePayroll(approver1, payee1, 10e6);
        AskirawaTreasury.Proposal memory a = t.getProposal(p1);
        assertEq(a.epoch, 1);
        assertEq(a.quorum, 2);

        _govPass(_cfg2()); // epoch 2, quorum 3
        uint256 p2 = _proposePayroll(newProposer, payee1, 10e6);
        AskirawaTreasury.Proposal memory b = t.getProposal(p2);
        assertEq(b.epoch, 2);
        assertEq(b.quorum, 3);
        // the earlier proposal's snapshot is untouched by the epoch change
        AskirawaTreasury.Proposal memory a2 = t.getProposal(p1);
        assertEq(a2.epoch, 1);
        assertEq(a2.quorum, 2);
    }

    function test_EPOCH01_NewEpochQuorumGovernsNewProposalExecution() public {
        _govPass(_cfg2());
        uint256 id = _proposePayroll(newProposer, payee1, 10e6); // newProposer is not an approver: 0 approvals
        _approve(id, approver1);
        _approve(id, approver2);
        assertEq(t.getProposal(id).approvedAt, 0, "2 of 3 is not quorum in epoch 2");
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Pending));
        _approve(id, newApprover);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Approved));
        assertEq(t.getProposal(id).executableAt, t.getProposal(id).approvedAt + 3 days, "epoch-2 payroll delay");
    }

    // ------------------------------------------------------------ G-EPOCH-02 / 03
    function test_EPOCH02_OnlyCurrentEpochApproverSetCanVoteOnNewProposal() public {
        _govPass(_cfg2());
        uint256 id = _proposePayroll(newProposer, payee1, 10e6);
        vm.prank(approver3); // approver of epoch 1, not of epoch 2
        vm.expectRevert(AskirawaTreasury.NotApprover.selector);
        t.approve(id);
        _approve(id, newApprover); // approver of epoch 2 only
        assertEq(t.getProposal(id).approvals, 1);
        _approve(id, approver1); // approver of both
        assertEq(t.getProposal(id).approvals, 2);
    }

    function test_EPOCH03_RemovedApproverCannotVoteProposeOrPause() public {
        _govPass(_cfg2());
        uint256 id = _proposePayroll(newProposer, payee1, 10e6);
        vm.prank(approver3);
        vm.expectRevert(AskirawaTreasury.NotApprover.selector);
        t.reject(id);
        vm.prank(approver3);
        vm.expectRevert(AskirawaTreasury.NotApprover.selector);
        t.approve(id);
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        uint64 exp = _exp();
        vm.prank(approver3);
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposePayroll(items, exp, MEMO);
        vm.prank(approver3);
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.pause();
        // old guardian also loses its power
        vm.prank(guardian);
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.pause();
        // an old explicit proposer is dropped too
        vm.prank(proposerOnly);
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposePayroll(items, exp, MEMO);
    }

    // ------------------------------------------------------------ G-EPOCH-04
    function test_EPOCH04_PendingProposalFencedAfterEpochChange() public {
        uint256 p = _proposePayroll(approver1, payee1, 10e6);
        _approve(p, approver2); // quorum reached under epoch 1
        _warpToExecutable(p);
        assertEq(uint8(_status(p)), uint8(AskirawaTreasury.ProposalStatus.Executable));

        _govPass(_cfg2());
        assertEq(uint8(_status(p)), uint8(AskirawaTreasury.ProposalStatus.Fenced));

        vm.expectRevert(_wrongEpoch(1, 2));
        t.execute(p);
        vm.prank(approver3);
        vm.expectRevert(_wrongEpoch(1, 2));
        t.approve(p);
        vm.prank(approver1); // even a member of both epochs
        vm.expectRevert(_wrongEpoch(1, 2));
        t.reject(p);
        vm.prank(newApprover);
        vm.expectRevert(_wrongEpoch(1, 2));
        t.approve(p);
        assertEq(usdc.balanceOf(payee1), 0, "nothing paid");
        assertEq(t.getProposal(p).approvals, 2, "votes unchanged");
    }

    function test_EPOCH04_FencedProposalCanStillBeCancelledByProposerAndExpires() public {
        uint256 p = _proposePayroll(approver1, payee1, 10e6);
        uint256 q = _proposePayroll(approver1, payee2, 10e6);
        _govPass(_cfg2());
        vm.prank(approver1);
        t.cancel(p);
        assertEq(uint8(_status(p)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
        // expiry takes precedence over fenced
        vm.warp(t.getProposal(q).expiresAt);
        assertEq(uint8(_status(q)), uint8(AskirawaTreasury.ProposalStatus.Expired));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.Expired.selector, q));
        t.execute(q);
    }

    // ------------------------------------------------------------ G-EPOCH-05
    function test_EPOCH05_TwoGovernanceProposalsSecondIsFenced() public {
        AskirawaTreasury.GovernancePayload memory c2 = _cfg2();
        AskirawaTreasury.GovernancePayload memory c3 = _cfg();
        c3.quorum = 3;
        uint256 g1 = _proposeGov(approver1, c2);
        uint256 g2 = _proposeGov(approver2, c3);
        _reachQuorum(g1);
        _reachQuorum(g2);
        AskirawaTreasury.Proposal memory pg2 = t.getProposal(g2);
        assertEq(pg2.epoch, 1);
        assertGe(pg2.approvals, pg2.quorum, "second one reached quorum too");
        _warpToExecutable(g1);
        _warpToExecutable(g2);
        _exec(g1);
        assertEq(t.currentEpoch(), 2);
        assertEq(uint8(_status(g2)), uint8(AskirawaTreasury.ProposalStatus.Fenced));
        vm.expectRevert(_wrongEpoch(1, 2));
        t.execute(g2);
        assertEq(t.currentEpoch(), 2, "second proposal did not create an epoch");
        assertEq(t.quorum(), 3);
        assertEq(t.getEpoch(2).guardian, newGuardian);
    }

    // ------------------------------------------------------------ G-EPOCH-06
    function test_EPOCH06_OldEpochsReadableAndUnchanged() public {
        bytes32 h1 = keccak256(abi.encode(t.getEpoch(1)));
        _govPass(_cfg2());
        bytes32 h2 = keccak256(abi.encode(t.getEpoch(2)));
        assertEq(keccak256(abi.encode(t.getEpoch(1))), h1);

        AskirawaTreasury.GovernancePayload memory c3 = _cfg();
        c3.approvers = _arr(approver3, newApprover, outsider);
        c3.quorum = 2;
        c3.proposers = new address[](0);
        c3.guardian = address(0);
        // epoch 2 quorum is 3: need all three of its approvers
        uint256 id = _proposeGov(approver1, c3);
        _approve(id, approver2);
        _approve(id, newApprover);
        _warpToExecutable(id);
        _exec(id);

        assertEq(t.currentEpoch(), 3);
        assertEq(keccak256(abi.encode(t.getEpoch(1))), h1, "epoch 1 unchanged");
        assertEq(keccak256(abi.encode(t.getEpoch(2))), h2, "epoch 2 unchanged");
        assertEq(t.getEpoch(1).approvers.length, 3);
        assertEq(t.getEpoch(2).quorum, 3);
        assertEq(t.getEpoch(3).guardian, address(0));
        assertEq(t.approverCount(1), 3);
        assertEq(t.approverCount(2), 3);
        assertEq(t.approverCount(), 3);
        assertEq(t.approverCount(4), 0);
        assertEq(t.getEpoch(4).approvers.length, 0, "future epoch empty");
        assertEq(t.getEpoch(0).approvers.length, 0, "epoch zero empty");
    }

    function test_EPOCH06_IsApproverAtCorrectness() public {
        _govPass(_cfg2());
        // epoch 1
        assertTrue(t.isApproverAt(1, approver1));
        assertTrue(t.isApproverAt(1, approver2));
        assertTrue(t.isApproverAt(1, approver3));
        assertFalse(t.isApproverAt(1, newApprover));
        assertFalse(t.isApproverAt(1, proposerOnly), "proposer is not an approver");
        // epoch 2
        assertTrue(t.isApproverAt(2, approver1));
        assertTrue(t.isApproverAt(2, approver2));
        assertFalse(t.isApproverAt(2, approver3));
        assertTrue(t.isApproverAt(2, newApprover));
        assertFalse(t.isApproverAt(2, newProposer));
        // nonexistent epochs
        assertFalse(t.isApproverAt(0, approver1));
        assertFalse(t.isApproverAt(3, approver1));
        assertFalse(t.isApproverAt(type(uint256).max, approver1));
        // isApprover == isApproverAt(current)
        assertEq(t.isApprover(approver3), t.isApproverAt(t.currentEpoch(), approver3));
        assertEq(t.isApprover(newApprover), t.isApproverAt(t.currentEpoch(), newApprover));
        // role flags are per epoch
        assertEq(t.roleFlags(1, approver3), 1);
        assertEq(t.roleFlags(2, approver3), 0);
        assertEq(t.roleFlags(2, newProposer), 2);
    }

    function testFuzz_EPOCH06_FutureEpochsHaveNoApprovers(uint256 epoch, address who) public view {
        epoch = bound(epoch, 2, type(uint256).max);
        assertFalse(t.isApproverAt(epoch, who));
        assertFalse(t.isApproverAt(epoch, approver1));
    }
}
