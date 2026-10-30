// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaFiTreasury} from "../AskirawaFiTreasury.sol";
import {AskirawaFiTreasuryTestBase, MockERC20} from "./AskirawaFiTreasury.Base.t.sol";

/// Constructor state, constructor validation, deposit and read helpers.
contract AskirawaFiTreasuryDeployTest is AskirawaFiTreasuryTestBase {
    // ── constructor state ────────────────────────────────────────────────────

    function test_ConstructorSetsState() public view {
        assertEq(address(treasury.usdc()), address(usdc));
        assertEq(treasury.owner(), owner);
        assertEq(treasury.quorum(), 2);
        assertEq(treasury.approverCount(), 3);
        assertEq(treasury.balance(), TREASURY_SEED);
    }

    function test_ConstructorSetsApproverSet() public view {
        address[] memory list = treasury.approvers();
        assertEq(list.length, 3);
        assertEq(list[0], owner);
        assertEq(list[1], alice);
        assertEq(list[2], bob);
        assertTrue(treasury.isApprover(owner));
        assertTrue(treasury.isApprover(alice));
        assertTrue(treasury.isApprover(bob));
        assertFalse(treasury.isApprover(carol));
        assertFalse(treasury.isApprover(stranger));
    }

    function test_Constants() public view {
        assertEq(treasury.MAX_BATCH_SIZE(), 200);
        assertEq(treasury.MAX_EXPIRY_SECONDS(), 30 days);
        assertEq(treasury.MIN_EXPIRY_SECONDS(), 1 hours);
        assertEq(treasury.TX_TRANSFER(), 1);
        assertEq(treasury.TX_PAYROLL(), 2);
        assertEq(treasury.TX_CONFIG(), 3);
    }

    function test_ConstructorEmitsOwnershipTransferred() public {
        vm.expectEmit(true, true, false, false);
        emit AskirawaFiTreasury.OwnershipTransferred(address(0), owner);
        new AskirawaFiTreasury(address(usdc), owner, _addrs3(owner, alice, bob), 2);
    }

    function test_ConstructorOwnerNeedNotBeApprover() public {
        AskirawaFiTreasury t = new AskirawaFiTreasury(address(usdc), carol, _addrs2(alice, bob), 1);
        assertEq(t.owner(), carol);
        assertFalse(t.isApprover(carol));
    }

    function test_ConstructorDeduplicatesApprovers() public {
        AskirawaFiTreasury t = new AskirawaFiTreasury(address(usdc), owner, _addrs3(alice, alice, bob), 2);
        assertEq(t.approverCount(), 2);
        address[] memory list = t.approvers();
        assertEq(list[0], alice);
        assertEq(list[1], bob);
    }

    function test_ConstructorQuorumEqualToApproverCountAccepted() public {
        AskirawaFiTreasury t = new AskirawaFiTreasury(address(usdc), owner, _addrs3(owner, alice, bob), 3);
        assertEq(t.quorum(), 3);
    }

    // ── constructor reverts ──────────────────────────────────────────────────

    function test_RevertConstructorZeroUsdc() public {
        vm.expectRevert(bytes("Treasury: zero USDC"));
        new AskirawaFiTreasury(address(0), owner, _addrs3(owner, alice, bob), 2);
    }

    function test_RevertConstructorZeroOwner() public {
        vm.expectRevert(bytes("Treasury: zero owner"));
        new AskirawaFiTreasury(address(usdc), address(0), _addrs3(owner, alice, bob), 2);
    }

    function test_RevertConstructorNoApprovers() public {
        vm.expectRevert(bytes("Treasury: invalid quorum/approvers"));
        new AskirawaFiTreasury(address(usdc), owner, new address[](0), 1);
    }

    function test_RevertConstructorZeroQuorum() public {
        vm.expectRevert(bytes("Treasury: invalid quorum/approvers"));
        new AskirawaFiTreasury(address(usdc), owner, _addrs3(owner, alice, bob), 0);
    }

    function test_RevertConstructorQuorumAboveApproverCount() public {
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, uint8(4), uint256(3)));
        new AskirawaFiTreasury(address(usdc), owner, _addrs3(owner, alice, bob), 4);
    }

    function test_RevertConstructorQuorumChecksDeduplicatedCount() public {
        // 3 entries but only 2 distinct approvers: quorum 3 is unreachable.
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, uint8(3), uint256(2)));
        new AskirawaFiTreasury(address(usdc), owner, _addrs3(alice, alice, bob), 3);
    }

    function test_RevertConstructorZeroApprover() public {
        vm.expectRevert(bytes("Treasury: zero approver"));
        new AskirawaFiTreasury(address(usdc), owner, _addrs3(owner, address(0), bob), 2);
    }

    // ── deposit ──────────────────────────────────────────────────────────────

    function test_DepositPullsUsdcAndEmits() public {
        usdc.mint(carol, 500e6);
        vm.prank(carol);
        usdc.approve(address(treasury), 500e6);

        vm.expectEmit(true, false, false, true, address(treasury));
        emit AskirawaFiTreasury.Deposited(carol, 500e6);
        vm.prank(carol);
        treasury.deposit(500e6);

        assertEq(usdc.balanceOf(carol), 0);
        assertEq(treasury.balance(), TREASURY_SEED + 500e6);
        assertEq(usdc.balanceOf(address(treasury)), TREASURY_SEED + 500e6);
    }

    function test_DepositOpenToAnyone() public {
        usdc.mint(stranger, 1e6);
        vm.startPrank(stranger);
        usdc.approve(address(treasury), 1e6);
        treasury.deposit(1e6);
        vm.stopPrank();
        assertEq(treasury.balance(), TREASURY_SEED + 1e6);
    }

    function test_RevertDepositZero() public {
        vm.expectRevert(bytes("Treasury: zero deposit"));
        vm.prank(carol);
        treasury.deposit(0);
    }

    function test_RevertDepositWithoutAllowance() public {
        usdc.mint(carol, 10e6);
        vm.expectRevert(bytes("MockERC20: allowance"));
        vm.prank(carol);
        treasury.deposit(10e6);
        assertEq(treasury.balance(), TREASURY_SEED);
    }

    function test_RevertDepositInsufficientBalance() public {
        vm.prank(carol);
        usdc.approve(address(treasury), 10e6);
        vm.expectRevert(bytes("MockERC20: insufficient"));
        vm.prank(carol);
        treasury.deposit(10e6);
    }

    function test_TreasuryRejectsRawEth() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(treasury).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(treasury).balance, 0);
    }
}
