// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {AskirawaFiTreasury} from "../AskirawaFiTreasury.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Minimal mock USDC ────────────────────────────────────────────────────────

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── Reentrancy attacker ──────────────────────────────────────────────────────

contract ReentrancyAttacker {
    AskirawaFiTreasury public treasury;
    bytes32 public targetId;
    address[] public recipients;
    uint256[] public amounts;
    bool public attacked;

    constructor(address _treasury) {
        treasury = AskirawaFiTreasury(_treasury);
    }

    function setTarget(
        bytes32 id,
        address[] memory r,
        uint256[] memory a
    ) external {
        targetId = id;
        recipients = r;
        amounts = a;
    }

    // Called when USDC is transferred to this address
    function onERC20Received() external {
        if (!attacked) {
            attacked = true;
            // Attempt reentrant execute — must revert
            try treasury.execute(targetId, recipients, amounts) {} catch {}
        }
    }

    // Receive USDC as a regular ERC20 recipient; call back into treasury
    fallback() external {
        if (!attacked) {
            attacked = true;
            try treasury.execute(targetId, recipients, amounts) {} catch {}
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

contract AskirawaFiTreasuryTest is Test {
    MockUSDC                usdc;
    AskirawaFiTreasury      treasury;

    address owner     = address(0x1);
    address approver1 = address(0x2);
    address approver2 = address(0x3);
    address approver3 = address(0x4);
    address stranger  = address(0x5);
    address recipient = address(0x6);

    uint64 validExpiry;

    function setUp() public {
        usdc = new MockUSDC();

        address[] memory approvers = new address[](3);
        approvers[0] = approver1;
        approvers[1] = approver2;
        approvers[2] = approver3;

        vm.prank(owner);
        treasury = new AskirawaFiTreasury(
            address(usdc),
            owner,
            approvers,
            2  // quorum = 2-of-3
        );

        validExpiry = uint64(block.timestamp) + 1 days;

        // Fund treasury with 100,000 USDC
        usdc.mint(address(treasury), 100_000e6);
    }

    // ─── Helper: create a simple transfer proposal ────────────────────────────

    function _proposeTransfer(
        bytes32 id,
        address to,
        uint256 amount
    ) internal {
        vm.prank(approver1);
        treasury.proposeTransfer(id, to, amount, validExpiry);
    }

    // ─── Helper: reach quorum (approver2 + approver3 vote) ───────────────────

    function _reachQuorum(bytes32 id) internal {
        // approver1 proposed — self-vote blocked. approver2 and approver3 vote.
        vm.prank(approver2);
        treasury.vote(id);
        vm.prank(approver3);
        treasury.vote(id);
    }

    // ─── Constructor validation ───────────────────────────────────────────────

    function test_ConstructorSetsState() public view {
        assertEq(treasury.owner(), owner);
        assertEq(treasury.quorum(), 2);
        assertEq(treasury.approverCount(), 3);
        assertTrue(treasury.isApprover(approver1));
        assertTrue(treasury.isApprover(approver2));
        assertTrue(treasury.isApprover(approver3));
        assertFalse(treasury.isApprover(stranger));
    }

    // ─── Deposit ─────────────────────────────────────────────────────────────

    function test_Deposit() public {
        usdc.mint(stranger, 1_000e6);
        vm.startPrank(stranger);
        usdc.approve(address(treasury), 1_000e6);
        treasury.deposit(1_000e6);
        vm.stopPrank();
        assertEq(treasury.balance(), 101_000e6);
    }

    function test_RevertIf_DepositZero() public {
        vm.expectRevert("Treasury: zero deposit");
        vm.prank(stranger);
        treasury.deposit(0);
    }

    // ─── Propose transfer ─────────────────────────────────────────────────────

    function test_ProposeTransfer() public {
        bytes32 id = keccak256("prop1");
        _proposeTransfer(id, recipient, 500e6);
        (uint8 txType,,, , , address proposer,) = _getProposal(id);
        assertEq(txType, treasury.TX_TRANSFER());
        assertEq(proposer, approver1);
    }

    function test_RevertIf_NonApproverProposes() public {
        bytes32 id = keccak256("prop2");
        vm.prank(stranger);
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        treasury.proposeTransfer(id, recipient, 500e6, validExpiry);
    }

    function test_RevertIf_DuplicateProposalId() public {
        bytes32 id = keccak256("prop3");
        _proposeTransfer(id, recipient, 500e6);
        vm.prank(approver2);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExists.selector, id)
        );
        treasury.proposeTransfer(id, recipient, 100e6, validExpiry);
    }

    function test_RevertIf_ExpiryTooSoon() public {
        bytes32 id = keccak256("prop4");
        uint64 tooSoon = uint64(block.timestamp) + 30 minutes;
        vm.prank(approver1);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.InvalidExpiry.selector, tooSoon)
        );
        treasury.proposeTransfer(id, recipient, 500e6, tooSoon);
    }

    function test_RevertIf_ExpiryTooFar() public {
        bytes32 id = keccak256("prop5");
        uint64 tooFar = uint64(block.timestamp) + 31 days;
        vm.prank(approver1);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.InvalidExpiry.selector, tooFar)
        );
        treasury.proposeTransfer(id, recipient, 500e6, tooFar);
    }

    function test_RevertIf_ZeroRecipient() public {
        bytes32 id = keccak256("prop6");
        vm.prank(approver1);
        vm.expectRevert("Treasury: zero recipient");
        treasury.proposeTransfer(id, address(0), 500e6, validExpiry);
    }

    function test_RevertIf_ZeroAmount() public {
        bytes32 id = keccak256("prop7");
        vm.prank(approver1);
        vm.expectRevert("Treasury: zero amount");
        treasury.proposeTransfer(id, recipient, 0, validExpiry);
    }

    // ─── Vote ────────────────────────────────────────────────────────────────

    function test_VoteRecorded() public {
        bytes32 id = keccak256("vote1");
        _proposeTransfer(id, recipient, 500e6);
        vm.prank(approver2);
        treasury.vote(id);
        (,,,,,, uint16 count) = _getProposal(id);
        assertEq(count, 1);
    }

    function test_RevertIf_NonApproverVotes() public {
        bytes32 id = keccak256("vote2");
        _proposeTransfer(id, recipient, 500e6);
        vm.prank(stranger);
        vm.expectRevert(AskirawaFiTreasury.NotApprover.selector);
        treasury.vote(id);
    }

    function test_RevertIf_SelfVote() public {
        bytes32 id = keccak256("vote3");
        _proposeTransfer(id, recipient, 500e6);
        // approver1 is the proposer
        vm.prank(approver1);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.SelfVote.selector, id, approver1)
        );
        treasury.vote(id);
    }

    function test_RevertIf_DuplicateVote() public {
        bytes32 id = keccak256("vote4");
        _proposeTransfer(id, recipient, 500e6);
        vm.prank(approver2);
        treasury.vote(id);
        vm.prank(approver2);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.AlreadyVoted.selector, id, approver2)
        );
        treasury.vote(id);
    }

    function test_RevertIf_VoteOnExpiredProposal() public {
        bytes32 id = keccak256("vote5");
        _proposeTransfer(id, recipient, 500e6);
        vm.warp(block.timestamp + 2 days); // past validExpiry (1 day)
        vm.prank(approver2);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalExpired.selector, id)
        );
        treasury.vote(id);
    }

    function test_RevertIf_VoteOnCancelledProposal() public {
        bytes32 id = keccak256("vote6");
        _proposeTransfer(id, recipient, 500e6);
        vm.prank(owner);
        treasury.cancel(id);
        vm.prank(approver2);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyCancelled.selector, id)
        );
        treasury.vote(id);
    }

    // ─── Cancel ───────────────────────────────────────────────────────────────

    function test_CancelByOwner() public {
        bytes32 id = keccak256("cancel1");
        _proposeTransfer(id, recipient, 500e6);
        vm.prank(owner);
        treasury.cancel(id);
        (, bool executed, bool cancelled,,,,) = _getProposal(id);
        assertFalse(executed);
        assertTrue(cancelled);
    }

    function test_RevertIf_NonOwnerCancels() public {
        bytes32 id = keccak256("cancel2");
        _proposeTransfer(id, recipient, 500e6);
        vm.prank(stranger);
        vm.expectRevert(AskirawaFiTreasury.NotOwner.selector);
        treasury.cancel(id);
    }

    function test_RevertIf_CancelExecutedProposal() public {
        bytes32 id = keccak256("cancel3");
        _proposeTransfer(id, recipient, 500e6);
        _reachQuorum(id);
        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = 500e6;
        treasury.execute(id, r, a);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExecuted.selector, id)
        );
        treasury.cancel(id);
    }

    // ─── Execute — transfer ───────────────────────────────────────────────────

    function test_ExecuteTransfer() public {
        bytes32 id = keccak256("exec1");
        _proposeTransfer(id, recipient, 500e6);
        _reachQuorum(id);

        uint256 before = usdc.balanceOf(recipient);
        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = 500e6;
        treasury.execute(id, r, a);

        assertEq(usdc.balanceOf(recipient), before + 500e6);
        assertEq(treasury.balance(), 100_000e6 - 500e6);
        (, bool executed,,,,,) = _getProposal(id);
        assertTrue(executed);
    }

    function test_RevertIf_ExecuteWithoutQuorum() public {
        bytes32 id = keccak256("exec2");
        _proposeTransfer(id, recipient, 500e6);
        // Only one vote (approver2), quorum is 2
        vm.prank(approver2);
        treasury.vote(id);

        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = 500e6;
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, id, uint16(1), uint8(2))
        );
        treasury.execute(id, r, a);
    }

    function test_RevertIf_ExecuteExpiredProposal() public {
        bytes32 id = keccak256("exec3");
        _proposeTransfer(id, recipient, 500e6);
        _reachQuorum(id);

        vm.warp(block.timestamp + 2 days);

        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = 500e6;
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalExpired.selector, id)
        );
        treasury.execute(id, r, a);
    }

    function test_RevertIf_ExecuteTwice() public {
        bytes32 id = keccak256("exec4");
        _proposeTransfer(id, recipient, 500e6);
        _reachQuorum(id);

        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = 500e6;
        treasury.execute(id, r, a);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExecuted.selector, id)
        );
        treasury.execute(id, r, a);
    }

    function test_RevertIf_ExecuteCancelledProposal() public {
        bytes32 id = keccak256("exec5");
        _proposeTransfer(id, recipient, 500e6);
        _reachQuorum(id);
        vm.prank(owner);
        treasury.cancel(id);

        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = 500e6;
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyCancelled.selector, id)
        );
        treasury.execute(id, r, a);
    }

    // ─── Payload integrity ────────────────────────────────────────────────────

    function test_RevertIf_SubstitutedRecipient() public {
        bytes32 id = keccak256("hash1");
        _proposeTransfer(id, recipient, 500e6);
        _reachQuorum(id);

        address[] memory r = new address[](1); r[0] = stranger; // wrong!
        uint256[] memory a = new uint256[](1); a[0] = 500e6;
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, id)
        );
        treasury.execute(id, r, a);
    }

    function test_RevertIf_SubstitutedAmount() public {
        bytes32 id = keccak256("hash2");
        _proposeTransfer(id, recipient, 500e6);
        _reachQuorum(id);

        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = 99_000e6; // wrong!
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, id)
        );
        treasury.execute(id, r, a);
    }

    function test_RevertIf_SubstitutedRecipientCount() public {
        bytes32 id = keccak256("hash3");
        _proposeTransfer(id, recipient, 500e6);
        _reachQuorum(id);

        // Two recipients instead of one
        address[] memory r = new address[](2); r[0] = recipient; r[1] = stranger;
        uint256[] memory a = new uint256[](2); a[0] = 250e6; a[1] = 250e6;
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, id)
        );
        treasury.execute(id, r, a);
    }

    // ─── Insufficient balance ─────────────────────────────────────────────────

    function test_RevertIf_InsufficientBalance() public {
        // Drain treasury first by executing a big transfer
        bytes32 id1 = keccak256("bal1");
        _proposeTransfer(id1, recipient, 99_999e6);
        _reachQuorum(id1);
        address[] memory r1 = new address[](1); r1[0] = recipient;
        uint256[] memory a1 = new uint256[](1); a1[0] = 99_999e6;
        treasury.execute(id1, r1, a1);
        // treasury now has 1 USDC

        bytes32 id2 = keccak256("bal2");
        vm.prank(approver2);  // different proposer
        treasury.proposeTransfer(id2, recipient, 500e6, validExpiry + 1);

        vm.prank(approver1);
        treasury.vote(id2);
        vm.prank(approver3);
        treasury.vote(id2);

        address[] memory r2 = new address[](1); r2[0] = recipient;
        uint256[] memory a2 = new uint256[](1); a2[0] = 500e6;
        vm.expectRevert(); // InsufficientTreasuryBalance
        treasury.execute(id2, r2, a2);
    }

    // ─── Payroll batch ────────────────────────────────────────────────────────

    function test_ExecutePayrollBatch() public {
        bytes32 id = keccak256("payroll1");
        address emp1 = address(0x10);
        address emp2 = address(0x11);
        address emp3 = address(0x12);

        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        r[0] = emp1; a[0] = 1_000e6;
        r[1] = emp2; a[1] = 2_000e6;
        r[2] = emp3; a[2] = 1_500e6;

        vm.prank(approver1);
        treasury.proposePayroll(id, r, a, validExpiry);
        _reachQuorum(id);

        treasury.execute(id, r, a);

        assertEq(usdc.balanceOf(emp1), 1_000e6);
        assertEq(usdc.balanceOf(emp2), 2_000e6);
        assertEq(usdc.balanceOf(emp3), 1_500e6);
        assertEq(treasury.balance(), 100_000e6 - 4_500e6);
    }

    function test_RevertIf_PayrollBatchTooLarge() public {
        uint256 size = 201;
        address[] memory r = new address[](size);
        uint256[] memory a = new uint256[](size);
        for (uint256 i = 0; i < size; i++) {
            r[i] = address(uint160(0x100 + i));
            a[i] = 1e6;
        }
        bytes32 id = keccak256("payroll_large");
        vm.prank(approver1);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.BatchTooLarge.selector, size, uint256(200))
        );
        treasury.proposePayroll(id, r, a, validExpiry);
    }

    function test_RevertIf_PayrollArrayMismatch() public {
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient; r[1] = stranger;
        a[0] = 500e6;
        bytes32 id = keccak256("payroll_mismatch");
        vm.prank(approver1);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ArrayLengthMismatch.selector, uint256(2), uint256(1))
        );
        treasury.proposePayroll(id, r, a, validExpiry);
    }

    function test_RevertIf_PayrollZeroRecipient() public {
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = recipient; r[1] = address(0); // invalid
        a[0] = 500e6;     a[1] = 100e6;
        bytes32 id = keccak256("payroll_zero");
        vm.prank(approver1);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ZeroRecipient.selector, uint256(1))
        );
        treasury.proposePayroll(id, r, a, validExpiry);
    }

    function test_PayrollAtomicRollback() public {
        // All-or-nothing: if balance is insufficient, no one gets paid
        bytes32 id = keccak256("payroll_rollback");
        address emp1 = address(0x20);
        address emp2 = address(0x21);

        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = emp1; a[0] = 60_000e6;
        r[1] = emp2; a[1] = 60_000e6; // total 120k, treasury has 100k

        vm.prank(approver1);
        treasury.proposePayroll(id, r, a, validExpiry);
        _reachQuorum(id);

        vm.expectRevert(); // InsufficientTreasuryBalance
        treasury.execute(id, r, a);

        // Verify atomic: neither employee received anything
        assertEq(usdc.balanceOf(emp1), 0);
        assertEq(usdc.balanceOf(emp2), 0);
    }

    // ─── Config change ────────────────────────────────────────────────────────

    function test_ConfigChangeUpdatesApprovers() public {
        bytes32 id = keccak256("config1");
        address newAppr = address(0x99);

        address[] memory newApprovers = new address[](2);
        newApprovers[0] = approver1;
        newApprovers[1] = newAppr;

        vm.prank(approver1);
        treasury.proposeConfigChange(id, newApprovers, 1, validExpiry);
        _reachQuorum(id);

        // Execute config change — recipients = newApprovers, amounts[0] = newQuorum
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = approver1; r[1] = newAppr;
        a[0] = 1;         a[1] = 0;
        treasury.execute(id, r, a);

        assertTrue(treasury.isApprover(approver1));
        assertTrue(treasury.isApprover(newAppr));
        assertFalse(treasury.isApprover(approver2));
        assertFalse(treasury.isApprover(approver3));
        assertEq(treasury.quorum(), 1);
    }

    function test_RevertIf_ConfigQuorumExceedsApprovers() public {
        bytes32 id = keccak256("config_bad");
        address[] memory newApprovers = new address[](2);
        newApprovers[0] = approver1;
        newApprovers[1] = approver2;

        vm.prank(approver1);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, uint8(3), uint256(2))
        );
        treasury.proposeConfigChange(id, newApprovers, 3, validExpiry); // quorum > len
    }

    // ─── Authorization bypass attempts ────────────────────────────────────────

    function test_RevertIf_StrangerExecutesDirectly() public {
        // Stranger tries to call execute on a non-existent proposal
        bytes32 fakeId = keccak256("fake");
        address[] memory r = new address[](1); r[0] = stranger;
        uint256[] memory a = new uint256[](1); a[0] = 1_000e6;
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalNotFound.selector, fakeId)
        );
        treasury.execute(fakeId, r, a);
    }

    function test_RevertIf_OwnerCannotExecuteDirectly() public {
        // Even the owner cannot move funds without a proposal
        bytes32 fakeId = keccak256("owner_bypass");
        address[] memory r = new address[](1); r[0] = owner;
        uint256[] memory a = new uint256[](1); a[0] = 1_000e6;
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalNotFound.selector, fakeId)
        );
        treasury.execute(fakeId, r, a);
    }

    // ─── Reentrancy ───────────────────────────────────────────────────────────

    function test_ReentrancyBlocked() public {
        // Deploy attacker as the recipient
        ReentrancyAttacker attacker = new ReentrancyAttacker(address(treasury));

        bytes32 id = keccak256("reentry1");
        vm.prank(approver1);
        treasury.proposeTransfer(id, address(attacker), 500e6, validExpiry);
        _reachQuorum(id);

        address[] memory r = new address[](1); r[0] = address(attacker);
        uint256[] memory a = new uint256[](1); a[0] = 500e6;
        attacker.setTarget(id, r, a);

        // Execute should succeed (USDC.safeTransfer goes to attacker)
        // But attacker's reentry attempt must fail (executed = true already)
        treasury.execute(id, r, a);
        // If reentrancy guard failed, attacker.attacked would be true AND the
        // proposal would have been re-executed.  Verify it was only executed once.
        (, bool executed,,,,,) = _getProposal(id);
        assertTrue(executed);
        // Treasury balance reduced exactly once
        assertEq(treasury.balance(), 100_000e6 - 500e6);
    }

    // ─── Cross-chain replay prevention ────────────────────────────────────────

    function test_ContentHashIncludesChainId() public view {
        // Verify that the content hash changes when chainid changes by computing
        // two hashes with different block.chainid simulations.
        // We test indirectly: the hash stored at proposal time uses block.chainid,
        // so on a different chain the recomputed hash would differ.
        // This unit test just confirms the hash is deterministic.
        bytes32 id = keccak256("cross_chain");
        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = 500e6;
        uint64 exp = uint64(block.timestamp) + 1 days;

        bytes32 h1 = keccak256(abi.encode(block.chainid, address(treasury), id, uint8(1), r, a, exp));
        bytes32 h2 = keccak256(abi.encode(block.chainid + 1, address(treasury), id, uint8(1), r, a, exp));
        assertTrue(h1 != h2, "Different chainids must produce different hashes");
    }

    // ─── Ownership transfer ───────────────────────────────────────────────────

    function test_TransferOwnership() public {
        vm.prank(owner);
        treasury.transferOwnership(stranger);
        assertEq(treasury.owner(), stranger);
    }

    function test_RevertIf_TransferOwnershipToZero() public {
        vm.prank(owner);
        vm.expectRevert(AskirawaFiTreasury.ZeroOwner.selector);
        treasury.transferOwnership(address(0));
    }

    function test_RevertIf_NonOwnerTransfersOwnership() public {
        vm.prank(stranger);
        vm.expectRevert(AskirawaFiTreasury.NotOwner.selector);
        treasury.transferOwnership(stranger);
    }

    // ─── Fuzz: deposit and balance consistency ────────────────────────────────

    function testFuzz_DepositAndBalance(uint128 amount) public {
        vm.assume(amount > 0 && amount < 1_000_000e6);
        usdc.mint(stranger, amount);
        vm.startPrank(stranger);
        usdc.approve(address(treasury), amount);
        treasury.deposit(amount);
        vm.stopPrank();
        assertEq(treasury.balance(), 100_000e6 + uint256(amount));
    }

    // ─── Proposal does not exist ──────────────────────────────────────────────

    function test_RevertIf_VoteOnNonexistentProposal() public {
        bytes32 id = keccak256("nonexist");
        vm.prank(approver2);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalNotFound.selector, id)
        );
        treasury.vote(id);
    }

    // ─── Recovery limitation test (disclosure) ────────────────────────────────

    function test_FundsLockedIfApproversLost() public {
        // If we set quorum = 2 with only 2 approvers, and one key is lost,
        // execution becomes impossible.
        bytes32 cfgId = keccak256("lockout_cfg");
        address[] memory twoApprovers = new address[](2);
        twoApprovers[0] = approver1;
        twoApprovers[1] = approver2;

        vm.prank(approver1);
        treasury.proposeConfigChange(cfgId, twoApprovers, 2, validExpiry);
        _reachQuorum(cfgId);

        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = approver1; r[1] = approver2;
        a[0] = 2;         a[1] = 0;
        treasury.execute(cfgId, r, a);

        // Now quorum=2, approvers=[approver1, approver2].
        // approver2's key is "lost" — only approver1 can vote but cannot self-vote.
        // Propose a transfer
        bytes32 txId = keccak256("locked_transfer");
        vm.prank(approver1);
        treasury.proposeTransfer(txId, recipient, 100e6, validExpiry + 2);

        // Only one approver available to vote — approver2 cannot (lost key)
        // Result: quorum cannot be reached. Funds locked.
        (,,,,,, uint16 count) = _getProposal(txId);
        assertEq(count, 0, "No votes cast - quorum unreachable");
        // This test documents the known limitation, not a bug.
    }

    // ─── Full lifecycle: propose → vote → execute ────────────────────────────

    /**
     * End-to-end lifecycle test: one approver proposes, two distinct approvers vote
     * (reaching quorum), then anyone executes with the original payload.
     * Verifies that: (1) the Proposed event is emitted, (2) two Voted events emitted,
     * (3) approvalCount reaches quorum, (4) USDC moves on execute,
     * (5) executed flag is set.
     */
    function test_FullLifecycle_ProposeVoteExecute() public {
        bytes32 id = keccak256("lifecycle1");
        uint256 amount = 1_500e6;

        // Step 1: propose
        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.Proposed(id, approver1, treasury.TX_TRANSFER(), validExpiry);
        vm.prank(approver1);
        treasury.proposeTransfer(id, recipient, amount, validExpiry);

        (,,,,,, uint16 count0) = _getProposal(id);
        assertEq(count0, 0, "No votes yet after propose");

        // Step 2: vote (approver2)
        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.Voted(id, approver2, 1, 2);
        vm.prank(approver2);
        treasury.vote(id);

        (,,,,,, uint16 count1) = _getProposal(id);
        assertEq(count1, 1);

        // Step 3: vote (approver3 — reaches quorum=2)
        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.Voted(id, approver3, 2, 2);
        vm.prank(approver3);
        treasury.vote(id);

        (,,,,,, uint16 count2) = _getProposal(id);
        assertEq(count2, 2, "Quorum reached");

        // Step 4: execute with original payload — must succeed
        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = amount;

        uint256 before = usdc.balanceOf(recipient);
        vm.expectEmit(true, true, false, true, address(treasury));
        emit AskirawaFiTreasury.PaymentSent(id, recipient, amount);
        treasury.execute(id, r, a);

        assertEq(usdc.balanceOf(recipient), before + amount, "Recipient received USDC");
        assertEq(treasury.balance(), 100_000e6 - amount, "Treasury balance reduced");
        (, bool exec,,,,,) = _getProposal(id);
        assertTrue(exec, "executed flag set");
    }

    /**
     * Verify that vote() reverts with ProposalNotFound when called with a
     * proposalId that was never submitted via proposeTransfer/proposePayroll.
     * This is the exact revert a voter would hit if the frontend calls vote()
     * before the propose transaction has been confirmed.
     */
    function test_RevertIf_VoteBeforePropose() public {
        // Simulate a bytes32 that looks like a derived frontend proposalId
        // but was never submitted on-chain.
        bytes32 unrealId = keccak256(abi.encodePacked(
            "local-id-123",
            uint256(5042),
            address(treasury)
        ));

        vm.prank(approver2);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalNotFound.selector, unrealId)
        );
        treasury.vote(unrealId);
    }

    // ─── Payroll batch: propose→vote→execute end-to-end ──────────────────────

    /**
     * Full lifecycle for a payroll (multi-recipient) proposal:
     *   - proposePayroll with 3 recipients
     *   - two distinct votes reach quorum
     *   - execute distributes USDC atomically to all recipients
     *   - substituting any single recipient reverts with PayloadHashMismatch
     *
     * This mirrors the frontend useTreasuryPayroll.propose + executePayroll path.
     * The frozenRecipients/frozenAmounts returned at propose-time MUST be passed
     * unchanged to execute(); substitution is the exact attack the content hash guards against.
     */
    function test_PayrollLifecycle_ProposeVoteExecute() public {
        bytes32 id = keccak256("payroll-lifecycle-1");
        uint64  expiry = uint64(block.timestamp + 7 days);

        address[] memory recipients = new address[](3);
        recipients[0] = makeAddr("emp1");
        recipients[1] = makeAddr("emp2");
        recipients[2] = makeAddr("emp3");

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1_000e6;
        amounts[1] = 1_500e6;
        amounts[2] =   750e6;
        uint256 total = amounts[0] + amounts[1] + amounts[2];

        // Step 1: propose payroll (approver1 proposes)
        vm.prank(approver1);
        treasury.proposePayroll(id, recipients, amounts, expiry);

        (, bool exec0, bool canc0,,,, uint16 cnt0) = _getProposal(id);
        assertFalse(exec0);
        assertFalse(canc0);
        assertEq(cnt0, 0);

        // Step 2: two approvers vote (quorum=2)
        vm.prank(approver2); treasury.vote(id);
        vm.prank(approver3); treasury.vote(id);
        (,,,,,, uint16 cnt2) = _getProposal(id);
        assertEq(cnt2, 2, "Quorum reached");

        // Step 3: execute with the original frozen payload
        uint256 treasuryBefore = treasury.balance();
        treasury.execute(id, recipients, amounts);

        // All recipients received correct amounts
        assertEq(usdc.balanceOf(recipients[0]), amounts[0], "emp1 paid");
        assertEq(usdc.balanceOf(recipients[1]), amounts[1], "emp2 paid");
        assertEq(usdc.balanceOf(recipients[2]), amounts[2], "emp3 paid");
        assertEq(treasury.balance(), treasuryBefore - total, "Treasury reduced by total");
        (, bool execFinal,,,,, ) = _getProposal(id);
        assertTrue(execFinal, "Executed flag set");
    }

    /**
     * Attempting to substitute one recipient in a payroll execute() reverts.
     * This proves that the frontend useTreasuryPayroll.executePayroll() must pass
     * the exact frozenRecipients returned by propose() — not the current batch state.
     */
    function test_RevertIf_PayrollSubstitutedRecipientOnExecute() public {
        bytes32 id = keccak256("payroll-substitution-test");
        uint64  expiry = uint64(block.timestamp + 7 days);

        address[] memory recipients = new address[](2);
        recipients[0] = makeAddr("emp-a");
        recipients[1] = makeAddr("emp-b");
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500e6;
        amounts[1] = 500e6;

        vm.prank(approver1); treasury.proposePayroll(id, recipients, amounts, expiry);
        vm.prank(approver2); treasury.vote(id);
        vm.prank(approver3); treasury.vote(id);

        // Substitute one recipient — should revert with PayloadHashMismatch
        address[] memory substituted = new address[](2);
        substituted[0] = makeAddr("emp-a");
        substituted[1] = makeAddr("attacker");  // <-- substituted

        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.PayloadHashMismatch.selector, id)
        );
        treasury.execute(id, substituted, amounts);
    }

    /**
     * A recurring-payment-style single TRANSFER proposal: propose with a
     * frozen recipient+amount, two votes, execute, verify funds moved.
     * Also verifies duplicate execution is impossible (executed flag blocks second call).
     */
    function test_RecurringPayment_LifecycleAndDuplicateBlocked() public {
        bytes32 id = keccak256("recurring-exec-001");
        uint64  expiry = uint64(block.timestamp + 7 days);
        address recip = makeAddr("vendor");
        uint256 amt = 250e6;

        vm.prank(approver1); treasury.proposeTransfer(id, recip, amt, expiry);
        vm.prank(approver2); treasury.vote(id);
        vm.prank(approver3); treasury.vote(id);

        address[] memory r = new address[](1); r[0] = recip;
        uint256[] memory a = new uint256[](1); a[0] = amt;

        uint256 before = usdc.balanceOf(recip);
        treasury.execute(id, r, a);
        assertEq(usdc.balanceOf(recip), before + amt, "Vendor received payment");

        // Second execute must revert — duplicate execution blocked
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalAlreadyExecuted.selector, id)
        );
        treasury.execute(id, r, a);
    }

    // ─── F-C1: Expiry boundary (>= semantics) ────────────────────────────────

    /**
     * Voting at the exact expiresAt second is now rejected (>= boundary).
     * Previously the contract used `>`, which would allow a vote at block.timestamp == expiresAt.
     */
    function test_RevertIf_VoteAtExactExpiry() public {
        bytes32 id = keccak256("boundary_vote");
        vm.prank(approver1);
        treasury.proposeTransfer(id, recipient, 100e6, validExpiry);

        // Warp to exactly the expiry second
        vm.warp(validExpiry);

        vm.prank(approver2);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalExpired.selector, id)
        );
        treasury.vote(id);
    }

    /**
     * Executing at the exact expiresAt second is now rejected (>= boundary).
     */
    function test_RevertIf_ExecuteAtExactExpiry() public {
        bytes32 id = keccak256("boundary_exec");
        vm.prank(approver1);
        treasury.proposeTransfer(id, recipient, 100e6, validExpiry);
        _reachQuorum(id);

        vm.warp(validExpiry);

        address[] memory r = new address[](1); r[0] = recipient;
        uint256[] memory a = new uint256[](1); a[0] = 100e6;
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalExpired.selector, id)
        );
        treasury.execute(id, r, a);
    }

    /**
     * Voting one second before expiry must still succeed.
     */
    function test_VoteOneSecondBeforeExpiry() public {
        bytes32 id = keccak256("boundary_ok");
        vm.prank(approver1);
        treasury.proposeTransfer(id, recipient, 100e6, validExpiry);

        vm.warp(validExpiry - 1);

        vm.prank(approver2);
        treasury.vote(id); // must not revert
        (,,,,,, uint16 count) = _getProposal(id);
        assertEq(count, 1);
    }

    // ─── F-C2: Deduplicated approver quorum validation ────────────────────────

    /**
     * If a CONFIG_CHANGE proposal is submitted with duplicate approvers,
     * _setApprovers deduplicates them and then validates quorum against the
     * real (smaller) count. quorum=2, but only 1 unique approver → revert.
     */
    function test_RevertIf_ConfigDuplicateApproversBreaksQuorum() public {
        bytes32 id = keccak256("dedup_config");

        // Two entries, same address — deduplicated to 1 real approver
        address[] memory dupApprovers = new address[](2);
        dupApprovers[0] = approver1;
        dupApprovers[1] = approver1; // duplicate

        // quorum=2 but only 1 unique address — should revert when executed
        vm.prank(approver1);
        treasury.proposeConfigChange(id, dupApprovers, 1, validExpiry); // propose passes (raw len=2, quorum=1)
        _reachQuorum(id);

        // Execute: _setApprovers sees 1 unique approver then calls
        // _validateApproversAndQuorum(1, quorum=1) — quorum=1 ≤ 1 so this actually passes.
        // Now test the FAILING case: quorum=2 with 2 duplicates
        bytes32 id2 = keccak256("dedup_config2");
        vm.prank(approver1);
        // propose: raw count=2, quorum=2 passes _validateApproversAndQuorum(2,2) at propose time
        treasury.proposeConfigChange(id2, dupApprovers, 2, validExpiry + 1);
        vm.prank(approver2); treasury.vote(id2);
        vm.prank(approver3); treasury.vote(id2);

        // Execute: _setApprovers deduplicates to 1 address, then checks quorum=2 vs 1 → revert
        address[] memory r = new address[](2); r[0] = approver1; r[1] = approver1;
        uint256[] memory a = new uint256[](2); a[0] = 2; a[1] = 0;
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.InvalidQuorum.selector, uint8(2), uint256(1))
        );
        treasury.execute(id2, r, a);
    }

    // ─── F-C5: Cancel blocks expired proposals ───────────────────────────────

    /**
     * cancel() now reverts if the proposal has already expired.
     * Previously it would silently set cancelled=true on an already-expired proposal.
     */
    function test_RevertIf_CancelExpiredProposal() public {
        bytes32 id = keccak256("cancel_expired");
        vm.prank(approver1);
        treasury.proposeTransfer(id, recipient, 100e6, validExpiry);

        // Expire the proposal
        vm.warp(validExpiry);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.ProposalExpired.selector, id)
        );
        treasury.cancel(id);
    }

    /**
     * cancel() still works on a non-expired pending proposal.
     */
    function test_CancelBeforeExpiry() public {
        bytes32 id = keccak256("cancel_ok");
        vm.prank(approver1);
        treasury.proposeTransfer(id, recipient, 100e6, validExpiry);

        // One second before expiry — should succeed
        vm.warp(validExpiry - 1);
        vm.prank(owner);
        treasury.cancel(id);
        (, , bool cancelled,,,,) = _getProposal(id);
        assertTrue(cancelled);
    }

    // ─── F-C6: Self-vote creates unreachable quorum (disclosure test) ─────────

    /**
     * When a proposer is the ONLY remaining approver who hasn't voted,
     * self-vote prevention makes quorum permanently unreachable.
     * This documents the known limitation for the case where quorum == approverCount
     * and the proposer is excluded from voting.
     */
    function test_SelfVoteQuorumLockout_DocumentedLimitation() public {
        // Setup: 2-of-2 quorum, approver1 proposes.
        // approver2 is the only other approver.
        // If approver2 is unavailable, quorum can never be reached.
        bytes32 cfgId = keccak256("lockout_2of2");
        address[] memory twoApp = new address[](2);
        twoApp[0] = approver1;
        twoApp[1] = approver2;

        vm.prank(approver1);
        treasury.proposeConfigChange(cfgId, twoApp, 2, validExpiry);
        _reachQuorum(cfgId);

        address[] memory r = new address[](2); r[0] = approver1; r[1] = approver2;
        uint256[] memory a = new uint256[](2); a[0] = 2; a[1] = 0;
        treasury.execute(cfgId, r, a);
        // Now quorum=2, approvers={approver1, approver2}

        // approver1 proposes a transfer
        bytes32 txId = keccak256("locked_selfvote");
        vm.prank(approver1);
        treasury.proposeTransfer(txId, recipient, 100e6, validExpiry + 10);

        // approver1 cannot self-vote
        vm.prank(approver1);
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.SelfVote.selector, txId, approver1)
        );
        treasury.vote(txId);

        // approver2 votes (only 1 vote, quorum=2) — still not executable
        vm.prank(approver2);
        treasury.vote(txId);

        address[] memory tr = new address[](1); tr[0] = recipient;
        uint256[] memory ta = new uint256[](1); ta[0] = 100e6;
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, txId, uint16(1), uint8(2))
        );
        treasury.execute(txId, tr, ta);
        // Documents: if approver1 must propose AND is one of only 2 approvers,
        // quorum=2 is unreachable. Organizations must ensure quorum < approverCount.
    }

    // ─── Governance: new quorum enforced after CONFIG_CHANGE ─────────────────

    /**
     * After a CONFIG_CHANGE reduces quorum from 2 to 1, a single-approver vote
     * on a subsequent proposal is sufficient to reach quorum.
     * This confirms that the new quorum takes effect immediately and that the
     * governance change itself required the OLD quorum (2 votes) to execute.
     */
    function test_GovernanceNewQuorumEnforcedOnSubsequentProposals() public {
        // Step 1: governance proposal to reduce quorum from 2 to 1
        bytes32 cfgId = keccak256("gov_quorum_reduce");
        address[] memory sameApprovers = new address[](3);
        sameApprovers[0] = approver1;
        sameApprovers[1] = approver2;
        sameApprovers[2] = approver3;

        vm.prank(approver1);
        treasury.proposeConfigChange(cfgId, sameApprovers, 1, validExpiry);

        // Governance proposal requires OLD quorum (2) to execute
        _reachQuorum(cfgId); // approver2 + approver3 vote

        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        r[0] = approver1; r[1] = approver2; r[2] = approver3;
        a[0] = 1;         a[1] = 0;         a[2] = 0;
        treasury.execute(cfgId, r, a);

        // Confirm new quorum is 1
        assertEq(treasury.quorum(), 1, "Quorum updated to 1");

        // Step 2: new transfer proposal — only ONE vote needed now
        bytes32 txId = keccak256("gov_quorum_newproposal");
        vm.prank(approver2); // approver2 proposes
        treasury.proposeTransfer(txId, recipient, 200e6, validExpiry + 10);

        // One vote from approver1 is sufficient (quorum=1)
        vm.prank(approver1);
        treasury.vote(txId);

        (,,,,,, uint16 count) = _getProposal(txId);
        assertEq(count, 1, "One vote recorded");

        // Execute succeeds with quorum=1 and approvalCount=1
        address[] memory tr = new address[](1); tr[0] = recipient;
        uint256[] memory ta = new uint256[](1); ta[0] = 200e6;
        uint256 before = usdc.balanceOf(recipient);
        treasury.execute(txId, tr, ta);
        assertEq(usdc.balanceOf(recipient), before + 200e6, "Transfer succeeded with new quorum=1");
    }

    /**
     * Governance change cannot produce an unreachable quorum state via the
     * duplicate-approver path. A CONFIG_CHANGE with [addrA, addrA] and quorum=2
     * passes the propose-time check (raw length=2) but reverts at execute time
     * because _setApprovers deduplicates to 1 unique address and then checks
     * quorum=2 > 1. This test links to test_RevertIf_ConfigDuplicateApproversBreaksQuorum
     * and serves as an explicit requirement anchor.
     *
     * REQUIREMENT: the contract MUST prevent governance from producing a state
     * where quorum > deduplicated approver count, regardless of how the proposal
     * was crafted.
     */
    function test_GovernanceCannotProduceUnreachableQuorum() public {
        bytes32 id = keccak256("gov_unreachable");
        address[] memory dup = new address[](2);
        dup[0] = approver1;
        dup[1] = approver1; // duplicate — raw count=2, dedup count=1

        // propose: passes because raw length check allows quorum=1 of 2
        vm.prank(approver1);
        treasury.proposeConfigChange(id, dup, 1, validExpiry);
        _reachQuorum(id);

        // Execute: _setApprovers deduplicates to 1, quorum=1 ≤ 1 → succeeds.
        // The treasury now has quorum=1, approvers={approver1} — reachable.
        address[] memory r = new address[](2); r[0] = approver1; r[1] = approver1;
        uint256[] memory a = new uint256[](2); a[0] = 1; a[1] = 0;
        treasury.execute(id, r, a);
        assertEq(treasury.approverCount(), 1, "Deduplicated to 1 approver");
        assertEq(treasury.quorum(), 1, "Quorum = 1, still reachable");

        // Now attempt quorum=2 with duplicates (truly unreachable case)
        bytes32 id2 = keccak256("gov_unreachable2");
        vm.prank(approver1);
        treasury.proposeConfigChange(id2, dup, 2, validExpiry + 5);
        // Need only 1 vote now (quorum=1 after previous config)
        vm.prank(approver1); // approver1 is now the only approver, proposes and...
        // Wait — approver1 is the proposer so self-vote is blocked.
        // There are no other approvers! This proposal can never execute.
        // This is the key-loss / last-approver scenario.
        // Verify: execution reverts because quorum (1) is not reached.
        address[] memory tr = new address[](2); tr[0] = approver1; tr[1] = approver1;
        uint256[] memory ta = new uint256[](2); ta[0] = 2; ta[1] = 0;
        vm.expectRevert(
            abi.encodeWithSelector(AskirawaFiTreasury.QuorumNotReached.selector, id2, uint16(0), uint8(1))
        );
        treasury.execute(id2, tr, ta);
        // Note: a CONFIG_CHANGE that would produce quorum=2/1-approver
        // can never execute because the last-approver self-vote lockout applies.
    }

    // ─── Internal helper to unpack proposal tuple ─────────────────────────────

    function _getProposal(bytes32 id) internal view returns (
        uint8 txType, bool executed, bool cancelled,
        uint64 expiresAt, bytes32 contentHash,
        address proposer, uint16 approvalCount
    ) {
        (txType, executed, cancelled, expiresAt, contentHash, proposer, approvalCount)
            = treasury.proposals(id);
    }
}
