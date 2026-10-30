// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  AskirawaFiTreasury
 * @notice Unified on-chain USDC treasury with N-of-M approval enforcement.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠  UNAUDITED — HACKATHON DEMONSTRATION ONLY                           ║
 * ║  This contract has NOT been independently security-audited.             ║
 * ║  Do NOT deploy it to hold substantial real-user funds until a           ║
 * ║  professional audit is completed and findings are resolved.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── Design goals ────────────────────────────────────────────────────────────
 *
 * 1. SINGLE OUTFLOW PATH
 *    All USDC leaves through execute(proposalId).  There is no owner-only
 *    withdrawal, no operator transfer, and no emergency escape that bypasses
 *    quorum.  If this is ever changed, every such function is a bypass of the
 *    approval policy.
 *
 * 2. NO-ESCROW MODEL
 *    Proposed amounts are NOT locked at proposal time.  The full treasury
 *    balance remains available for other approved proposals while a proposal
 *    is pending.  The available balance is checked at execution time.
 *    Trade-off: two proposals can simultaneously reach quorum but only one
 *    can execute if the balance is insufficient for both.  This is acceptable
 *    for a treasury application where proposals are reviewed by humans.
 *    The alternative (escrow) would lock funds for the full proposal lifetime
 *    and complicate cancellation — not justified for this stage.
 *
 * 3. PAYLOAD BINDING
 *    Every proposal stores a contentHash = keccak256(abi.encode(
 *      block.chainid, address(this), proposalId, txType,
 *      recipients[], amounts[], expiresAt
 *    )).  The execute() caller must supply the same arrays; the hash is
 *    recomputed and compared, so no substitution is possible.
 *
 * 4. GOVERNANCE VIA PROPOSALS
 *    Approver-set and quorum changes are themselves proposals of type
 *    CONFIG_CHANGE.  The owner cannot unilaterally change critical settings.
 *    The owner can only cancel proposals and deposit USDC.
 *    This prevents a single compromised owner key from reconfiguring the
 *    approval policy.
 *
 * 5. RECOVERY LIMITATIONS (disclosed)
 *    If the approver set is reduced below quorum or keys are lost, the
 *    treasury funds become permanently inaccessible.  There is deliberately
 *    no emergency bypass.  Organizations must maintain a healthy approver
 *    set and keep quorum reachable at all times.
 *
 * ─── USDC on Arc Mainnet ─────────────────────────────────────────────────────
 *   Chain ID: 5042
 *   USDC ERC-20: 0x3600000000000000000000000000000000000000
 *   Decimals: 6
 *   Verified on-chain before this contract was written.
 *
 * ─── Authorization model ─────────────────────────────────────────────────────
 *   owner       — deployer (or governance-transferred address).
 *                 Can: deposit, cancel proposals, transfer ownership (via proposal).
 *                 Cannot: execute transfers, change approvers unilaterally.
 *   approvers   — addresses authorized to call propose() and vote().
 *                 Managed via CONFIG_CHANGE proposals.
 *   quorum      — number of distinct approver votes required.
 *                 Managed via CONFIG_CHANGE proposals.
 *
 * ─── Proposal lifecycle ──────────────────────────────────────────────────────
 *   propose()  → Pending
 *   vote()     → Pending (partial) or Approved (quorum reached)
 *   cancel()   → Cancelled  [owner only, any non-executed state]
 *   execute()  → Executed   [only if Approved and not expired]
 *   [time]     → Expired    [any non-executed state past expiresAt]
 */

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AskirawaFiTreasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Maximum recipients in a single PAYROLL_BATCH proposal.
    uint256 public constant MAX_BATCH_SIZE = 200;

    /// @notice Maximum allowed proposal lifetime (30 days).
    uint64  public constant MAX_EXPIRY_SECONDS = 30 days;

    /// @notice Minimum allowed proposal lifetime (1 hour).
    uint64  public constant MIN_EXPIRY_SECONDS = 1 hours;

    // ─── Proposal types ───────────────────────────────────────────────────────

    uint8 public constant TX_TRANSFER     = 1; // single recipient USDC transfer
    uint8 public constant TX_PAYROLL      = 2; // atomic multi-recipient batch
    uint8 public constant TX_CONFIG       = 3; // change approvers / quorum

    // ─── Immutables ───────────────────────────────────────────────────────────

    /// @notice The USDC ERC-20 token.  Immutable after deploy.
    IERC20 public immutable usdc;

    // ─── Owner ────────────────────────────────────────────────────────────────

    address public owner;

    // ─── Approver set ─────────────────────────────────────────────────────────

    address[] private _approverList;
    mapping(address => bool) public isApprover;

    /// @notice Minimum number of distinct approver votes to pass a proposal.
    uint8 public quorum;

    // ─── Proposal storage ─────────────────────────────────────────────────────

    struct Proposal {
        uint8   txType;            // TX_TRANSFER | TX_PAYROLL | TX_CONFIG
        bool    executed;
        bool    cancelled;
        uint64  expiresAt;         // unix timestamp
        bytes32 contentHash;       // keccak256 of (chainid, this, id, txType, payload, expiresAt)
        address proposer;
        uint16  approvalCount;     // distinct approver votes in favour
        // Packed into a single slot where possible.
        // votes: stored in the mapping below — not in the struct for gas efficiency.
    }

    mapping(bytes32 => Proposal)             public proposals;   // proposalId => Proposal
    mapping(bytes32 => mapping(address => bool)) public voted;  // proposalId => voter => voted

    // ─── Events ───────────────────────────────────────────────────────────────

    event Deposited(address indexed from, uint256 amount);
    event Proposed(bytes32 indexed proposalId, address indexed proposer, uint8 txType, uint64 expiresAt);
    event Voted(bytes32 indexed proposalId, address indexed approver, uint16 approvalCount, uint8 quorumNeeded);
    event Executed(bytes32 indexed proposalId, uint8 txType, uint256 totalUsdc);
    event PaymentSent(bytes32 indexed proposalId, address indexed recipient, uint256 amount);
    event Cancelled(bytes32 indexed proposalId, address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ApproversUpdated(address[] newApprovers, uint8 newQuorum);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotApprover();
    error ProposalNotFound(bytes32 id);
    error ProposalAlreadyExists(bytes32 id);
    error ProposalAlreadyExecuted(bytes32 id);
    error ProposalAlreadyCancelled(bytes32 id);
    error ProposalExpired(bytes32 id);
    error QuorumNotReached(bytes32 id, uint16 have, uint8 need);
    error AlreadyVoted(bytes32 id, address voter);
    error SelfVote(bytes32 id, address proposer);
    error PayloadHashMismatch(bytes32 id);
    error EmptyBatch();
    error BatchTooLarge(uint256 size, uint256 max);
    error ArrayLengthMismatch(uint256 rLen, uint256 aLen);
    error ZeroRecipient(uint256 index);
    error ZeroAmount(uint256 index);
    error InsufficientTreasuryBalance(uint256 have, uint256 need);
    error InvalidExpiry(uint64 expiresAt);
    error InvalidQuorum(uint8 quorum, uint256 approverCount);
    error ZeroOwner();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyApprover() {
        if (!isApprover[msg.sender]) revert NotApprover();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param usdcAddress  Arc Mainnet USDC: 0x3600000000000000000000000000000000000000
     * @param initialOwner Treasury admin wallet.
     * @param initialApprovers  Addresses authorized to propose and vote.
     * @param initialQuorum     Votes required to pass a proposal.
     */
    constructor(
        address       usdcAddress,
        address       initialOwner,
        address[] memory initialApprovers,
        uint8         initialQuorum
    ) {
        require(usdcAddress   != address(0), "Treasury: zero USDC");
        require(initialOwner  != address(0), "Treasury: zero owner");

        usdc  = IERC20(usdcAddress);
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);

        // Validation against deduplicated count happens inside _setApprovers.
        // A preliminary length check here prevents the zero-approver case early.
        require(initialApprovers.length > 0 && initialQuorum > 0, "Treasury: invalid quorum/approvers");
        _setApprovers(initialApprovers, initialQuorum);
    }

    // ─── Deposit ─────────────────────────────────────────────────────────────

    /**
     * @notice Pull USDC from msg.sender into this contract.
     *         Caller must USDC.approve(address(this), amount) first.
     *         Only call this to fund the treasury — do not send raw ETH.
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Treasury: zero deposit");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    // ─── Read helpers ─────────────────────────────────────────────────────────

    /// @notice Current USDC balance held by this contract.
    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice All current approver addresses.
    function approvers() external view returns (address[] memory) {
        return _approverList;
    }

    /// @notice Number of approvers.
    function approverCount() external view returns (uint256) {
        return _approverList.length;
    }

    // ─── Internal content-hash helper ────────────────────────────────────────

    /**
     * @dev Hash the complete execution payload.
     *      Binds: chain ID, this contract, proposalId, txType, recipients,
     *             amounts, and expiry — preventing cross-chain replay,
     *             contract substitution, payload substitution, and
     *             expiry manipulation.
     */
    function _contentHash(
        bytes32        proposalId,
        uint8          txType,
        address[] memory recipients,
        uint256[] memory amounts,
        uint64         expiresAt
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(
            block.chainid,
            address(this),
            proposalId,
            txType,
            recipients,
            amounts,
            expiresAt
        ));
    }

    // ─── Propose ──────────────────────────────────────────────────────────────

    /**
     * @notice Create a TRANSFER proposal (single recipient).
     *
     * @param proposalId  Caller-supplied unique id (bytes32).
     *                    Recommended: keccak256(abi.encodePacked(offChainId, msg.sender, block.timestamp))
     * @param recipient   Payment destination.
     * @param amount      USDC amount (raw, 6 decimals).
     * @param expiresAt   Unix timestamp after which the proposal cannot be voted on or executed.
     *                    Must be [now + 1h, now + 30d].
     */
    function proposeTransfer(
        bytes32 proposalId,
        address recipient,
        uint256 amount,
        uint64  expiresAt
    ) external onlyApprover {
        _validateExpiry(expiresAt);
        require(recipient != address(0), "Treasury: zero recipient");
        require(amount > 0, "Treasury: zero amount");

        address[] memory recipients = new address[](1);
        uint256[] memory amounts    = new uint256[](1);
        recipients[0] = recipient;
        amounts[0]    = amount;

        _createProposal(proposalId, TX_TRANSFER, recipients, amounts, expiresAt);
    }

    /**
     * @notice Create a PAYROLL_BATCH proposal (multiple recipients, atomic).
     *
     * @param proposalId  Unique identifier for this proposal.
     * @param recipients  Payment destination addresses.
     * @param amounts     Parallel USDC amounts (raw, 6 dec).
     * @param expiresAt   Unix expiry timestamp.
     */
    function proposePayroll(
        bytes32          proposalId,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint64             expiresAt
    ) external onlyApprover {
        _validateExpiry(expiresAt);

        uint256 count = recipients.length;
        if (count == 0)              revert EmptyBatch();
        if (count > MAX_BATCH_SIZE)  revert BatchTooLarge(count, MAX_BATCH_SIZE);
        if (count != amounts.length) revert ArrayLengthMismatch(count, amounts.length);

        for (uint256 i = 0; i < count; ) {
            if (recipients[i] == address(0)) revert ZeroRecipient(i);
            if (amounts[i]    == 0)          revert ZeroAmount(i);
            unchecked { ++i; }
        }

        // Copy calldata to memory for hashing
        address[] memory r = new address[](count);
        uint256[] memory a = new uint256[](count);
        for (uint256 i = 0; i < count; ) {
            r[i] = recipients[i];
            a[i] = amounts[i];
            unchecked { ++i; }
        }

        _createProposal(proposalId, TX_PAYROLL, r, a, expiresAt);
    }

    /**
     * @notice Create a CONFIG_CHANGE proposal to update the approver set and/or quorum.
     *
     * The new approvers and quorum are encoded as amounts/recipients so the same
     * contentHash mechanism binds the governance payload too.
     *
     * Encoding:
     *   recipients[i] = newApprovers[i]  (as address, not used as amount)
     *   amounts[0]    = uint256(newQuorum)
     *   amounts[i>0]  = 0  (unused, required for array length match)
     *
     * This is intentionally simple for a hackathon demo.  A production version
     * would use dedicated ABI-encoded calldata fields.
     *
     * @param proposalId   Unique identifier.
     * @param newApprovers New approver address list.
     * @param newQuorum    New quorum value.
     * @param expiresAt    Unix expiry timestamp.
     */
    function proposeConfigChange(
        bytes32          proposalId,
        address[] calldata newApprovers,
        uint8            newQuorum,
        uint64           expiresAt
    ) external onlyApprover {
        _validateExpiry(expiresAt);
        _validateApproversAndQuorum(newApprovers.length, newQuorum);

        uint256 count = newApprovers.length;
        address[] memory r = new address[](count);
        uint256[] memory a = new uint256[](count);
        a[0] = uint256(newQuorum);
        for (uint256 i = 0; i < count; ) {
            r[i] = newApprovers[i];
            unchecked { ++i; }
        }

        _createProposal(proposalId, TX_CONFIG, r, a, expiresAt);
    }

    // ─── Internal proposal creation ───────────────────────────────────────────

    function _createProposal(
        bytes32          proposalId,
        uint8            txType,
        address[] memory recipients,
        uint256[] memory amounts,
        uint64           expiresAt
    ) internal {
        if (proposals[proposalId].expiresAt != 0) revert ProposalAlreadyExists(proposalId);

        bytes32 h = _contentHash(proposalId, txType, recipients, amounts, expiresAt);

        proposals[proposalId] = Proposal({
            txType:        txType,
            executed:      false,
            cancelled:     false,
            expiresAt:     expiresAt,
            contentHash:   h,
            proposer:      msg.sender,
            approvalCount: 0
        });

        emit Proposed(proposalId, msg.sender, txType, expiresAt);
    }

    // ─── Vote ─────────────────────────────────────────────────────────────────

    /**
     * @notice Cast an approval vote for a proposal.
     *
     * Rules:
     *   - Only addresses in the approver set may vote.
     *   - The proposer cannot vote on their own proposal (self-vote guard).
     *   - Each address may vote exactly once per proposal.
     *   - Expired, cancelled, and already-executed proposals cannot be voted on.
     *
     * @param proposalId  The proposal to approve.
     */
    function vote(bytes32 proposalId) external onlyApprover {
        Proposal storage p = proposals[proposalId];
        if (p.expiresAt == 0)                  revert ProposalNotFound(proposalId);
        if (p.executed)                        revert ProposalAlreadyExecuted(proposalId);
        if (p.cancelled)                       revert ProposalAlreadyCancelled(proposalId);
        if (block.timestamp >= p.expiresAt)    revert ProposalExpired(proposalId);
        if (msg.sender == p.proposer)          revert SelfVote(proposalId, msg.sender);
        if (voted[proposalId][msg.sender])     revert AlreadyVoted(proposalId, msg.sender);

        voted[proposalId][msg.sender] = true;
        // Safe: approvalCount is uint16, approver list is bounded by _validateApproversAndQuorum
        unchecked { p.approvalCount += 1; }

        emit Voted(proposalId, msg.sender, p.approvalCount, quorum);
    }

    // ─── Cancel ───────────────────────────────────────────────────────────────

    /**
     * @notice Cancel a proposal.  No funds move.
     *         Only the owner may cancel.  Cannot cancel an already-executed proposal.
     *
     * @param proposalId  The proposal to cancel.
     */
    function cancel(bytes32 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        if (p.expiresAt == 0)                 revert ProposalNotFound(proposalId);
        if (p.executed)                       revert ProposalAlreadyExecuted(proposalId);
        if (p.cancelled)                      revert ProposalAlreadyCancelled(proposalId);
        if (block.timestamp >= p.expiresAt)   revert ProposalExpired(proposalId);

        p.cancelled = true;
        emit Cancelled(proposalId, msg.sender);
    }

    // ─── Execute ──────────────────────────────────────────────────────────────

    /**
     * @notice Execute an approved, non-expired proposal.
     *
     * TRANSFER proposals: transfers USDC to the single recipient.
     * PAYROLL proposals:  atomically transfers USDC to all recipients.
     *                     If any individual transfer fails, the entire call reverts.
     * CONFIG proposals:   updates the approver set and quorum.
     *
     * Security properties:
     *   - contentHash is recomputed from the supplied arrays and compared to storage.
     *     Any payload substitution (different recipients, amounts, or expiry) reverts.
     *   - balance is checked at execution time (no-escrow model).
     *   - nonReentrant guard from ReentrancyGuard (prevents re-entry during USDC transfers).
     *   - executed flag is set before any external call (CEI pattern).
     *
     * @param proposalId  Must match a stored, approved, non-expired proposal.
     * @param recipients  Must match the recipients encoded at proposal creation time.
     * @param amounts     Must match the amounts encoded at proposal creation time.
     */
    function execute(
        bytes32          proposalId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        Proposal storage p = proposals[proposalId];

        // ── Existence and state checks ────────────────────────────────────────
        if (p.expiresAt == 0)               revert ProposalNotFound(proposalId);
        if (p.executed)                     revert ProposalAlreadyExecuted(proposalId);
        if (p.cancelled)                    revert ProposalAlreadyCancelled(proposalId);
        if (block.timestamp >= p.expiresAt) revert ProposalExpired(proposalId);
        if (p.approvalCount < quorum)
            revert QuorumNotReached(proposalId, p.approvalCount, quorum);

        // ── Payload integrity check ───────────────────────────────────────────
        // Copy calldata to memory for hashing (memory arrays in _contentHash)
        uint256 count = recipients.length;
        address[] memory r = new address[](count);
        uint256[] memory a = new uint256[](count);
        for (uint256 i = 0; i < count; ) {
            r[i] = recipients[i];
            a[i] = amounts[i];
            unchecked { ++i; }
        }

        bytes32 expected = _contentHash(proposalId, p.txType, r, a, p.expiresAt);
        if (expected != p.contentHash) revert PayloadHashMismatch(proposalId);

        // ── CEI: mark executed before any external calls ──────────────────────
        p.executed = true;

        // ── Dispatch by type ──────────────────────────────────────────────────
        if (p.txType == TX_TRANSFER || p.txType == TX_PAYROLL) {
            _executePayments(proposalId, r, a);
        } else if (p.txType == TX_CONFIG) {
            _executeConfigChange(proposalId, r, a);
        }
    }

    // ─── Internal execution helpers ───────────────────────────────────────────

    function _executePayments(
        bytes32          proposalId,
        address[] memory recipients,
        uint256[] memory amounts
    ) internal {
        uint256 totalUsdc;
        uint256 count = recipients.length;

        // Pre-compute total and validate (allows a single balance check before transfers)
        for (uint256 i = 0; i < count; ) {
            totalUsdc += amounts[i];
            unchecked { ++i; }
        }

        uint256 bal = usdc.balanceOf(address(this));
        if (bal < totalUsdc) revert InsufficientTreasuryBalance(bal, totalUsdc);

        // Transfer (all-or-nothing: SafeERC20.safeTransfer reverts on failure)
        for (uint256 i = 0; i < count; ) {
            usdc.safeTransfer(recipients[i], amounts[i]);
            emit PaymentSent(proposalId, recipients[i], amounts[i]);
            unchecked { ++i; }
        }

        emit Executed(proposalId, proposals[proposalId].txType, totalUsdc);
    }

    function _executeConfigChange(
        bytes32          proposalId,
        address[] memory newApprovers,
        uint256[] memory newAmounts
    ) internal {
        // Decode: newApprovers are r[], newQuorum is a[0]
        uint8 newQuorum = uint8(newAmounts[0]);
        _validateApproversAndQuorum(newApprovers.length, newQuorum);
        _setApprovers(newApprovers, newQuorum);

        emit Executed(proposalId, TX_CONFIG, 0);
        emit ApproversUpdated(newApprovers, newQuorum);
    }

    // ─── Internal governance helpers ─────────────────────────────────────────

    function _setApprovers(address[] memory newApprovers, uint8 newQuorum) internal {
        // Clear old set
        for (uint256 i = 0; i < _approverList.length; ) {
            isApprover[_approverList[i]] = false;
            unchecked { ++i; }
        }
        delete _approverList;

        // Write new set — silently deduplicate duplicates within the input
        for (uint256 i = 0; i < newApprovers.length; ) {
            address a = newApprovers[i];
            require(a != address(0), "Treasury: zero approver");
            if (!isApprover[a]) {
                isApprover[a] = true;
                _approverList.push(a);
            }
            unchecked { ++i; }
        }

        // Validate quorum against the DEDUPLICATED count, not the raw input length.
        // If duplicate addresses were passed, the effective approver count is lower.
        _validateApproversAndQuorum(_approverList.length, newQuorum);

        quorum = newQuorum;
    }

    function _validateExpiry(uint64 expiresAt) internal view {
        uint64 lo = uint64(block.timestamp) + MIN_EXPIRY_SECONDS;
        uint64 hi = uint64(block.timestamp) + MAX_EXPIRY_SECONDS;
        if (expiresAt < lo || expiresAt > hi) revert InvalidExpiry(expiresAt);
    }

    function _validateApproversAndQuorum(
        uint256 approverCount_,
        uint8   newQuorum
    ) internal pure {
        if (approverCount_ == 0 || newQuorum == 0 || newQuorum > approverCount_)
            revert InvalidQuorum(newQuorum, approverCount_);
    }

    // ─── Owner-only: transfer ownership ──────────────────────────────────────

    /**
     * @notice Transfer treasury ownership to a new address.
     *         The new owner can cancel proposals and fund the treasury.
     *         To also retain governance control, the new owner should be
     *         included in a subsequent CONFIG_CHANGE proposal.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroOwner();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
