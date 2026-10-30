// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AskirawaFiTreasury} from "../AskirawaFiTreasury.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal ERC-20 mock (6 decimals). Can be told to revert transfers to chosen
// recipients so payroll atomicity can be exercised.
// ─────────────────────────────────────────────────────────────────────────────
contract MockERC20 {
    string  public name;
    string  public symbol;
    uint8   public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    mapping(address => bool) public blockedRecipient;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name     = _name;
        symbol   = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply   += amount;
    }

    function setBlockedRecipient(address who, bool blocked) external {
        blockedRecipient[who] = blocked;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(!blockedRecipient[to], "MockERC20: blocked recipient");
        require(balanceOf[msg.sender] >= amount, "MockERC20: insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "MockERC20: insufficient");
        require(allowance[from][msg.sender] >= amount, "MockERC20: allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared base – no test/fuzz/invariant functions here.
//
// Default fixture: approvers = {owner, alice, bob}, quorum = 2, treasury funded
// with TREASURY_SEED. NOTE: the proposer can never vote on their own proposal,
// so with 3 approvers a proposal is approved by the two OTHER approvers.
// ─────────────────────────────────────────────────────────────────────────────
abstract contract AskirawaFiTreasuryTestBase is Test {
    AskirawaFiTreasury internal treasury;
    MockERC20          internal usdc;

    address internal owner     = makeAddr("owner");
    address internal alice     = makeAddr("alice");
    address internal bob       = makeAddr("bob");
    address internal carol     = makeAddr("carol");
    address internal dave      = makeAddr("dave");
    address internal stranger  = makeAddr("stranger");
    address internal recipient = makeAddr("recipient");

    uint256 internal constant TREASURY_SEED = 100_000e6; // 100k USDC

    struct PView {
        uint8   txType;
        bool    executed;
        bool    cancelled;
        uint64  expiresAt;
        bytes32 contentHash;
        address proposer;
        uint16  approvalCount;
    }

    function setUp() public virtual {
        usdc     = new MockERC20("Mock USDC", "mUSDC", 6);
        treasury = new AskirawaFiTreasury(address(usdc), owner, _addrs3(owner, alice, bob), 2);
        usdc.mint(address(treasury), TREASURY_SEED);
    }

    // ── array helpers ────────────────────────────────────────────────────────

    function _one(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _oneU(uint256 v) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = v;
    }

    function _addrs2(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }

    function _addrs3(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    function _addrs4(address a, address b, address c, address d) internal pure returns (address[] memory r) {
        r = new address[](4);
        r[0] = a;
        r[1] = b;
        r[2] = c;
        r[3] = d;
    }

    function _uints2(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    /// Amount array as encoded by proposeConfigChange: [quorum, 0, 0, ...] of length n.
    function _cfgAmounts(uint256 n, uint8 q) internal pure returns (uint256[] memory r) {
        r = new uint256[](n);
        r[0] = q;
    }

    // ── id / time helpers ────────────────────────────────────────────────────

    function _pid(string memory label) internal pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    /// A valid expiry: now + 1 day.
    function _exp() internal view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }

    // ── content hash replica (spec in the contract's NatSpec) ────────────────

    function _hash(
        bytes32 id,
        uint8 txType,
        address[] memory r,
        uint256[] memory a,
        uint64 expiresAt
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(treasury), id, txType, r, a, expiresAt));
    }

    // ── proposal helpers ─────────────────────────────────────────────────────

    /// proposeTransfer as `by` with a 1-day expiry; returns the expiry used.
    function _proposeTransfer(address by, bytes32 id, address to, uint256 amount)
        internal returns (uint64 exp)
    {
        exp = _exp();
        vm.prank(by);
        treasury.proposeTransfer(id, to, amount, exp);
    }

    function _proposePayroll(address by, bytes32 id, address[] memory r, uint256[] memory a)
        internal returns (uint64 exp)
    {
        exp = _exp();
        vm.prank(by);
        treasury.proposePayroll(id, r, a, exp);
    }

    function _proposeConfig(address by, bytes32 id, address[] memory newApprovers, uint8 newQuorum)
        internal returns (uint64 exp)
    {
        exp = _exp();
        vm.prank(by);
        treasury.proposeConfigChange(id, newApprovers, newQuorum, exp);
    }

    function _vote(address who, bytes32 id) internal {
        vm.prank(who);
        treasury.vote(id);
    }

    /// Execute as an arbitrary caller (execute() is permissionless).
    function _execute(bytes32 id, address[] memory r, uint256[] memory a) internal {
        vm.prank(stranger);
        treasury.execute(id, r, a);
    }

    /// Full happy path for a single transfer in the default fixture:
    /// owner proposes, alice + bob vote.
    function _proposeApprove(bytes32 id, address to, uint256 amount) internal returns (uint64 exp) {
        exp = _proposeTransfer(owner, id, to, amount);
        _vote(alice, id);
        _vote(bob, id);
    }

    function _prop(bytes32 id) internal view returns (PView memory v) {
        (v.txType, v.executed, v.cancelled, v.expiresAt, v.contentHash, v.proposer, v.approvalCount) =
            treasury.proposals(id);
    }
}
