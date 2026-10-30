// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AskirawaFiTreasury} from "../AskirawaFiTreasury.sol";
import {AskirawaFiTreasuryTestBase, MockERC20} from "./AskirawaFiTreasury.Base.t.sol";

/// Drives random propose -> vote -> execute flows against the treasury and
/// keeps ghost totals for the conservation invariant.
contract TreasuryHandler is Test {
    AskirawaFiTreasury public treasury;
    MockERC20          public usdc;
    address            public proposer;
    address            public voterA;
    address            public voterB;

    uint256 public totalPaid;
    uint256 public totalDeposited;
    uint256 public nonce;

    constructor(AskirawaFiTreasury t, MockERC20 u, address p, address a, address b) {
        treasury = t;
        usdc     = u;
        proposer = p;
        voterA   = a;
        voterB   = b;
    }

    function payOut(uint256 amount, uint8 voteMode) external {
        amount = bound(amount, 1, 50_000e6);
        voteMode = voteMode % 3; // 0 = no votes, 1 = one vote, 2 = full quorum
        bytes32 id = keccak256(abi.encode("h", nonce++));
        address to = address(uint160(0xBEEF0000 + nonce));

        vm.prank(proposer);
        treasury.proposeTransfer(id, to, amount, uint64(block.timestamp + 1 days));
        if (voteMode >= 1) { vm.prank(voterA); treasury.vote(id); }
        if (voteMode == 2) { vm.prank(voterB); treasury.vote(id); }

        uint256 before = usdc.balanceOf(address(treasury));
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = to;
        a[0] = amount;
        try treasury.execute(id, r, a) {
            totalPaid += amount;
            assertEq(usdc.balanceOf(address(treasury)), before - amount);
        } catch {}
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 10_000e6);
        usdc.mint(address(this), amount);
        usdc.approve(address(treasury), amount);
        treasury.deposit(amount);
        totalDeposited += amount;
    }
}

