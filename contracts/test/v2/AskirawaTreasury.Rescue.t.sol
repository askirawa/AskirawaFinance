// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";

/// @notice G-RESCUE 01-03: non-USDC rescue only by an approved, delayed, once-only proposal.
contract AskirawaTreasuryRescueTest is AskirawaTreasuryTestBase {
    // ------------------------------------------------------------ G-RESCUE-01
    function test_RESCUE01_SucceedsOnlyAfterQuorumAndDelayWithExactEvents() public {
        uint256 id = _proposeRescue(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.QuorumNotReached.selector, id, 1, 2));
        t.execute(id);
        _approve(id, approver2);
        uint64 at = t.getProposal(id).executableAt;
        assertEq(at, t.getProposal(id).approvedAt + PAYROLL_DELAY, "rescue uses the payout-class delay");
        vm.warp(at - 1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.DelayNotElapsed.selector, at));
        t.execute(id);
        assertEq(other.balanceOf(rescueTo), 0);
        vm.warp(at);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.Rescued(id, address(other), rescueTo, RESCUE_AMOUNT);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.Executed(id, AskirawaTreasury.Action.Rescue, 0);
        _exec(id);
        assertEq(other.balanceOf(rescueTo), RESCUE_AMOUNT);
        assertEq(other.balanceOf(address(t)), RESCUE_AMOUNT * 9);
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS, "USDC untouched");
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executed));
    }

    function test_RESCUE01_NoDirectRescueEntryPoint() public {
        string[4] memory sigs = ["rescue(address,address,uint256)", "rescueToken(address,address,uint256)",
            "sweep(address,address)", "recoverERC20(address,uint256)"];
        for (uint256 i; i < sigs.length; ++i) {
            vm.prank(approver1);
            (bool ok,) = address(t).call(abi.encodeWithSignature(sigs[i], address(other), rescueTo, RESCUE_AMOUNT));
            assertFalse(ok, sigs[i]);
        }
        assertEq(other.balanceOf(rescueTo), 0);
    }

    function test_RESCUE01_OnlyListedProposersCanPropose() public {
        uint64 exp = _exp();
        address tok = address(other);
        vm.prank(outsider);
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposeRescue(tok, rescueTo, RESCUE_AMOUNT, exp, MEMO);
        vm.prank(guardian);
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposeRescue(tok, rescueTo, RESCUE_AMOUNT, exp, MEMO);
    }

    function test_RESCUE01_PayloadStoredAndHashed() public {
        uint256 id = _proposeRescue(proposerOnly);
        bytes memory expected = abi.encode(AskirawaTreasury.RescuePayload(address(other), rescueTo, RESCUE_AMOUNT));
        assertEq(t.getPayload(id), expected);
        assertEq(t.getProposal(id).payloadHash, keccak256(expected));
        assertEq(t.getProposal(id).totalAmount, 0);
        assertEq(uint8(t.getProposal(id).action), uint8(AskirawaTreasury.Action.Rescue));
    }

    function test_RESCUE01_RejectedOrCancelledRescueMovesNothing() public {
        uint256 id = _proposeRescue(proposerOnly);
        _reject(id, approver1);
        _reject(id, approver2);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Rejected));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NotPending.selector, id));
        t.execute(id);
        uint256 c = _proposeRescue(approver1);
        vm.prank(guardian);
        t.cancel(c);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NotPending.selector, c));
        t.execute(c);
        assertEq(other.balanceOf(rescueTo), 0);
    }

    // ------------------------------------------------------------ G-RESCUE-02 USDC / invalid inputs
    function test_RESCUE02_UsdcRescueRevertsAtProposeTime() public {
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(AskirawaTreasury.CannotRescueUSDC.selector);
        t.proposeRescue(address(usdc), rescueTo, 1e6, exp, MEMO);
        assertEq(t.nextProposalId(), 1, "no proposal was created");
    }

    function test_RESCUE02_NonContractTokenReverts() public {
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NoCode.selector, outsider));
        t.proposeRescue(outsider, rescueTo, 1e6, exp, MEMO);
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NoCode.selector, address(0)));
        t.proposeRescue(address(0), rescueTo, 1e6, exp, MEMO);
    }

    function test_RESCUE02_ZeroRecipientAndZeroAmountRevert() public {
        uint64 exp = _exp();
        address tok = address(other);
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)));
        t.proposeRescue(tok, address(0), 1e6, exp, MEMO);
        vm.prank(approver1);
        vm.expectRevert(AskirawaTreasury.ZeroAmount.selector);
        t.proposeRescue(tok, rescueTo, 0, exp, MEMO);
    }

    function test_RESCUE02_RescueOfOtherTokenNeverMovesUsdc() public {
        uint256 before_ = usdc.balanceOf(address(t));
        _rescuePass();
        assertEq(usdc.balanceOf(address(t)), before_);
        assertEq(usdc.balanceOf(rescueTo), 0);
    }

    function test_RESCUE02_RescueMoreThanHeldRevertsAtomically() public {
        uint64 exp = _exp();
        address tok = address(other);
        vm.prank(approver1);
        uint256 id = t.proposeRescue(tok, rescueTo, RESCUE_AMOUNT * 11, exp, MEMO);
        _reachQuorum(id);
        _warpToExecutable(id);
        vm.expectRevert(bytes("balance"));
        t.execute(id);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        assertEq(other.balanceOf(address(t)), RESCUE_AMOUNT * 10);
        // after the token arrives the same proposal can still run (funds are not reserved)
        other.mint(address(t), RESCUE_AMOUNT);
        t.execute(id);
        assertEq(other.balanceOf(rescueTo), RESCUE_AMOUNT * 11);
    }

    // ------------------------------------------------------------ G-RESCUE-03 once only
    function test_RESCUE03_ExecutesOnce() public {
        uint256 id = _rescuePass();
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NotPending.selector, id));
        t.execute(id);
        assertEq(other.balanceOf(rescueTo), RESCUE_AMOUNT);
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NotPending.selector, id));
        t.cancel(id);
    }

    // ------------------------------------------------------------ pause behaviour (design: pause blocks all non-governance/unpause executions)
    function test_RESCUE_PausedTreasuryBlocksRescueExecutionUntilUnpaused() public {
        uint256 id = _proposeRescue(approver1);
        _reachQuorum(id);
        _warpToExecutable(id);
        _pause();
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.TreasuryPaused.selector));
        t.execute(id);
        assertEq(other.balanceOf(rescueTo), 0);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        // proposing a rescue is still allowed while paused
        _proposeRescue(approver1);
        _unpausePass();
        t.execute(id);
        assertEq(other.balanceOf(rescueTo), RESCUE_AMOUNT);
    }

    /// @dev Finds the stored payload's data slot without assuming a layout: the only slot read by getPayload that holds
    /// the long-bytes length marker (2 * 96 + 1) is the bytes header; the data starts at keccak256(header).
    function _payloadDataSlot(uint256 id) internal returns (bytes32 dataSlot) {
        vm.record();
        t.getPayload(id);
        (bytes32[] memory reads,) = vm.accesses(address(t));
        bytes32 header;
        for (uint256 i; i < reads.length; ++i) {
            if (uint256(vm.load(address(t), reads[i])) == 96 * 2 + 1) { header = reads[i]; break; }
        }
        assertTrue(header != bytes32(0), "payload header slot located");
        dataSlot = keccak256(abi.encode(header));
    }

    function _word(bytes32 slot, uint256 i) internal pure returns (bytes32) { return bytes32(uint256(slot) + i); }

    /// @dev Replaces the old tautology (decode a valid payload, assert the token is not USDC). The execution-time guard
    /// is exercised for real: the stored payload is corrupted through storage so that the proposal's approved payload no
    /// longer satisfies the rescue rules, and execute must refuse every variant without moving a single unit.
    function test_RESCUE_ExecutionRevalidatesTheStoredPayloadSoCorruptionCannotMoveUsdcOrBurnFunds() public {
        uint256 id = _proposeRescue(approver1);
        _reachQuorum(id);
        _warpToExecutable(id);
        bytes32 data = _payloadDataSlot(id);
        assertEq(address(uint160(uint256(vm.load(address(t), data)))), address(other), "word 0 is the token");
        assertEq(address(uint160(uint256(vm.load(address(t), _word(data, 1))))), rescueTo, "word 1 is the recipient");
        assertEq(uint256(vm.load(address(t), _word(data, 2))), RESCUE_AMOUNT, "word 2 is the amount");
        bytes32 tokenWord = vm.load(address(t), data);
        bytes32 toWord = vm.load(address(t), _word(data, 1));
        bytes32 amountWord = vm.load(address(t), _word(data, 2));
        uint256 usdcBefore = usdc.balanceOf(address(t));
        uint256 otherBefore = other.balanceOf(address(t));

        // 1. token rewritten to USDC: must revert CannotRescueUSDC and leave every balance alone
        vm.store(address(t), data, bytes32(uint256(uint160(address(usdc)))));
        assertEq(abi.decode(t.getPayload(id), (AskirawaTreasury.RescuePayload)).token, address(usdc), "corruption took");
        vm.expectRevert(AskirawaTreasury.CannotRescueUSDC.selector);
        t.execute(id);
        assertEq(usdc.balanceOf(address(t)), usdcBefore, "USDC untouched");
        assertEq(usdc.balanceOf(rescueTo), 0);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending), "not consumed");

        // 2. token rewritten to a codeless address
        address nowhere = makeAddr("codeless");
        vm.store(address(t), data, bytes32(uint256(uint160(nowhere))));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NoCode.selector, nowhere));
        t.execute(id);

        // 3. recipient zeroed
        vm.store(address(t), data, tokenWord);
        vm.store(address(t), _word(data, 1), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)));
        t.execute(id);

        // 4. amount zeroed
        vm.store(address(t), _word(data, 1), toWord);
        vm.store(address(t), _word(data, 2), bytes32(0));
        vm.expectRevert(AskirawaTreasury.ZeroAmount.selector);
        t.execute(id);
        assertEq(other.balanceOf(address(t)), otherBefore, "no rescue token moved by any corrupted attempt");

        // control: restored payload executes normally, so the reverts above came from the guard and not from setup
        vm.store(address(t), _word(data, 2), amountWord);
        t.execute(id);
        assertEq(other.balanceOf(rescueTo), RESCUE_AMOUNT);
        assertEq(usdc.balanceOf(address(t)), usdcBefore, "USDC untouched by the legitimate rescue");
    }
}
