// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  PayrollBatch
 * @notice Atomic batch USDC payroll disbursement via the ERC-20 transferFrom pull model.
 *
 * ─── Pull model ──────────────────────────────────────────────────────────────────
 * The treasury wallet MUST call USDC.approve(address(this), totalAmount) before
 * calling executeBatch.  The approval should be exactly the batch total — not an
 * unlimited approval.  The contract pulls USDC from msg.sender (which must be the
 * owner) and distributes it to the recipients in a single atomic transaction.
 *
 * ─── Atomicity ──────────────────────────────────────────────────────────────────
 * If any individual transfer fails the entire call reverts, leaving no partial state.
 * SafeERC20.safeTransferFrom is used throughout — it reverts on false return values
 * and handles non-reverting USDC implementations safely.
 *
 * ─── Replay prevention ──────────────────────────────────────────────────────────
 * Each batchId (bytes32) is recorded in usedBatches once executed.  Re-submitting
 * the same batchId reverts with BatchAlreadyExecuted.
 *
 * ─── Gas bound ───────────────────────────────────────────────────────────────────
 * MAX_BATCH_SIZE = 200 limits gas per transaction to a manageable ceiling
 * (~6 M gas at typical ERC-20 transfer costs on Arc).
 *
 * ─── Authorization ───────────────────────────────────────────────────────────────
 * Only the contract owner may call executeBatch.  Ownership can be transferred
 * with transferOwnership (from Ownable).  The deployer address becomes the
 * initial owner.
 *
 * ─── USDC address ────────────────────────────────────────────────────────────────
 * Set immutably at deploy time.  On Arc Mainnet (chain ID 5042):
 *   USDC = 0x3600000000000000000000000000000000000000  (symbol: USDC, decimals: 6)
 * Verified on-chain before this contract was written.
 */
contract PayrollBatch is Ownable {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Maximum number of recipients in a single batch.
    uint256 public constant MAX_BATCH_SIZE = 200;

    // ─── Immutables ───────────────────────────────────────────────────────────

    /// @notice The USDC ERC-20 token contract used for all payments.
    IERC20 public immutable usdc;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Records which batch IDs have already been executed.
    mapping(bytes32 => bool) public usedBatches;

    // ─── Events ───────────────────────────────────────────────────────────────

    /**
     * @notice Emitted once per successful batch.
     * @param batchId    The caller-supplied batch identifier.
     * @param executor   The owner address that submitted the batch.
     * @param count      Number of payments in the batch.
     * @param totalUsdc  Total USDC disbursed (sum of all amounts, in raw units).
     */
    event BatchExecuted(
        bytes32 indexed batchId,
        address indexed executor,
        uint256 count,
        uint256 totalUsdc
    );

    /**
     * @notice Emitted once per individual payment within a batch.
     * @param batchId   The batch this payment belongs to.
     * @param recipient The payment destination.
     * @param amount    The USDC amount transferred (raw units, 6 decimals on Arc).
     */
    event PaymentSent(
        bytes32 indexed batchId,
        address indexed recipient,
        uint256 amount
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error BatchAlreadyExecuted(bytes32 batchId);
    error EmptyBatch();
    error BatchTooLarge(uint256 size, uint256 max);
    error ArrayLengthMismatch(uint256 recipientsLen, uint256 amountsLen);
    error ZeroRecipient(uint256 index);
    error ZeroAmount(uint256 index);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param usdcAddress  ERC-20 token used for payments.  On Arc Mainnet:
     *                     0x3600000000000000000000000000000000000000
     * @param initialOwner Address that becomes the initial owner / executor.
     *                     Should be the treasury wallet.
     */
    constructor(address usdcAddress, address initialOwner) Ownable(initialOwner) {
        require(usdcAddress != address(0), "PayrollBatch: zero USDC address");
        usdc = IERC20(usdcAddress);
    }

    // ─── Core function ────────────────────────────────────────────────────────

    /**
     * @notice Execute an atomic payroll batch.
     *
     * Prerequisites (caller must satisfy BEFORE calling this function):
     *   1. Call USDC.approve(address(this), totalAmount) from the treasury wallet,
     *      where totalAmount = sum(amounts).  The approval should be exactly the
     *      batch total — not an unlimited approval.
     *   2. The treasury wallet must hold at least totalAmount USDC.
     *
     * @param batchId    A unique identifier for this batch (bytes32).
     *                   Recommended: keccak256 of the off-chain batch UUID.
     *                   Reusing a batchId that was already executed reverts.
     * @param recipients Array of recipient wallet addresses (no zero addresses).
     * @param amounts    Parallel array of USDC amounts in raw units (6 decimals).
     *                   Each amount must be > 0.
     *
     * Reverts if:
     *   - batchId has already been used
     *   - recipients is empty
     *   - recipients.length > MAX_BATCH_SIZE
     *   - recipients.length != amounts.length
     *   - any recipient is address(0)
     *   - any amount is 0
     *   - any safeTransferFrom fails (e.g. insufficient allowance or balance)
     */
    function executeBatch(
        bytes32 batchId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner {
        // ── Replay guard ──────────────────────────────────────────────────────
        if (usedBatches[batchId]) revert BatchAlreadyExecuted(batchId);

        // ── Input validation ──────────────────────────────────────────────────
        uint256 count = recipients.length;
        if (count == 0) revert EmptyBatch();
        if (count > MAX_BATCH_SIZE) revert BatchTooLarge(count, MAX_BATCH_SIZE);
        if (count != amounts.length) revert ArrayLengthMismatch(count, amounts.length);

        // ── Mark used before external calls (CEI pattern) ─────────────────────
        usedBatches[batchId] = true;

        // ── Execute payments ──────────────────────────────────────────────────
        uint256 totalUsdc;
        for (uint256 i = 0; i < count; ) {
            address recipient = recipients[i];
            uint256 amount    = amounts[i];

            if (recipient == address(0)) revert ZeroRecipient(i);
            if (amount == 0)            revert ZeroAmount(i);

            totalUsdc += amount;

            // safeTransferFrom reverts on failure — no partial state possible
            usdc.safeTransferFrom(msg.sender, recipient, amount);
            emit PaymentSent(batchId, recipient, amount);

            unchecked { ++i; }
        }

        emit BatchExecuted(batchId, msg.sender, count, totalUsdc);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /**
     * @notice Returns true when the given batchId has already been executed.
     */
    function isBatchExecuted(bytes32 batchId) external view returns (bool) {
        return usedBatches[batchId];
    }

    /**
     * @notice Returns the current USDC allowance this contract has from `account`.
     *         Use this to verify the approval before calling executeBatch.
     */
    function allowanceFrom(address account) external view returns (uint256) {
        return usdc.allowance(account, address(this));
    }
}
