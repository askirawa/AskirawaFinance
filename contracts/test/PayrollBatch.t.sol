// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {PayrollBatch} from "../PayrollBatch.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Minimal mock ERC-20 used throughout ──────────────────────────────────────

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

// ─── A token whose transfer() always returns false (non-reverting failure) ────

contract FailingToken is ERC20 {
    constructor() ERC20("Fail", "FAIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Override to simulate a non-reverting false return.
    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

// ─── PayrollBatch test suite ──────────────────────────────────────────────────

contract PayrollBatchTest is Test {
    MockUSDC  internal usdc;
    PayrollBatch internal batch;

    address internal owner     = makeAddr("owner");
    address internal recipient1 = makeAddr("recipient1");
    address internal recipient2 = makeAddr("recipient2");
    address internal recipient3 = makeAddr("recipient3");
    address internal attacker   = makeAddr("attacker");

    bytes32 internal constant BATCH_A = keccak256("batch-a");
    bytes32 internal constant BATCH_B = keccak256("batch-b");

    function setUp() public {
        usdc  = new MockUSDC();
        batch = new PayrollBatch(address(usdc), owner);
    }

    // ─── Helper: fund owner and set exact allowance ───────────────────────────

    function _fund(uint256 amount) internal {
        usdc.mint(owner, amount);
        vm.prank(owner);
        usdc.approve(address(batch), amount);
    }

    // ─── Happy path ───────────────────────────────────────────────────────────

    function test_singleRecipient() public {
        uint256 amount = 500e6; // 500 USDC
        _fund(amount);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient1;
        a[0] = amount;

        vm.expectEmit(true, true, false, true);
        emit PayrollBatch.PaymentSent(BATCH_A, recipient1, amount);
        vm.expectEmit(true, true, false, true);
        emit PayrollBatch.BatchExecuted(BATCH_A, owner, 1, amount);

        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);

        assertEq(usdc.balanceOf(recipient1), amount,  "recipient1 balance");
        assertEq(usdc.balanceOf(owner),      0,       "owner drained");
        assertTrue(batch.isBatchExecuted(BATCH_A),    "batchId marked used");
    }

    function test_multipleRecipients() public {
        uint256 a1 = 100e6;
        uint256 a2 = 250e6;
        uint256 a3 = 50e6;
        uint256 total = a1 + a2 + a3;
        _fund(total);

        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        r[0] = recipient1; a[0] = a1;
        r[1] = recipient2; a[1] = a2;
        r[2] = recipient3; a[2] = a3;

        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);

        assertEq(usdc.balanceOf(recipient1), a1);
        assertEq(usdc.balanceOf(recipient2), a2);
        assertEq(usdc.balanceOf(recipient3), a3);
        assertEq(usdc.balanceOf(owner),      0);
    }

    function test_twoBatchesDifferentIds() public {
        _fund(200e6);
        vm.prank(owner);
        usdc.approve(address(batch), type(uint256).max); // approve enough for both

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient1; a[0] = 100e6;

        usdc.mint(owner, 200e6);
        vm.prank(owner);
        usdc.approve(address(batch), 200e6);

        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);

        r[0] = recipient2; a[0] = 100e6;
        vm.prank(owner);
        batch.executeBatch(BATCH_B, r, a);

        assertEq(usdc.balanceOf(recipient1), 100e6);
        assertEq(usdc.balanceOf(recipient2), 100e6);
    }

    function test_allowanceFrom() public {
        uint256 amount = 777e6;
        vm.prank(owner);
        usdc.approve(address(batch), amount);
        assertEq(batch.allowanceFrom(owner), amount);
    }

    // ─── Replay prevention ────────────────────────────────────────────────────

    function test_revert_batchAlreadyExecuted() public {
        _fund(100e6);
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient1; a[0] = 100e6;

        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);

        // Fund again so the revert isn't about balance
        usdc.mint(owner, 100e6);
        vm.prank(owner);
        usdc.approve(address(batch), 100e6);

        vm.expectRevert(abi.encodeWithSelector(PayrollBatch.BatchAlreadyExecuted.selector, BATCH_A));
        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);
    }

    // ─── Authorization ────────────────────────────────────────────────────────

    function test_revert_nonOwnerCannotExecute() public {
        _fund(100e6);
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient1; a[0] = 100e6;

        vm.expectRevert(); // OwnableUnauthorizedAccount
        vm.prank(attacker);
        batch.executeBatch(BATCH_A, r, a);
    }

    // ─── Input validation ─────────────────────────────────────────────────────

    function test_revert_emptyBatch() public {
        address[] memory r = new address[](0);
        uint256[] memory a = new uint256[](0);

        vm.expectRevert(PayrollBatch.EmptyBatch.selector);
        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);
    }

    function test_revert_arrayLengthMismatch() public {
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient1; r[1] = recipient2;
        a[0] = 100e6;

        vm.expectRevert(
            abi.encodeWithSelector(PayrollBatch.ArrayLengthMismatch.selector, 2, 1)
        );
        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);
    }

    function test_revert_zeroRecipient() public {
        _fund(100e6);
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = address(0);
        a[0] = 100e6;

        vm.expectRevert(abi.encodeWithSelector(PayrollBatch.ZeroRecipient.selector, 0));
        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);
    }

    function test_revert_zeroAmount() public {
        _fund(0);
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient1;
        a[0] = 0;

        vm.expectRevert(abi.encodeWithSelector(PayrollBatch.ZeroAmount.selector, 0));
        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);
    }

    function test_revert_batchTooLarge() public {
        uint256 max = batch.MAX_BATCH_SIZE();
        address[] memory r = new address[](max + 1);
        uint256[] memory a = new uint256[](max + 1);
        for (uint256 i = 0; i <= max; i++) {
            r[i] = makeAddr(string(abi.encodePacked("addr", i)));
            a[i] = 1e6;
        }

        vm.expectRevert(
            abi.encodeWithSelector(PayrollBatch.BatchTooLarge.selector, max + 1, max)
        );
        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);
    }

    // ─── Insufficient funds / allowance ──────────────────────────────────────

    function test_revert_insufficientAllowance() public {
        // Mint tokens but do NOT approve
        usdc.mint(owner, 1000e6);
        // No approve call

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient1; a[0] = 500e6;

        // SafeERC20 will revert because allowance is 0
        vm.expectRevert();
        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);
    }

    function test_revert_insufficientBalance() public {
        // Approve more than the owner has
        vm.prank(owner);
        usdc.approve(address(batch), 1000e6);
        // Owner has 0 USDC

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient1; a[0] = 500e6;

        vm.expectRevert();
        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);
    }

    // ─── Atomic rollback — partial failure must revert everything ─────────────

    function test_atomicRollback_failingToken() public {
        // Deploy a contract with a token whose transferFrom always returns false
        FailingToken failToken = new FailingToken();
        failToken.mint(owner, 1000e6);

        PayrollBatch badBatch = new PayrollBatch(address(failToken), owner);

        vm.prank(owner);
        failToken.approve(address(badBatch), 1000e6);

        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = recipient1; a[0] = 100e6;
        r[1] = recipient2; a[1] = 200e6;

        // SafeERC20 reverts when transferFrom returns false
        vm.expectRevert();
        vm.prank(owner);
        badBatch.executeBatch(BATCH_A, r, a);

        // Nothing was transferred — owner still has full balance
        assertEq(failToken.balanceOf(owner), 1000e6, "owner balance unchanged");
        assertEq(failToken.balanceOf(recipient1), 0,  "recipient1 unchanged");
        assertEq(failToken.balanceOf(recipient2), 0,  "recipient2 unchanged");

        // batchId NOT marked used because revert rolled back state
        assertFalse(badBatch.isBatchExecuted(BATCH_A), "batchId not consumed on revert");
    }

    function test_atomicRollback_midBatchBalanceRun() public {
        // Give owner exactly enough for 1 payment but batch has 2
        uint256 partialFund = 100e6;
        usdc.mint(owner, partialFund);
        vm.prank(owner);
        usdc.approve(address(batch), 1000e6); // high allowance

        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = recipient1; a[0] = 100e6;
        r[1] = recipient2; a[1] = 100e6; // will fail — owner has 0 after first

        vm.expectRevert();
        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);

        // Entire tx reverted — recipient1 did NOT get paid
        assertEq(usdc.balanceOf(recipient1), 0,          "recipient1 not paid (reverted)");
        assertEq(usdc.balanceOf(owner),      partialFund, "owner balance unchanged");
        assertFalse(batch.isBatchExecuted(BATCH_A),       "batchId not consumed on revert");
    }

    // ─── Constructor guard ────────────────────────────────────────────────────

    function test_revert_zeroUsdcAddress() public {
        vm.expectRevert("PayrollBatch: zero USDC address");
        new PayrollBatch(address(0), owner);
    }

    // ─── Fuzz: any valid single payment succeeds ──────────────────────────────

    function testFuzz_singlePayment(uint96 amount) public {
        vm.assume(amount > 0);
        usdc.mint(owner, amount);
        vm.prank(owner);
        usdc.approve(address(batch), amount);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient1; a[0] = amount;

        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a);

        assertEq(usdc.balanceOf(recipient1), amount);
        assertTrue(batch.isBatchExecuted(BATCH_A));
    }

    // ─── MAX_BATCH_SIZE boundary ──────────────────────────────────────────────

    function test_maxBatchSizeBoundary() public {
        uint256 max = batch.MAX_BATCH_SIZE();
        uint256 amountEach = 1e6;
        uint256 total = amountEach * max;

        usdc.mint(owner, total);
        vm.prank(owner);
        usdc.approve(address(batch), total);

        address[] memory r = new address[](max);
        uint256[] memory a = new uint256[](max);
        for (uint256 i = 0; i < max; i++) {
            r[i] = makeAddr(string(abi.encodePacked("addr", i)));
            a[i] = amountEach;
        }

        vm.prank(owner);
        batch.executeBatch(BATCH_A, r, a); // must succeed

        assertTrue(batch.isBatchExecuted(BATCH_A));
    }
}