contract AskirawaFiTreasuryFuzzTest is AskirawaFiTreasuryTestBase {
    TreasuryHandler internal handler;

    bytes32 internal constant ID = keccak256("fuzz-1");

    function setUp() public override {
        super.setUp();
        handler = new TreasuryHandler(treasury, usdc, owner, alice, bob);
        targetContract(address(handler));
    }

    // ── amounts ──────────────────────────────────────────────────────────────

    function testFuzz_TransferConservesFunds(uint256 amount) public {
        amount = bound(amount, 1, TREASURY_SEED);
        _proposeApprove(ID, recipient, amount);
        _execute(ID, _one(recipient), _oneU(amount));

        assertEq(usdc.balanceOf(recipient), amount);
        assertEq(treasury.balance(), TREASURY_SEED - amount);
        assertEq(usdc.balanceOf(recipient) + treasury.balance(), TREASURY_SEED);
    }

    function testFuzz_TransferAboveBalanceReverts(uint256 amount) public {
        amount = bound(amount, TREASURY_SEED + 1, type(uint128).max);
        _proposeApprove(ID, recipient, amount);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.InsufficientTreasuryBalance.selector, TREASURY_SEED, amount)
        );
        treasury.execute(ID, _one(recipient), _oneU(amount));
        assertEq(treasury.balance(), TREASURY_SEED);
    }

    function testFuzz_AnyAlteredAmountIsRejected(uint256 amount, uint256 other) public {
        amount = bound(amount, 1, TREASURY_SEED);
        other = bound(other, 1, type(uint128).max);
        vm.assume(other != amount);
        _proposeApprove(ID, recipient, amount);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, ID));
        treasury.execute(ID, _one(recipient), _oneU(other));
    }

    function testFuzz_AnyAlteredRecipientIsRejected(address other) public {
        vm.assume(other != recipient);
        _proposeApprove(ID, recipient, 1e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, ID));
        treasury.execute(ID, _one(other), _oneU(1e6));
    }

    function testFuzz_PayrollPaysExactSumToAll(uint8 n, uint256 seed) public {
        uint256 count = bound(n, 1, 40);
        address[] memory r = new address[](count);
        uint256[] memory a = new uint256[](count);
        uint256 total;
        for (uint256 i = 0; i < count; i++) {
            r[i] = address(uint160(0xA0000 + i));
            a[i] = bound(uint256(keccak256(abi.encode(seed, i))), 1, 2_000e6);
            total += a[i];
        }
        _proposePayroll(owner, ID, r, a);
        _vote(alice, ID);
        _vote(bob, ID);
        _execute(ID, r, a);

        for (uint256 i = 0; i < count; i++) {
            assertEq(usdc.balanceOf(r[i]), a[i]);
        }
        assertEq(treasury.balance(), TREASURY_SEED - total);
    }

    // ── expiry ───────────────────────────────────────────────────────────────

    function testFuzz_ExpiryBoundsEnforced(uint64 exp) public {
        uint64 lo = uint64(block.timestamp + 1 hours);
        uint64 hi = uint64(block.timestamp + 30 days);
        bool valid = exp >= lo && exp <= hi;
        if (!valid) {
            vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidExpiry.selector, exp));
        }
        vm.prank(alice);
        treasury.proposeTransfer(ID, recipient, 1e6, exp);
        if (valid) assertEq(_prop(ID).expiresAt, exp);
    }

    function testFuzz_NothingExecutesAtOrAfterExpiry(uint256 delay) public {
        uint64 exp = _proposeApprove(ID, recipient, 1e6);
        delay = bound(delay, 0, 365 days);
        vm.warp(uint256(exp) + delay);
        vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.ProposalExpired.selector, ID));
        treasury.execute(ID, _one(recipient), _oneU(1e6));
    }

    function testFuzz_VotingOpenUntilExpiry(uint256 elapsed) public {
        uint64 exp = _proposeTransfer(owner, ID, recipient, 1e6);
        elapsed = bound(elapsed, 0, 1 days - 1);
        vm.warp(block.timestamp + elapsed);
        assertLt(block.timestamp, exp);
        _vote(alice, ID);
        assertEq(_prop(ID).approvalCount, 1);
    }

    // ── quorum / approver set ────────────────────────────────────────────────

    function testFuzz_ConstructorQuorumValidation(uint8 count, uint8 q) public {
        count = uint8(bound(count, 1, 12));
        address[] memory ap = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            ap[i] = address(uint160(0xC0000 + i));
        }
        if (q == 0) {
            vm.expectRevert(bytes("Treasury: invalid quorum/approvers"));
        } else if (q > count) {
            vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, q, uint256(count)));
        }
        AskirawaFiTreasury t = new AskirawaFiTreasury(address(usdc), owner, ap, q);
        if (q != 0 && q <= count) {
            assertEq(t.quorum(), q);
            assertEq(t.approverCount(), count);
        }
    }

    function testFuzz_ConfigProposalQuorumValidation(uint8 count, uint8 q) public {
        count = uint8(bound(count, 0, 12));
        address[] memory ap = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            ap[i] = address(uint160(0xD0000 + i));
        }
        uint64 exp = _exp();
        bool valid = count > 0 && q > 0 && q <= count;
        if (!valid) {
            vm.expectRevert(abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, q, uint256(count)));
        }
        vm.prank(alice);
        treasury.proposeConfigChange(ID, ap, q, exp);
        if (valid) assertEq(_prop(ID).txType, 3);
    }

    function testFuzz_NonApproverCannotProposeOrVote(address who) public {
        vm.assume(who != owner && who != alice && who != bob);
        uint64 exp = _proposeTransfer(owner, ID, recipient, 1e6);

        vm.startPrank(who);
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        treasury.vote(ID);
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        treasury.proposeTransfer(keccak256("x"), recipient, 1e6, exp);
        vm.stopPrank();
    }

    function testFuzz_OnlyOwnerCanCancel(address who) public {
        vm.assume(who != owner);
        _proposeTransfer(alice, ID, recipient, 1e6);
        vm.expectRevert(AskirawaFiTreasury.NotOwner.selector);
        vm.prank(who);
        treasury.cancel(ID);
    }

    // ── invariants ───────────────────────────────────────────────────────────

    /// Conservation law: USDC in the treasury = seed + deposits - executed payouts.
    function invariant_TreasuryBalanceConserved() public view {
        assertEq(treasury.balance(), TREASURY_SEED + handler.totalDeposited() - handler.totalPaid());
    }

    /// The treasury never holds less than zero and the token supply is untouched by it.
    function invariant_NoUsdcCreatedOrDestroyed() public view {
        assertEq(
            usdc.totalSupply(),
            TREASURY_SEED + handler.totalDeposited()
        );
    }
}
