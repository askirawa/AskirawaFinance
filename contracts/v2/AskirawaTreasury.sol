// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ITreasuryModule} from "./interfaces/ITreasuryModule.sol";
import {IAskirawaTreasury} from "./interfaces/IAskirawaTreasury.sol";

/**
 * @title AskirawaTreasury
 * @notice UNAUDITED immutable USDC treasury with epoch-snapshotted quorum voting.
 * @dev D9 recovery remains unresolved: this implementation is option A, NO recovery.
 * There is no owner, backdoor, recovery role or upgrade path. Loss of quorum keys
 * can permanently lock funds. Changing that policy requires a new contract and
 * migration authorized by a still-live quorum through ordinary payroll.
 *
 * Payroll is strictly all-or-nothing. Funds are not reserved by proposals.
 * Every mutation shares a storage-based reentrancy lock, including module callbacks.
 * Role powers are additive: a guardian that is independently an approver/proposer
 * retains that other role's powers. Guardian authority alone cannot spend or vote.
 * No native-currency handlers exist; accounting uses ERC-20 balanceOf exclusively.
 */
contract AskirawaTreasury is ReentrancyGuard, IAskirawaTreasury {
    using SafeERC20 for IERC20;

    /// @notice Minimum quorum on every network; cannot be changed by governance.
    uint8 public constant MIN_QUORUM = 2;
    /// @notice Maximum approvers in any epoch.
    uint256 public constant MAX_APPROVERS = 20;
    /// @notice Maximum explicitly listed proposers in any epoch.
    uint256 public constant MAX_PROPOSERS = 50;
    /// @notice Maximum stored payroll items per proposal.
    uint256 public constant MAX_PAYMENTS = 100;
    /// @notice Maximum flat delay for either action class.
    uint32 public constant MAX_DELAY = 14 days;
    /// @notice Maximum budget window duration.
    uint32 public constant MAX_WINDOW_LENGTH = 365 days;
    /// @notice Maximum proposal lifetime measured from creation.
    uint64 public constant MAX_PROPOSAL_LIFETIME = 30 days;
    /// @notice Minimum proposal lifetime beyond the creation-time action delay.
    uint64 public constant MIN_EXECUTION_WINDOW = 1 hours;
    /// @notice Immutable USDC contract supplied at construction.
    IERC20 public immutable override usdc;
    /// @notice Immutable minimum configuration delay, in seconds.
    uint32 public immutable MIN_CONFIG_DELAY;
    /// @notice Currently active governance epoch; starts at one.
    uint256 public currentEpoch;
    /// @notice True when all executions except Governance and Unpause are blocked.
    bool public override paused;
    /// @notice Monotonic pause identifier; increments on each successful transition to paused.
    uint64 public pauseCount;
    /// @notice Next sequential proposal identifier; starts at one.
    uint256 public nextProposalId = 1;

    /// @notice An immutable historical governance configuration.
    struct Epoch {
        uint8 quorum;
        uint32 payrollDelay;
        uint32 configDelay;
        address guardian;
        address[] approvers;
        address[] proposers;
        uint64 createdAt;
    }

    /// @notice Supported typed actions; None is reserved for nonexistent proposals.
    enum Action { None, Payroll, Governance, ModuleConfig, ModuleAction, Rescue, Unpause }
    /// @notice Persisted lifecycle state; time and epoch states are derived only.
    enum Status { None, Pending, Executed, Cancelled, Rejected }
    /// @notice Derived state, independent of pause. Terminal stored states take
    /// precedence, then Expired, then Fenced, then quorum and delay states.
    enum ProposalStatus { None, Pending, Approved, Executable, Executed, Cancelled, Rejected, Expired, Fenced }

    /// @notice Snapshot and lifecycle metadata. Amounts are raw USDC token units.
    struct Proposal {
        Action action;
        Status status;
        uint64 epoch;
        uint8 quorum;
        address proposer;
        uint64 createdAt;
        uint64 approvedAt;
        uint64 executableAt;
        uint64 expiresAt;
        uint16 approvals;
        uint16 rejections;
        uint96 totalAmount;
        bytes32 payloadHash;
        bytes32 memoRef;
    }

    /// @notice One payroll item; address plus uint96 occupy exactly one storage slot.
    struct Payment { address to; uint96 amount; }
    /// @notice Governance payload, without the execution-assigned createdAt field.
    struct GovernancePayload {
        address[] approvers;
        address[] proposers;
        uint8 quorum;
        address guardian;
        uint32 payrollDelay;
        uint32 configDelay;
    }
    /// @notice Proposed module registration or budget update.
    struct ModuleConfigPayload {
        address module;
        bool enabled;
        uint96 perTxMax;
        uint96 windowMax;
        uint32 windowLength;
    }
    /// @notice Module-specific action and optional budget-checked prefunding.
    struct ModuleActionPayload {
        address module;
        uint8 actionCode;
        bytes data;
        uint96 fundingAmount;
    }
    /// @notice Rescue of a non-USDC ERC-20 asset.
    struct RescuePayload { address token; address to; uint256 amount; }
    /// @notice Canonical Unpause payload; encodes unpause = true and the pause identifier it authorizes.
    struct UnpausePayload { bool unpause; uint64 pauseCount; }
    /// @notice Codehash-pinned module budget and fixed-window usage.
    struct ModuleConfig {
        bool enabled;
        bytes32 codehash;
        uint96 perTxMax;
        uint96 windowMax;
        uint32 windowLength;
        uint64 windowStart;
        uint96 windowSpent;
    }

    mapping(uint256 => Epoch) private _epochs;
    /// @notice Epoch role bits: bit zero approver; bit one explicitly listed proposer.
    mapping(uint256 => mapping(address => uint8)) public roleFlags;
    /// @notice Proposal metadata, including stored rather than derived status.
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => Payment[]) private _payroll;
    mapping(uint256 => bytes) private _payload;
    /// @notice Immutable individual vote: zero absent, one approval, two rejection.
    mapping(uint256 => mapping(address => uint8)) public voteOf;
    mapping(uint256 => address[]) private _voters;
    /// @notice Registration and current stored accounting for each module.
    mapping(address => ModuleConfig) public modules;

    /// @notice A new, immutable epoch was created; full roster is available via getEpoch.
    event EpochCreated(uint256 indexed epoch, uint8 quorum, uint32 payrollDelay, uint32 configDelay, address guardian);
    /// @notice USDC was pulled into the treasury.
    event Deposited(address indexed from, uint256 amount);
    /// @notice A complete stored proposal was created; payload is available via getPayload.
    event Proposed(uint256 indexed proposalId, uint256 indexed epoch, address indexed proposer, Action action,
        uint96 totalAmount, uint64 expiresAt, bytes32 payloadHash, bytes32 memoRef);
    /// @notice One item in the immutable stored payroll payload.
    event PayrollItem(uint256 indexed proposalId, uint256 indexed index, address indexed to, uint96 amount);
    /// @notice A governance payload was stored in the proposal.
    event GovernanceItem(uint256 indexed proposalId, address[] approvers, address[] proposers, uint8 quorum,
        address guardian, uint32 payrollDelay, uint32 configDelay);
    /// @notice An immutable vote was cast, including proposer auto-approval.
    event Voted(uint256 indexed proposalId, address indexed voter, uint8 vote, uint16 approvals, uint16 rejections);
    /// @notice Quorum was first reached; subsequent votes do not restart the delay.
    event QuorumReached(uint256 indexed proposalId, uint64 approvedAt, uint64 executableAt);
    /// @notice Rejections made quorum mathematically unreachable.
    event Rejected(uint256 indexed proposalId);
    /// @notice The proposer or authorized current guardian cancelled a proposal.
    event Cancelled(uint256 indexed proposalId, address indexed by);
    /// @notice Every interaction for this proposal completed atomically.
    event Executed(uint256 indexed proposalId, Action action, uint96 totalAmount);
    /// @notice One payroll transfer completed; a later failure rolls back this event too.
    event PaymentSent(uint256 indexed proposalId, uint256 indexed index, address indexed to, uint96 amount);
    /// @notice Core outflows were paused by a current approver or guardian.
    event Paused(address indexed by);
    /// @notice A quorum-approved proposal unpaused the core.
    event Unpaused(uint256 indexed proposalId);
    /// @notice Registration or budgets changed; active usage was not silently cleared.
    event ModuleConfigured(address indexed module, bool enabled, bytes32 codehash, uint96 perTxMax,
        uint96 windowMax, uint32 windowLength);
    /// @notice Budget-checked USDC was sent directly to a module-selected recipient.
    event ModulePaid(address indexed module, address indexed to, uint256 amount, bytes32 ref);
    /// @notice Budget-checked USDC was sent to the module's own custody.
    event ModuleFunded(address indexed module, uint256 amount, bytes32 ref);
    /// @notice A non-USDC asset was rescued by quorum.
    event Rescued(uint256 indexed proposalId, address indexed token, address indexed to, uint256 amount);

    /// @notice An address is zero, self, or otherwise disallowed for the operation.
    error InvalidAddress(address account);
    /// @notice A contract address has no deployed code.
    error NoCode(address account);
    /// @notice A role list contains the same address more than once.
    error DuplicateRole(address account);
    /// @notice Approver or proposer count is outside its bounds.
    error InvalidRoleCount(uint256 approvers, uint256 proposers);
    /// @notice Quorum is outside [MIN_QUORUM, approver count].
    error InvalidQuorum(uint8 quorum, uint256 approverCount);
    /// @notice A delay violates the immutable floor or maximum.
    error InvalidDelay(uint32 payrollDelay, uint32 configDelay);
    /// @notice Caller is not a current approver or proposer.
    error NotProposer();
    /// @notice Caller is not an approver in the relevant epoch.
    error NotApprover();
    /// @notice Caller lacks cancellation or pause authority.
    error Unauthorized();
    /// @notice Proposal is nonexistent or is not in the required stored state.
    error NotPending(uint256 proposalId);
    /// @notice Proposal has reached its expiry timestamp.
    error Expired(uint256 proposalId);
    /// @notice Proposal belongs to a fenced epoch.
    error WrongEpoch(uint256 proposalEpoch, uint256 activeEpoch);
    /// @notice This account already cast an immutable vote.
    error AlreadyVoted(uint256 proposalId, address voter);
    /// @notice Snapshot quorum has not been reached.
    error QuorumNotReached(uint256 proposalId, uint16 have, uint8 need);
    /// @notice The post-quorum action delay has not elapsed.
    error DelayNotElapsed(uint64 executableAt);
    /// @notice Proposed expiry is outside the creation-time bounds.
    error InvalidExpiry(uint64 expiresAt);
    /// @notice Amount must be positive.
    error ZeroAmount();
    /// @notice Payroll length is outside [1, MAX_PAYMENTS].
    error InvalidPaymentCount(uint256 count);
    /// @notice Sum of payroll amounts cannot be represented as uint96.
    error TotalOverflow();
    /// @notice Core is paused or was already paused.
    error TreasuryPaused();
    /// @notice Unpause may only be proposed while paused.
    error NotPaused();
    /// @notice Unpause execution requires an active pause matching the proposal's bound identifier.
    error StalePauseUnpause(uint256 proposalId, uint64 bound, uint64 current);
    /// @notice Available balance is insufficient for the requested outflow.
    error InsufficientBalance(uint256 have, uint256 need);
    /// @notice Token balance delta differs from the promised amount.
    error BalanceDeltaMismatch(uint256 beforeBalance, uint256 afterBalance, uint256 expected);
    /// @notice Stored payroll sum does not match its proposal total.
    error PayloadMismatch(uint256 proposalId);
    /// @notice Module configuration has invalid budget limits or duration.
    error InvalidBudget();
    /// @notice Module failed ERC-165 or treasury binding validation.
    error InvalidModule(address module);
    /// @notice Module is disabled or was never registered.
    error ModuleDisabled(address module);
    /// @notice Module runtime code differs from its registered codehash.
    error ModuleCodeChanged(address module);
    /// @notice Module draw exceeds its per-call or current-window limit.
    error BudgetExceeded();
    /// @notice Callback reverted; original revert bytes are supplied as untrusted diagnostics.
    error ModuleCallbackFailed(uint256 proposalId, bytes reason);
    /// @notice Rescue cannot target the configured USDC asset.
    error CannotRescueUSDC();
    /// @notice A timestamp or epoch identifier cannot fit its snapshot representation.
    error SnapshotOverflow();

    /**
     * @notice Constructs epoch one without assigning any authority to the deployer.
     * @param usdc_ Deployed USDC token contract; no address is supplied by the source.
     * @param minConfigDelay Immutable configuration-delay floor, in seconds.
     * @param approvers_ Two to twenty unique, nonzero, non-core approvers.
     * @param proposers_ Up to fifty unique, nonzero, non-core proposers; may overlap approvers.
     * @param quorum_ Approval threshold, at least two and no larger than the approver count.
     * @param guardian_ Guardian or zero to disable; must not be the core itself.
     * @param payrollDelay_ Flat payroll, module-action and rescue delay, at most fourteen days.
     * @param configDelay_ Flat governance, module-config and unpause delay, within floor and maximum.
     */
    constructor(address usdc_, uint32 minConfigDelay, address[] memory approvers_, address[] memory proposers_,
        uint8 quorum_, address guardian_, uint32 payrollDelay_, uint32 configDelay_) {
        if (usdc_.code.length == 0) revert NoCode(usdc_);
        usdc = IERC20(usdc_);
        MIN_CONFIG_DELAY = minConfigDelay;
        GovernancePayload memory config = GovernancePayload(approvers_, proposers_, quorum_, guardian_, payrollDelay_, configDelay_);
        _validateGovernance(config);
        _createEpoch(config);
    }

    /// @notice Pulls positive USDC from the caller using their prior allowance.
    /// @param amount Raw USDC amount to deposit. Direct ERC-20 transfers also increase balance().
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 beforeBalance = balance();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = balance();
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert BalanceDeltaMismatch(beforeBalance, afterBalance, amount);
        }
        emit Deposited(msg.sender, amount);
    }

    /// @notice Stores an atomic payroll, emitting each item and auto-approving for an approver proposer.
    /// @param items One to one hundred nonzero payments, excluding zero/core recipients.
    /// @param expiresAt Expiry within [now + action delay + one hour, now + thirty days].
    /// @param memoRef Opaque reference to off-chain metadata.
    /// @return id Assigned sequential proposal identifier.
    function proposePayroll(Payment[] calldata items, uint64 expiresAt, bytes32 memoRef)
        external nonReentrant returns (uint256 id) {
        uint256 count = items.length;
        if (count == 0 || count > MAX_PAYMENTS) revert InvalidPaymentCount(count);
        uint256 total;
        for (uint256 i; i < count; ++i) {
            _validateRecipient(items[i].to);
            if (items[i].amount == 0) revert ZeroAmount();
            total += items[i].amount;
        }
        if (total > type(uint96).max) revert TotalOverflow();
        id = _propose(Action.Payroll, abi.encode(items), uint96(total), expiresAt, memoRef);
        for (uint256 i; i < count; ++i) {
            _payroll[id].push(items[i]);
            emit PayrollItem(id, i, items[i].to, items[i].amount);
        }
    }

    /// @notice Proposes a full replacement governance configuration; historical epochs remain immutable.
    /// @param config Validated complete next-epoch configuration.
    /// @param expiresAt Proposal expiry timestamp.
    /// @param memoRef Opaque metadata reference.
    /// @return id Assigned sequential proposal identifier.
    function proposeGovernance(GovernancePayload calldata config, uint64 expiresAt, bytes32 memoRef)
        external nonReentrant returns (uint256 id) {
        _validateGovernance(config);
        id = _propose(Action.Governance, abi.encode(config), 0, expiresAt, memoRef);
        emit GovernanceItem(id, config.approvers, config.proposers, config.quorum, config.guardian,
            config.payrollDelay, config.configDelay);
    }

    /// @notice Proposes registration, disabling, or budget changes for a module.
    /// @dev Budget fields must be valid even when disabling. Disabling does not require the
    /// module to answer ERC-165, so a broken module can still be disabled.
    /// @param module Deployed module contract other than the core.
    /// @param enabled Whether module outflows should be enabled.
    /// @param perTxMax Positive maximum raw USDC per draw.
    /// @param windowMax Maximum raw USDC per window, at least perTxMax.
    /// @param windowLength Positive window length, at most 365 days.
    /// @param expiresAt Proposal expiry timestamp.
    /// @param memoRef Opaque metadata reference.
    /// @return id Assigned sequential proposal identifier.
    function proposeModuleConfig(address module, bool enabled, uint96 perTxMax, uint96 windowMax,
        uint32 windowLength, uint64 expiresAt, bytes32 memoRef) external nonReentrant returns (uint256 id) {
        ModuleConfigPayload memory config = ModuleConfigPayload(module, enabled, perTxMax, windowMax, windowLength);
        _validateModuleConfig(config);
        id = _propose(Action.ModuleConfig, abi.encode(config), 0, expiresAt, memoRef);
    }

    /// @notice Proposes a typed module action and optional prefunding from the same module budget.
    /// @param module Enabled, codehash-pinned target module.
    /// @param actionCode Module-specific action code.
    /// @param data Immutable callback data; the core does not interpret module-specific semantics.
    /// @param fundingAmount Optional prefunding, no larger than the current per-call limit.
    /// @param expiresAt Proposal expiry timestamp.
    /// @param memoRef Opaque metadata and funding reconciliation reference.
    /// @return id Assigned sequential proposal identifier.
    function proposeModuleAction(address module, uint8 actionCode, bytes calldata data, uint96 fundingAmount,
        uint64 expiresAt, bytes32 memoRef) external nonReentrant returns (uint256 id) {
        _checkModule(module);
        if (fundingAmount > modules[module].perTxMax) revert BudgetExceeded();
        ModuleActionPayload memory action = ModuleActionPayload(module, actionCode, data, fundingAmount);
        id = _propose(Action.ModuleAction, abi.encode(action), fundingAmount, expiresAt, memoRef);
    }

    /// @notice Proposes rescue of an accidentally received non-USDC ERC-20 token.
    /// @param token Deployed token contract, never USDC.
    /// @param to Nonzero rescue recipient.
    /// @param amount Positive raw token amount.
    /// @param expiresAt Proposal expiry timestamp.
    /// @param memoRef Opaque metadata reference.
    /// @return id Assigned sequential proposal identifier.
    function proposeRescue(address token, address to, uint256 amount, uint64 expiresAt, bytes32 memoRef)
        external nonReentrant returns (uint256 id) {
        RescuePayload memory rescue = RescuePayload(token, to, amount);
        _validateRescue(rescue);
        id = _propose(Action.Rescue, abi.encode(rescue), 0, expiresAt, memoRef);
    }

    /// @notice Proposes quorum-authorized unpause, only while currently paused.
    /// @dev Binds the current pauseCount into the stored payload and its hash; cannot undo a later pause.
    /// @param expiresAt Proposal expiry timestamp.
    /// @param memoRef Opaque metadata reference.
    /// @return id Assigned sequential proposal identifier.
    function proposeUnpause(uint64 expiresAt, bytes32 memoRef) external nonReentrant returns (uint256 id) {
        if (!paused) revert NotPaused();
        id = _propose(Action.Unpause, abi.encode(UnpausePayload(true, pauseCount)), 0, expiresAt, memoRef);
    }

    /// @notice Casts one immutable approval against the current, snapshotted epoch.
    /// @param id Pending, unexpired, unfenced proposal identifier.
    function approve(uint256 id) external nonReentrant {
        Proposal storage p = proposals[id];
        _validateVote(id, p);
        _recordVote(id, p, 1);
    }

    /// @notice Casts one immutable rejection, rejecting terminally when quorum is impossible.
    /// @param id Pending, unexpired, unfenced proposal identifier.
    function reject(uint256 id) external nonReentrant {
        Proposal storage p = proposals[id];
        _validateVote(id, p);
        _recordVote(id, p, 2);
    }

    /// @notice Cancels an own proposal, or an unprotected proposal as current guardian, even if fenced.
    /// @dev Guardian authority requires a nonzero current guardian matching the caller and
    /// cannot cancel Governance or Unpause. An independently authorized proposer may always
    /// cancel their own pending, unexpired proposal.
    /// @param id Pending, unexpired proposal identifier; quorum does not prevent cancellation.
    function cancel(uint256 id) external nonReentrant {
        Proposal storage p = proposals[id];
        _pendingUnexpired(id, p);
        if (msg.sender != p.proposer) {
            address currentGuardian = guardian();
            bool isGuardian = currentGuardian != address(0) && msg.sender == currentGuardian;
            if (!isGuardian || p.action == Action.Governance || p.action == Action.Unpause) {
                revert Unauthorized();
            }
        }
        p.status = Status.Cancelled;
        emit Cancelled(id, msg.sender);
    }

    /// @notice Permissionlessly executes exactly the stored payload, atomically and at most once.
    /// @dev Checks stored state, expiry, epoch fence, snapshot quorum, delay and pause in that order.
    /// Status is set before any interaction. Failure rolls back status, accounting and all transfers.
    /// Unpause requires the treasury still be paused with the payload's bound pauseCount.
    /// @param id Proposal identifier; callers supply no execution payload.
    function execute(uint256 id) external nonReentrant {
        Proposal storage p = proposals[id];
        _pendingUnexpired(id, p);
        if (p.epoch != currentEpoch) revert WrongEpoch(p.epoch, currentEpoch);
        if (p.approvals < p.quorum) revert QuorumNotReached(id, p.approvals, p.quorum);
        if (block.timestamp < p.executableAt) revert DelayNotElapsed(p.executableAt);
        if (p.action != Action.Governance && p.action != Action.Unpause) _requireNotPaused();
        p.status = Status.Executed;

        if (p.action == Action.Payroll) {
            _executePayroll(id, p.totalAmount);
        } else if (p.action == Action.Governance) {
            GovernancePayload memory config = abi.decode(_payload[id], (GovernancePayload));
            _validateGovernance(config);
            _createEpoch(config);
        } else if (p.action == Action.ModuleConfig) {
            _configureModule(abi.decode(_payload[id], (ModuleConfigPayload)));
        } else if (p.action == Action.ModuleAction) {
            _executeModuleAction(id, p.memoRef, abi.decode(_payload[id], (ModuleActionPayload)));
        } else if (p.action == Action.Rescue) {
            RescuePayload memory rescue = abi.decode(_payload[id], (RescuePayload));
            _validateRescue(rescue);
            IERC20(rescue.token).safeTransfer(rescue.to, rescue.amount);
            emit Rescued(id, rescue.token, rescue.to, rescue.amount);
        } else if (p.action == Action.Unpause) {
            UnpausePayload memory unpause = abi.decode(_payload[id], (UnpausePayload));
            if (!paused || unpause.pauseCount != pauseCount) {
                revert StalePauseUnpause(id, unpause.pauseCount, pauseCount);
            }
            paused = false;
            emit Unpaused(id);
        }
        emit Executed(id, p.action, p.totalAmount);
    }

    /// @notice Immediately stops protected executions and every module draw.
    /// @dev Only a nonzero current guardian matching the caller or a current approver.
    /// Each successful pause increments pauseCount with checked arithmetic; unpause requires
    /// a proposal bound to that count. A disabled guardian grants no authority.
    function pause() external nonReentrant {
        address currentGuardian = guardian();
        bool isGuardian = currentGuardian != address(0) && msg.sender == currentGuardian;
        if (!isApprover(msg.sender) && !isGuardian) revert Unauthorized();
        _requireNotPaused();
        paused = true;
        ++pauseCount;
        emit Paused(msg.sender);
    }

    /// @inheritdoc IAskirawaTreasury
    function payFromModule(address to, uint256 amount, bytes32 ref) external override nonReentrant {
        _requireNotPaused();
        _checkModule(msg.sender);
        _validateRecipient(to);
        _consumeBudget(msg.sender, amount);
        _transferUSDC(to, amount);
        emit ModulePaid(msg.sender, to, amount, ref);
    }

    /// @inheritdoc IAskirawaTreasury
    function fundModule(uint256 amount, bytes32 ref) external override nonReentrant {
        _requireNotPaused();
        _checkModule(msg.sender);
        _fundModule(msg.sender, amount, ref);
    }

    /// @notice Returns proposal metadata; nonexistent identifiers return a zero-valued struct.
    /// @param id Proposal identifier.
    /// @return proposal Stored metadata, including raw stored status.
    function getProposal(uint256 id) external view returns (Proposal memory proposal) { return proposals[id]; }

    /// @notice Reads a bounded payroll page; non-payroll IDs or out-of-range offsets return an empty array.
    /// @param id Proposal identifier.
    /// @param offset First item index.
    /// @param limit Maximum items to return; clamped to remaining items without addition overflow.
    /// @return page Stored payment items in their original order.
    function getPayroll(uint256 id, uint256 offset, uint256 limit) external view returns (Payment[] memory page) {
        uint256 length = _payroll[id].length;
        if (offset >= length) return new Payment[](0);
        uint256 count = length - offset;
        if (limit < count) count = limit;
        page = new Payment[](count);
        for (uint256 i; i < count; ++i) page[i] = _payroll[id][offset + i];
    }

    /// @notice Returns canonical ABI payload: Payment[] for Payroll; the named payload struct for other actions.
    /// @dev Payroll is encoded from its packed array, without storing a redundant bytes copy.
    /// @param id Proposal identifier; nonexistent identifiers return empty bytes.
    /// @return payload Exact bytes whose keccak256 is the proposal's payloadHash.
    function getPayload(uint256 id) external view returns (bytes memory payload) {
        if (proposals[id].action == Action.Payroll) {
            Payment[] memory items = _payroll[id];
            return abi.encode(items);
        }
        return _payload[id];
    }

    /// @notice Returns a complete historical epoch, including both role arrays.
    /// @param epoch Epoch identifier; nonexistent epochs return a zero-valued struct.
    /// @return config Immutable stored configuration.
    function getEpoch(uint256 epoch) external view returns (Epoch memory config) { return _epochs[epoch]; }

    /// @notice Returns the current epoch's approver list.
    /// @return accounts Current approvers.
    function approvers() external view returns (address[] memory accounts) { return _epochs[currentEpoch].approvers; }

    /// @notice Returns explicitly listed proposers; approvers can also propose without being listed here.
    /// @return accounts Current explicit proposers.
    function proposers() external view returns (address[] memory accounts) { return _epochs[currentEpoch].proposers; }

    /// @notice Returns the current epoch's approver count.
    /// @return count Current approver count.
    function approverCount() external view returns (uint256 count) { return _epochs[currentEpoch].approvers.length; }

    /// @notice Returns a historical epoch's approver count.
    /// @param epoch Epoch identifier.
    /// @return count Historical count, or zero for nonexistent epochs.
    function approverCount(uint256 epoch) external view returns (uint256 count) { return _epochs[epoch].approvers.length; }

    /// @inheritdoc IAskirawaTreasury
    function isApprover(address account) public view override returns (bool) { return isApproverAt(currentEpoch, account); }

    /// @notice Checks whether an account may propose under the current epoch (approver or proposer).
    /// @param account Address to check.
    /// @return authorized Whether either role bit is present.
    function isProposer(address account) public view returns (bool authorized) { return roleFlags[currentEpoch][account] != 0; }

    /// @notice Checks immutable historical approver membership.
    /// @param epoch Epoch identifier.
    /// @param account Address to check.
    /// @return authorized Whether the approver bit is set.
    function isApproverAt(uint256 epoch, address account) public view returns (bool authorized) {
        return (roleFlags[epoch][account] & 1) != 0;
    }

    /// @inheritdoc IAskirawaTreasury
    function guardian() public view override returns (address) { return _epochs[currentEpoch].guardian; }

    /// @notice Returns the current quorum.
    /// @return threshold Current approval threshold.
    function quorum() external view returns (uint8 threshold) { return _epochs[currentEpoch].quorum; }

    /// @notice Returns the current flat payroll/module-action/rescue delay in seconds.
    /// @return delay Current payout-class delay.
    function payrollDelay() external view returns (uint32 delay) { return _epochs[currentEpoch].payrollDelay; }

    /// @notice Returns the current flat governance/module-config/unpause delay in seconds.
    /// @return delay Current configuration-class delay.
    function configDelay() external view returns (uint32 delay) { return _epochs[currentEpoch].configDelay; }

    /// @notice Enumerates all voters in chronological order, including an auto-approving proposer.
    /// @param id Proposal identifier.
    /// @return accounts Voters; consult voteOf for each immutable choice.
    function voters(uint256 id) external view returns (address[] memory accounts) { return _voters[id]; }

    /// @notice Returns derived lifecycle state; pause deliberately does not change status.
    /// @param id Proposal identifier.
    /// @return derived Stored terminal state, else Expired, Fenced, Pending, Approved or Executable.
    function status(uint256 id) external view returns (ProposalStatus derived) {
        Proposal storage p = proposals[id];
        if (p.status == Status.None) return ProposalStatus.None;
        if (p.status == Status.Executed) return ProposalStatus.Executed;
        if (p.status == Status.Cancelled) return ProposalStatus.Cancelled;
        if (p.status == Status.Rejected) return ProposalStatus.Rejected;
        if (block.timestamp >= p.expiresAt) return ProposalStatus.Expired;
        if (p.epoch != currentEpoch) return ProposalStatus.Fenced;
        if (p.approvals < p.quorum) return ProposalStatus.Pending;
        if (block.timestamp < p.executableAt) return ProposalStatus.Approved;
        return ProposalStatus.Executable;
    }

    /// @inheritdoc IAskirawaTreasury
    function balance() public view override returns (uint256) { return usdc.balanceOf(address(this)); }

    /// @notice Returns remaining window budget, accounting for a rollover without mutating state.
    /// @dev This is the aggregate remaining window allowance, not the per-call maximum and not
    /// available USDC. Returns zero for disabled, missing-code or codehash-mismatched modules;
    /// pause does not alter the reported budget.
    /// @param module Module address.
    /// @return remaining Window allowance available before any new draw.
    function moduleSpendRemaining(address module) external view returns (uint256 remaining) {
        ModuleConfig storage config = modules[module];
        if (!config.enabled || module.code.length == 0 || module.codehash != config.codehash) return 0;
        if (block.timestamp >= uint256(config.windowStart) + config.windowLength) return config.windowMax;
        return uint256(config.windowMax) - config.windowSpent;
    }

    /// @dev Shared constructor/proposal/execution validator; cross-list role overlap is intentional.
    function _validateGovernance(GovernancePayload memory config) private view {
        uint256 count = config.approvers.length;
        if (count < MIN_QUORUM || count > MAX_APPROVERS || config.proposers.length > MAX_PROPOSERS) {
            revert InvalidRoleCount(count, config.proposers.length);
        }
        if (config.quorum < MIN_QUORUM || config.quorum > count) revert InvalidQuorum(config.quorum, count);
        if (config.payrollDelay > MAX_DELAY || config.configDelay > MAX_DELAY || config.configDelay < MIN_CONFIG_DELAY) {
            revert InvalidDelay(config.payrollDelay, config.configDelay);
        }
        if (config.guardian == address(this)) revert InvalidAddress(config.guardian);
        _validateRoleList(config.approvers);
        _validateRoleList(config.proposers);
    }

    /// @dev Bounded by at most fifty accounts; duplicates are rejected rather than deduplicated.
    function _validateRoleList(address[] memory accounts) private view {
        for (uint256 i; i < accounts.length; ++i) {
            _validateRecipient(accounts[i]);
            for (uint256 j; j < i; ++j) {
                if (accounts[j] == accounts[i]) revert DuplicateRole(accounts[i]);
            }
        }
    }

    /// @dev Writes only a fresh epoch; historical configuration and role bits are never changed.
    function _createEpoch(GovernancePayload memory config) private {
        uint256 epoch = currentEpoch + 1;
        if (epoch > type(uint64).max) revert SnapshotOverflow();
        Epoch storage next = _epochs[epoch];
        next.quorum = config.quorum;
        next.payrollDelay = config.payrollDelay;
        next.configDelay = config.configDelay;
        next.guardian = config.guardian;
        next.approvers = config.approvers;
        next.proposers = config.proposers;
        next.createdAt = _time64(block.timestamp);
        for (uint256 i; i < config.approvers.length; ++i) roleFlags[epoch][config.approvers[i]] |= 1;
        for (uint256 i; i < config.proposers.length; ++i) roleFlags[epoch][config.proposers[i]] |= 2;
        currentEpoch = epoch;
        emit EpochCreated(epoch, config.quorum, config.payrollDelay, config.configDelay, config.guardian);
    }

    /// @dev Creates a snapshot, canonical payload hash and optional proposer approval.
    function _propose(Action action, bytes memory payload, uint96 total, uint64 expiresAt, bytes32 memoRef)
        private returns (uint256 id) {
        if (!isProposer(msg.sender)) revert NotProposer();
        uint256 delay = _delay(action, currentEpoch);
        if (expiresAt < block.timestamp + delay + MIN_EXECUTION_WINDOW ||
            expiresAt > block.timestamp + MAX_PROPOSAL_LIFETIME) revert InvalidExpiry(expiresAt);
        id = nextProposalId++;
        Proposal storage p = proposals[id];
        p.action = action;
        p.status = Status.Pending;
        p.epoch = uint64(currentEpoch);
        p.quorum = _epochs[currentEpoch].quorum;
        p.proposer = msg.sender;
        p.createdAt = _time64(block.timestamp);
        p.expiresAt = expiresAt;
        p.totalAmount = total;
        p.payloadHash = keccak256(payload);
        p.memoRef = memoRef;
        if (action != Action.Payroll) _payload[id] = payload;
        emit Proposed(id, currentEpoch, msg.sender, action, total, expiresAt, p.payloadHash, memoRef);
        if (isApproverAt(p.epoch, msg.sender)) _recordVote(id, p, 1);
    }

    /// @dev Uses the immutable proposal epoch for both membership and delay.
    function _validateVote(uint256 id, Proposal storage p) private view {
        _pendingUnexpired(id, p);
        if (p.epoch != currentEpoch) revert WrongEpoch(p.epoch, currentEpoch);
        if (!isApproverAt(p.epoch, msg.sender)) revert NotApprover();
        if (voteOf[id][msg.sender] != 0) revert AlreadyVoted(id, msg.sender);
    }

    /// @dev Callers establish eligibility and uniqueness; auto-approval is only on a fresh ID.
    function _recordVote(uint256 id, Proposal storage p, uint8 choice) private {
        voteOf[id][msg.sender] = choice;
        _voters[id].push(msg.sender);
        if (choice == 1) ++p.approvals;
        else ++p.rejections;
        emit Voted(id, msg.sender, choice, p.approvals, p.rejections);
        if (choice == 1 && p.approvals == p.quorum) {
            p.approvedAt = _time64(block.timestamp);
            p.executableAt = _time64(block.timestamp + _delay(p.action, p.epoch));
            emit QuorumReached(id, p.approvedAt, p.executableAt);
        } else if (choice == 2 && p.rejections > _epochs[p.epoch].approvers.length - p.quorum) {
            p.status = Status.Rejected;
            emit Rejected(id);
        }
    }

    /// @dev Stored terminal-state and exact expiry-boundary checks shared by mutators.
    function _pendingUnexpired(uint256 id, Proposal storage p) private view {
        if (p.status != Status.Pending) revert NotPending(id);
        if (block.timestamp >= p.expiresAt) revert Expired(id);
    }

    /// @dev All delays are flat, retrieved from an immutable epoch rather than today's parameters.
    function _delay(Action action, uint256 epoch) private view returns (uint32) {
        if (action == Action.Governance || action == Action.ModuleConfig || action == Action.Unpause) {
            return _epochs[epoch].configDelay;
        }
        return _epochs[epoch].payrollDelay;
    }

    /// @dev Exact stored payroll only; both sum and aggregate debit are explicitly checked.
    function _executePayroll(uint256 id, uint96 totalAmount) private {
        Payment[] storage items = _payroll[id];
        uint256 total;
        for (uint256 i; i < items.length; ++i) total += items[i].amount;
        if (total != totalAmount) revert PayloadMismatch(id);
        uint256 beforeBalance = balance();
        if (beforeBalance < total) revert InsufficientBalance(beforeBalance, total);
        for (uint256 i; i < items.length; ++i) {
            usdc.safeTransfer(items[i].to, items[i].amount);
            emit PaymentSent(id, i, items[i].to, items[i].amount);
        }
        _assertDebit(beforeBalance, total);
    }

    /// @dev Checks budget shape on enable/disable; introspection only when enabling.
    function _validateModuleConfig(ModuleConfigPayload memory config) private view {
        _validateRecipient(config.module);
        if (config.module.code.length == 0) revert NoCode(config.module);
        if (config.perTxMax == 0 || config.perTxMax > config.windowMax ||
            config.windowLength == 0 || config.windowLength > MAX_WINDOW_LENGTH) revert InvalidBudget();
        if (config.enabled) {
            if (!_supportsInterface(config.module, type(IERC165).interfaceId) ||
                _supportsInterface(config.module, bytes4(0xffffffff)) ||
                !_supportsInterface(config.module, type(ITreasuryModule).interfaceId)) revert InvalidModule(config.module);
            try ITreasuryModule(config.module).treasury() returns (address core) {
                if (core != address(this)) revert InvalidModule(config.module);
            } catch { revert InvalidModule(config.module); }
        }
    }

    /// @dev ERC-165 introspection is gas-bounded and rejects reverts or malformed return values.
    function _supportsInterface(address module, bytes4 interfaceId) private view returns (bool) {
        try IERC165(module).supportsInterface{gas: 30000}(interfaceId) returns (bool supported) {
            return supported;
        } catch { return false; }
    }

    /// @dev Budget updates never give a free fresh window. For an existing registration,
    /// roll under the OLD duration if due, then preserve its start/spend while applying
    /// new limits. A new windowMax below retained spend reverts. Re-enable retains usage.
    /// Changing the duration is an explicit quorum-approved change, not a sliding window.
    function _configureModule(ModuleConfigPayload memory config) private {
        _validateModuleConfig(config);
        ModuleConfig storage stored = modules[config.module];
        if (stored.windowLength == 0) stored.windowStart = _time64(block.timestamp);
        else _rollWindow(stored);
        if (config.windowMax < stored.windowSpent) revert BudgetExceeded();
        stored.enabled = config.enabled;
        if (config.enabled) stored.codehash = config.module.codehash;
        stored.perTxMax = config.perTxMax;
        stored.windowMax = config.windowMax;
        stored.windowLength = config.windowLength;
        emit ModuleConfigured(config.module, config.enabled, stored.codehash, config.perTxMax, config.windowMax, config.windowLength);
    }

    /// @dev Checks the pin even for zero-funding callbacks, which otherwise would not draw.
    function _executeModuleAction(uint256 id, bytes32 ref, ModuleActionPayload memory action) private {
        _checkModule(action.module);
        if (action.fundingAmount > 0) _fundModule(action.module, action.fundingAmount, ref);
        try ITreasuryModule(action.module).onApproved(id, action.actionCode, action.data) {
            // No callback return value is defined by ITreasuryModule.
        } catch (bytes memory reason) { revert ModuleCallbackFailed(id, reason); }
        _checkModule(action.module);
    }

    /// @dev Shared funding path, called only under the external reentrancy lock and after pin/pause checks.
    function _fundModule(address module, uint256 amount, bytes32 ref) private {
        _consumeBudget(module, amount);
        _transferUSDC(module, amount);
        emit ModuleFunded(module, amount, ref);
    }

    /// @dev Called before any draw interaction, with enabled/pin validation already performed.
    function _consumeBudget(address module, uint256 amount) private {
        ModuleConfig storage config = modules[module];
        if (amount == 0) revert ZeroAmount();
        if (amount > config.perTxMax) revert BudgetExceeded();
        _rollWindow(config);
        uint256 spent = uint256(config.windowSpent) + amount;
        if (spent > config.windowMax) revert BudgetExceeded();
        config.windowSpent = uint96(spent);
    }

    /// @dev Fixed window: first draw at/after expiry anchors a new window to the current timestamp.
    function _rollWindow(ModuleConfig storage config) private {
        if (block.timestamp >= uint256(config.windowStart) + config.windowLength) {
            config.windowStart = _time64(block.timestamp);
            config.windowSpent = 0;
        }
    }

    /// @dev Runtime pin validation applies equally to direct draws and approved module actions.
    function _checkModule(address module) private view {
        if (!modules[module].enabled) revert ModuleDisabled(module);
        if (module.code.length == 0 || module.codehash != modules[module].codehash) revert ModuleCodeChanged(module);
    }

    /// @dev USDC outflows are balance-checked and must debit exactly the requested amount.
    function _transferUSDC(address to, uint256 amount) private {
        uint256 beforeBalance = balance();
        if (beforeBalance < amount) revert InsufficientBalance(beforeBalance, amount);
        usdc.safeTransfer(to, amount);
        _assertDebit(beforeBalance, amount);
    }

    /// @dev Custom error instead of arithmetic underflow if an unexpected token increases balance.
    function _assertDebit(uint256 beforeBalance, uint256 amount) private view {
        uint256 afterBalance = balance();
        if (afterBalance > beforeBalance || beforeBalance - afterBalance != amount) {
            revert BalanceDeltaMismatch(beforeBalance, afterBalance, amount);
        }
    }

    /// @dev Rescue never touches USDC and cannot target a nonexistent token contract.
    function _validateRescue(RescuePayload memory rescue) private view {
        if (rescue.token == address(usdc)) revert CannotRescueUSDC();
        if (rescue.token.code.length == 0) revert NoCode(rescue.token);
        if (rescue.to == address(0)) revert InvalidAddress(rescue.to);
        if (rescue.amount == 0) revert ZeroAmount();
    }

    /// @dev Shared recipient/role guard; guardian zero is handled separately and intentionally permitted.
    function _validateRecipient(address account) private view {
        if (account == address(0) || account == address(this)) revert InvalidAddress(account);
    }

    /// @dev Pause does not block proposal lifecycle mutations, deposits or governance/unpause execution.
    function _requireNotPaused() private view { if (paused) revert TreasuryPaused(); }

    /// @dev Explicit checked narrowing for all stored timestamps.
    function _time64(uint256 timestamp) private pure returns (uint64) {
        if (timestamp > type(uint64).max) revert SnapshotOverflow();
        return uint64(timestamp);
    }
}
