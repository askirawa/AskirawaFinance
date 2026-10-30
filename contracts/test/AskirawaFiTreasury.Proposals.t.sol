// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {stdError} from "forge-std/StdError.sol";
import {AskirawaFiTreasury} from "../AskirawaFiTreasury.sol";
import {AskirawaFiTreasuryTestBase} from "./AskirawaFiTreasury.Base.t.sol";

/// propose* (transfer / payroll / config) creation, validation and stored state.
contract AskirawaFiTreasuryProposalsTest is AskirawaFiTreasuryTestBase {
    bytes32 internal constant ID = keccak256("proposal-1");

    // ── proposeTransfer ──────────────────────────────────────────────────────

    function test_ProposeTransferStoresProposal() public {
        uint64 exp = _proposeTransfer(alice, ID, recipient, 250e6);

        PView memory p = _prop(ID);
        assertEq(p.txType, 1);
        assertFalse(p.executed);
        assertFalse(p.cancelled);
        assertEq(p.expiresAt, exp);
        assertEq(p.proposer, alice);
        assertEq(p.approvalCount, 0);
        assertEq(p.contentHash, _hash(ID, 1, _one(recipient), _oneU(250e6), exp));
    }

    function test_ProposeTransferEmitsProposed() public {
        uint64 exp = _exp();
        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.Proposed(ID, alice, 1, exp);
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 1e6, exp);
    }

    function test_ProposeTransferDoesNotMoveFunds() public {
        _proposeTransfer(alice, ID, recipient, 250e6);
        assertEq(treasury.balance(), TREASURY_SEED);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_ProposeTransferNotEscrowed() public {
        // No-escrow model: proposing more than the balance is allowed;
        // the balance is only checked at execution time.
        _proposeTransfer(alice, ID, recipient, TREASURY_SEED * 10);
        assertEq(_prop(ID).txType, 1);
    }

    function test_ProposeTransferOwnerNotApproverCannotPropose() public {
        // Make a treasury whose owner is not an approver.
        AskirawaFiTreasury t = new AskirawaFiTreasury(address(usdc), carol, _addrs2(alice, bob), 1);
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        vm.prank(carol);
        t.proposeTransfer(ID, recipient, 1e6, _exp());
    }

    function test_RevertProposeTransferNonApprover() public {
        uint64 exp = _exp();
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        vm.prank(stranger);
        treasury.proposeTransfer(ID, recipient, 1e6, exp);
    }

    function test_RevertProposeTransferDuplicateId() public {
        _proposeTransfer(alice, ID, recipient, 1e6);
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExists.selector, ID));
        vm.prank(bob);
        treasury.proposeTransfer(ID, carol, 2e6, exp);
    }

    function test_RevertProposeTransferDuplicateIdAcrossTypes() public {
        _proposeTransfer(alice, ID, recipient, 1e6);
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExists.selector, ID));
        vm.prank(bob);
        treasury.proposePayroll(ID, _one(carol), _oneU(1e6), exp);
    }

    function test_RevertProposeTransferZeroRecipient() public {
        uint64 exp = _exp();
        vm.expectRevert(bytes("Treasury: zero recipient"));
        vm.prank(alice);
        treasury.proposeTransfer(ID, address(0), 1e6, exp);
    }

    function test_RevertProposeTransferZeroAmount() public {
        uint64 exp = _exp();
        vm.expectRevert(bytes("Treasury: zero amount"));
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 0, exp);
    }

    // ── expiry bounds ────────────────────────────────────────────────────────

    function test_ProposeExpiryLowerBoundInclusive() public {
        uint64 exp = uint64(block.timestamp + 1 hours);
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 1e6, exp);
        assertEq(_prop(ID).expiresAt, exp);
    }

    function test_ProposeExpiryUpperBoundInclusive() public {
        uint64 exp = uint64(block.timestamp + 30 days);
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 1e6, exp);
        assertEq(_prop(ID).expiresAt, exp);
    }

    function test_RevertProposeExpiryJustBelowLowerBound() public {
        uint64 exp = uint64(block.timestamp + 1 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidExpiry.selector, exp));
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 1e6, exp);
    }

    function test_RevertProposeExpiryJustAboveUpperBound() public {
        uint64 exp = uint64(block.timestamp + 30 days + 1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidExpiry.selector, exp));
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 1e6, exp);
    }

    function test_RevertProposeExpiryInPastOrZero() public {
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidExpiry.selector, uint64(0)));
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 1e6, 0);
    }

    function test_ExpiryBoundsMoveWithBlockTimestamp() public {
        vm.warp(1_000_000);
        uint64 exp = uint64(block.timestamp + 30 days);
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 1e6, exp);
        // A timestamp that would have been valid before the warp is now too early.
        uint64 stale = uint64(1_000_000 - 1 days + 1 hours);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidExpiry.selector, stale));
        vm.prank(alice);
        treasury.proposeTransfer(keccak256("other"), recipient, 1e6, stale);
    }

    // ── proposePayroll ───────────────────────────────────────────────────────

    function test_ProposePayrollStoresProposal() public {
        address[] memory r = _addrs2(carol, dave);
        uint256[] memory a = _uints2(10e6, 20e6);
        uint64 exp = _proposePayroll(alice, ID, r, a);

        PView memory p = _prop(ID);
        assertEq(p.txType, 2);
        assertEq(p.proposer, alice);
        assertEq(p.expiresAt, exp);
        assertEq(p.approvalCount, 0);
        assertEq(p.contentHash, _hash(ID, 2, r, a, exp));
    }

    function test_ProposePayrollEmitsProposed() public {
        uint64 exp = _exp();
        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.Proposed(ID, bob, 2, exp);
        vm.prank(bob);
        treasury.proposePayroll(ID, _addrs2(carol, dave), _uints2(1, 2), exp);
    }

    function test_ProposePayrollMaxBatchSizeAccepted() public {
        address[] memory r = new address[](200);
        uint256[] memory a = new uint256[](200);
        for (uint256 i = 0; i < 200; i++) {
            r[i] = address(uint160(0x10000 + i));
            a[i] = 1;
        }
        _proposePayroll(alice, ID, r, a);
        assertEq(_prop(ID).txType, 2);
    }

    function test_RevertProposePayrollNonApprover() public {
        uint64 exp = _exp();
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        vm.prank(stranger);
        treasury.proposePayroll(ID, _one(carol), _oneU(1), exp);
    }

    function test_RevertProposePayrollInvalidExpiry() public {
        uint64 exp = uint64(block.timestamp + 30 days + 1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidExpiry.selector, exp));
        vm.prank(alice);
        treasury.proposePayroll(ID, _one(carol), _oneU(1), exp);
    }

    function test_RevertProposePayrollEmptyBatch() public {
        uint64 exp = _exp();
        vm.expectRevert(AskirawaFiTreasury.EmptyBatch.selector);
        vm.prank(alice);
        treasury.proposePayroll(ID, new address[](0), new uint256[](0), exp);
    }

    function test_RevertProposePayrollBatchTooLarge() public {
        address[] memory r = new address[](201);
        uint256[] memory a = new uint256[](201);
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.BatchTooLarge.selector, uint256(201), uint256(200)));
        vm.prank(alice);
        treasury.proposePayroll(ID, r, a, exp);
    }

    function test_RevertProposePayrollLengthMismatch() public {
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ArrayLengthMismatch.selector, uint256(2), uint256(1)));
        vm.prank(alice);
        treasury.proposePayroll(ID, _addrs2(carol, dave), _oneU(1), exp);
    }

    function test_RevertProposePayrollZeroRecipientReportsIndex() public {
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ZeroRecipient.selector, uint256(1)));
        vm.prank(alice);
        treasury.proposePayroll(ID, _addrs2(carol, address(0)), _uints2(1, 1), exp);
    }

    function test_RevertProposePayrollZeroAmountReportsIndex() public {
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ZeroAmount.selector, uint256(0)));
        vm.prank(alice);
        treasury.proposePayroll(ID, _addrs2(carol, dave), _uints2(0, 1), exp);
    }

    // ── proposeConfigChange ──────────────────────────────────────────────────

    function test_ProposeConfigChangeStoresProposal() public {
        address[] memory na = _addrs3(owner, alice, carol);
        uint64 exp = _proposeConfig(alice, ID, na, 2);

        PView memory p = _prop(ID);
        assertEq(p.txType, 3);
        assertEq(p.proposer, alice);
        assertEq(p.expiresAt, exp);
        assertEq(p.contentHash, _hash(ID, 3, na, _cfgAmounts(3, 2), exp));
    }

    function test_ProposeConfigChangeEmitsProposedAndDoesNotApply() public {
        uint64 exp = _exp();
        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.Proposed(ID, alice, 3, exp);
        vm.prank(alice);
        treasury.proposeConfigChange(ID, _addrs3(owner, alice, carol), 3, exp);

        // Nothing changes until execute().
        assertEq(treasury.quorum(), 2);
        assertTrue(treasury.isApprover(bob));
        assertFalse(treasury.isApprover(carol));
    }

    function test_RevertProposeConfigChangeNonApprover() public {
        uint64 exp = _exp();
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        vm.prank(stranger);
        treasury.proposeConfigChange(ID, _addrs2(alice, bob), 1, exp);
    }

    function test_RevertProposeConfigChangeInvalidExpiry() public {
        uint64 exp = uint64(block.timestamp + 10 minutes);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidExpiry.selector, exp));
        vm.prank(alice);
        treasury.proposeConfigChange(ID, _addrs2(alice, bob), 1, exp);
    }

    function test_RevertProposeConfigChangeEmptyApprovers() public {
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, uint8(1), uint256(0)));
        vm.prank(alice);
        treasury.proposeConfigChange(ID, new address[](0), 1, exp);
    }

    function test_RevertProposeConfigChangeZeroQuorum() public {
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, uint8(0), uint256(2)));
        vm.prank(alice);
        treasury.proposeConfigChange(ID, _addrs2(alice, bob), 0, exp);
    }

    function test_RevertProposeConfigChangeQuorumAboveCount() public {
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, uint8(3), uint256(2)));
        vm.prank(alice);
        treasury.proposeConfigChange(ID, _addrs2(alice, bob), 3, exp);
    }

    function test_RevertProposeConfigChangeDuplicateId() public {
        _proposeConfig(alice, ID, _addrs2(alice, bob), 1);
        uint64 exp = _exp();
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExists.selector, ID));
        vm.prank(bob);
        treasury.proposeConfigChange(ID, _addrs2(alice, bob), 1, exp);
    }

    // ── ids are independent ──────────────────────────────────────────────────

    function test_ManyProposalsCoexist() public {
        _proposeTransfer(alice, keccak256("a"), recipient, 1e6);
        _proposeTransfer(bob, keccak256("b"), recipient, 2e6);
        assertEq(_prop(keccak256("a")).proposer, alice);
        assertEq(_prop(keccak256("b")).proposer, bob);
        assertEq(_prop(keccak256("c")).expiresAt, 0); // never created
    }

    function test_ContentHashBindsProposalId() public {
        bytes32 id2 = keccak256("proposal-2");
        _proposeTransfer(alice, ID, recipient, 5e6);
        _proposeTransfer(alice, id2, recipient, 5e6);
        assertTrue(_prop(ID).contentHash != _prop(id2).contentHash);
    }

    // ── execute: transfer ────────────────────────────────────────────────────

    function test_ExecuteTransferPaysRecipientAndMarksExecuted() public {
        _proposeApprove(ID, recipient, 250e6);
        _execute(ID, _one(recipient), _oneU(250e6));

        assertEq(usdc.balanceOf(recipient), 250e6);
        assertEq(treasury.balance(), TREASURY_SEED - 250e6);
        assertTrue(_prop(ID).executed);
    }

    function test_ExecuteTransferEmitsPaymentSentAndExecuted() public {
        _proposeApprove(ID, recipient, 250e6);

        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.PaymentSent(ID, recipient, 250e6);
        vm.expectEmit(true, false, false, true, address(treasury));
        emit AskirawaFiTreasury.Executed(ID, 1, 250e6);
        _execute(ID, _one(recipient), _oneU(250e6));
    }

    function test_ExecuteIsPermissionless() public {
        _proposeApprove(ID, recipient, 1e6);
        vm.prank(carol); // neither approver nor owner
        treasury.execute(ID, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    function test_ExecuteEntireBalance() public {
        _proposeApprove(ID, recipient, TREASURY_SEED);
        _execute(ID, _one(recipient), _oneU(TREASURY_SEED));
        assertEq(treasury.balance(), 0);
        assertEq(usdc.balanceOf(recipient), TREASURY_SEED);
    }

    function test_RevertExecuteTwice() public {
        _proposeApprove(ID, recipient, 1e6);
        _execute(ID, _one(recipient), _oneU(1e6));
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExecuted.selector, ID));
        treasury.execute(ID, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    function test_RevertExecuteNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalNotFound.selector, ID));
        treasury.execute(ID, _one(recipient), _oneU(1e6));
    }

    function test_RevertExecuteExpiredEvenWithQuorum() public {
        uint64 exp = _proposeApprove(ID, recipient, 1e6);
        vm.warp(exp);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalExpired.selector, ID));
        treasury.execute(ID, _one(recipient), _oneU(1e6));
    }

    function test_ExecuteAllowedOneSecondBeforeExpiry() public {
        uint64 exp = _proposeApprove(ID, recipient, 1e6);
        vm.warp(exp - 1);
        treasury.execute(ID, _one(recipient), _oneU(1e6));
        assertEq(usdc.balanceOf(recipient), 1e6);
    }

    function test_RevertExecuteInsufficientTreasuryBalance() public {
        uint256 want = TREASURY_SEED + 1;
        _proposeApprove(ID, recipient, want);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.InsufficientTreasuryBalance.selector, TREASURY_SEED, want)
        );
        treasury.execute(ID, _one(recipient), _oneU(want));
        assertFalse(_prop(ID).executed);
    }

    function test_InsufficientBalanceExecuteCanBeRetriedAfterDeposit() public {
        uint256 want = TREASURY_SEED + 5e6;
        _proposeApprove(ID, recipient, want);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.InsufficientTreasuryBalance.selector, TREASURY_SEED, want)
        );
        treasury.execute(ID, _one(recipient), _oneU(want));

        usdc.mint(carol, 5e6);
        vm.startPrank(carol);
        usdc.approve(address(treasury), 5e6);
        treasury.deposit(5e6);
        vm.stopPrank();

        treasury.execute(ID, _one(recipient), _oneU(want));
        assertEq(usdc.balanceOf(recipient), want);
    }

    function test_NoEscrowSecondApprovedProposalFailsWhenBalanceConsumed() public {
        bytes32 id2 = keccak256("proposal-2");
        uint256 big = (TREASURY_SEED * 60) / 100;
        _proposeApprove(ID, recipient, big);
        _proposeApprove(id2, carol, big);

        treasury.execute(ID, _one(recipient), _oneU(big));
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.InsufficientTreasuryBalance.selector, TREASURY_SEED - big, big)
        );
        treasury.execute(id2, _one(carol), _oneU(big));
    }

    // ── execute: payload binding ─────────────────────────────────────────────

    function test_RevertExecuteWithDifferentAmount() public {
        _proposeApprove(ID, recipient, 10e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, ID));
        treasury.execute(ID, _one(recipient), _oneU(10e6 + 1));
    }

    function test_RevertExecuteWithDifferentRecipient() public {
        _proposeApprove(ID, recipient, 10e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, ID));
        treasury.execute(ID, _one(stranger), _oneU(10e6));
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_RevertExecuteWithExtraRecipient() public {
        _proposeApprove(ID, recipient, 10e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, ID));
        treasury.execute(ID, _addrs2(recipient, stranger), _uints2(10e6, 1));
    }

    function test_RevertExecuteWithEmptyArrays() public {
        _proposeApprove(ID, recipient, 10e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, ID));
        treasury.execute(ID, new address[](0), new uint256[](0));
    }

    function test_RevertExecuteWithAmountsShorterThanRecipients() public {
        // execute() copies amounts[i] for every recipient before hashing, so a
        // shorter amounts array is an out-of-bounds access (Panic 0x32).
        _proposeApprove(ID, recipient, 10e6);
        vm.expectRevert(stdError.indexOOBError);
        treasury.execute(ID, _addrs2(recipient, stranger), _oneU(10e6));
    }

    function test_RevertExecutePayrollReorderedRecipients() public {
        address[] memory r = _addrs2(carol, dave);
        uint256[] memory a = _uints2(10e6, 20e6);
        _proposePayroll(owner, ID, r, a);
        _vote(alice, ID);
        _vote(bob, ID);
        // Swap recipients but keep amounts in place: different binding.
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, ID));
        treasury.execute(ID, _addrs2(dave, carol), a);
    }

    // ── execute: payroll ─────────────────────────────────────────────────────

    function test_ExecutePayrollPaysEveryRecipient() public {
        address[] memory r = _addrs2(carol, dave);
        uint256[] memory a = _uints2(10e6, 20e6);
        _proposePayroll(owner, ID, r, a);
        _vote(alice, ID);
        _vote(bob, ID);

        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.PaymentSent(ID, carol, 10e6);
        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.PaymentSent(ID, dave, 20e6);
        vm.expectEmit(true, false, false, true, address(treasury));
        emit AskirawaFiTreasury.Executed(ID, 2, 30e6);
        _execute(ID, r, a);

        assertEq(usdc.balanceOf(carol), 10e6);
        assertEq(usdc.balanceOf(dave), 20e6);
        assertEq(treasury.balance(), TREASURY_SEED - 30e6);
        assertTrue(_prop(ID).executed);
    }

    function test_ExecutePayrollWithRepeatedRecipientPaysBothAmounts() public {
        address[] memory r = _addrs2(carol, carol);
        uint256[] memory a = _uints2(1e6, 2e6);
        _proposePayroll(owner, ID, r, a);
        _vote(alice, ID);
        _vote(bob, ID);
        _execute(ID, r, a);
        assertEq(usdc.balanceOf(carol), 3e6);
    }

    function test_PayrollIsAtomicWhenOneTransferFails() public {
        address[] memory r = _addrs2(carol, dave);
        uint256[] memory a = _uints2(10e6, 20e6);
        _proposePayroll(owner, ID, r, a);
        _vote(alice, ID);
        _vote(bob, ID);

        usdc.setBlockedRecipient(dave, true);
        vm.expectRevert(bytes("MockERC20: blocked recipient"));
        treasury.execute(ID, r, a);

        // Whole call reverted: no partial payment, proposal still executable.
        assertEq(usdc.balanceOf(carol), 0);
        assertEq(treasury.balance(), TREASURY_SEED);
        assertFalse(_prop(ID).executed);

        usdc.setBlockedRecipient(dave, false);
        treasury.execute(ID, r, a);
        assertEq(usdc.balanceOf(carol), 10e6);
        assertEq(usdc.balanceOf(dave), 20e6);
    }

    function test_RevertExecutePayrollInsufficientForTotal() public {
        // Each amount individually fits, the sum does not.
        address[] memory r = _addrs2(carol, dave);
        uint256[] memory a = _uints2(TREASURY_SEED, 1);
        _proposePayroll(owner, ID, r, a);
        _vote(alice, ID);
        _vote(bob, ID);
        vm.expectRevert(
            abi.encodeWithSelector(
                AskirawaFiTreasury.InsufficientTreasuryBalance.selector, TREASURY_SEED, TREASURY_SEED + 1
            )
        );
        treasury.execute(ID, r, a);
    }
}
