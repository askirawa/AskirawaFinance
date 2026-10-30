// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AskirawaTreasury} from "./AskirawaTreasury.sol";
import {ITreasuryRecovery} from "./interfaces/ITreasuryRecovery.sol";

/**
 * @title TreasuryRecovery
 * @notice UNAUDITED immutable recovery council for one AskirawaTreasury (design B-c built on B-a).
 * @dev If the treasury's approvers lose their keys, a council can install a replacement GOVERNANCE configuration,
 * and nothing else. The council never touches funds: this contract has no token logic and the treasury exposes it
 * only `installRecovery`, which creates a new governance epoch and starts a spending cooling period.
 *
 * Rules, all enforced by this code and (for the inactivity gate and cooling) again by the treasury:
 *  - Recovery may start only after INACTIVITY_PERIOD (30 days) with no executed treasury proposal, executed
 *    recovery, or recovery veto.
 *  - A council member initiates; the initiator's approval counts. `councilThreshold` approvals (2 of 3) start a
 *    RECOVERY_DELAY (14 days) timelock.
 *  - During voting and the timelock, the treasury's CURRENT approvers can veto with the normal treasury quorum
 *    (snapshotted at initiation). A veto kills the recovery and restarts the inactivity clock.
 *  - Any executed treasury proposal after initiation, or a change of governance epoch, voids the recovery.
 *  - One live recovery at a time. Executing or vetoing restarts the 30 day clock, so recoveries cannot be chained.
 *  - Execution installs the replacement approvers, quorum, proposers, guardian, delays and council, starts a new
 *    epoch (voiding all pending proposals) and a 7 day cooling period blocking payroll and module draws.
 * Council members are never approvers or the guardian of the configuration they are bound to or install.
 * There is no owner, no admin and no upgrade path. Not independently audited.
 */
contract TreasuryRecovery is ITreasuryRecovery, ReentrancyGuard {
    /// @notice Quiet period required before a recovery may start.
    uint64 public constant INACTIVITY_PERIOD = 30 days;
    /// @notice Delay between the council threshold being reached and execution.
    uint64 public constant RECOVERY_DELAY = 14 days;
    /// @notice Time the council has to reach its threshold after a recovery is initiated.
    uint64 public constant VOTING_WINDOW = 7 days;
    /// @notice Time after the delay during which an approved recovery can still be executed.
    uint64 public constant EXECUTION_WINDOW = 14 days;
    /// @notice Smallest council approval threshold.
    uint8 public constant MIN_THRESHOLD = 2;
    /// @notice Largest council.
    uint256 public constant MAX_COUNCIL = 7;

    /// @notice Lifecycle of a recovery; Executed, Vetoed, Cancelled and Expired are terminal.
    enum Status { None, Voting, Timelocked, Executed, Vetoed, Cancelled, Expired }

    /// @notice Metadata of one recovery. The replacement configuration is kept as bytes with a stored hash.
    struct Recovery {
        Status status;
        uint64 epoch;
        uint8 vetoQuorum;
        address initiator;
        uint64 initiatedAt;
        uint64 approvedAt;
        uint64 executableAt;
        uint64 expiresAt;
        uint16 approvals;
        uint16 vetoes;
        bytes32 payloadHash;
    }

    /// @notice The treasury this contract serves; set once by the treasury's constructor.
    AskirawaTreasury public treasury;
    /// @notice Approvals needed from the council.
    uint8 public councilThreshold;
    /// @notice True for current council members.
    mapping(address => bool) public isCouncilMember;
    /// @notice Time of the last recovery veto; combined with the treasury's own activity time to gate recovery.
    uint64 public lastResetAt;
    /// @notice Next sequential recovery identifier; starts at one.
    uint256 public nextRecoveryId = 1;
    /// @notice The single live recovery, or zero.
    uint256 public activeRecoveryId;
    mapping(uint256 => Recovery) public recoveries;
    mapping(uint256 => mapping(address => bool)) public councilVoted;
    mapping(uint256 => mapping(address => bool)) public vetoVoted;

    address[] private _council;
    mapping(uint256 => bytes) private _payload;

    /// @notice The treasury was bound; recovery is now possible once the inactivity gate opens.
    event TreasuryBound(address indexed treasury);
    /// @notice A council member started a recovery; their approval is counted.
    event RecoveryInitiated(uint256 indexed recoveryId, address indexed initiator, uint256 indexed epoch,
        bytes32 payloadHash, uint64 votingEndsAt);
    /// @notice The complete replacement configuration of a recovery, for monitoring.
    event RecoveryConfigItem(uint256 indexed recoveryId, address[] approvers, address[] proposers, uint8 quorum,
        address guardian, uint32 payrollDelay, uint32 configDelay, address[] council, uint8 councilThreshold);
    /// @notice A council member approved a recovery.
    event RecoveryCouncilVoted(uint256 indexed recoveryId, address indexed member, uint16 approvals, uint8 threshold);
    /// @notice The council threshold was reached; the recovery timelock started.
    event RecoveryQuorumReached(uint256 indexed recoveryId, uint64 approvedAt, uint64 executableAt, uint64 expiresAt);
    /// @notice A current approver voted to veto.
    event RecoveryVetoVoted(uint256 indexed recoveryId, address indexed approver, uint16 vetoes, uint8 vetoQuorum);
    /// @notice The approvers' veto quorum was reached; the recovery is dead and the inactivity clock restarted.
    event RecoveryVetoed(uint256 indexed recoveryId);
    /// @notice The initiator withdrew a recovery that was still collecting council votes.
    event RecoveryCancelled(uint256 indexed recoveryId, address indexed by);
    /// @notice A recovery became unusable: 1 time ran out, 2 governance epoch changed, 3 a proposal executed.
    event RecoveryExpired(uint256 indexed recoveryId, uint8 reason);
    /// @notice A recovery installed a replacement governance configuration and council.
    event RecoveryExecuted(uint256 indexed recoveryId, uint256 indexed newEpoch, uint64 coolingEnd);

    /// @notice The treasury is already bound.
    error AlreadyBound();
    /// @notice No treasury is bound yet.
    error NotBound();
    /// @notice Caller is not a council member.
    error NotCouncilMember();
    /// @notice Caller is not an approver in the recovery's epoch.
    error NotApprover();
    /// @notice Council size or threshold is outside its bounds.
    error InvalidCouncil(uint256 members, uint8 threshold);
    /// @notice A council address is zero or this contract or the treasury.
    error InvalidAddress(address account);
    /// @notice A council address appears twice.
    error DuplicateMember(address account);
    /// @notice A council member is also an approver or the guardian of the configuration.
    error CouncilRoleConflict(address account);
    /// @notice Recovery is not yet allowed.
    error InactivityNotMet(uint64 eligibleAt);
    /// @notice Another recovery is still live.
    error RecoveryInProgress(uint256 recoveryId);
    /// @notice The recovery is not in the state this call needs.
    error WrongState(uint256 recoveryId, Status status);
    /// @notice The account already voted on this recovery.
    error AlreadyVoted(uint256 recoveryId, address account);
    /// @notice The recovery is unusable: 1 time, 2 epoch changed, 3 a proposal executed since initiation.
    error RecoveryStale(uint256 recoveryId, uint8 reason);
    /// @notice The recovery is still usable, so it cannot be expired.
    error RecoveryNotStale(uint256 recoveryId);
    /// @notice The recovery timelock has not elapsed.
    error DelayNotElapsed(uint64 executableAt);
    /// @notice Only the initiator may do this.
    error Unauthorized();

    /**
     * @param council_ Council members, unique and nonzero. Their independence from the approvers and guardian is
     * checked when the treasury binds.
     * @param threshold_ Approvals needed, at least two and at most council size minus one.
     */
    constructor(address[] memory council_, uint8 threshold_) {
        _checkCouncilShape(council_, threshold_);
        for (uint256 i; i < council_.length; ++i) {
            isCouncilMember[council_[i]] = true;
            _council.push(council_[i]);
        }
        councilThreshold = threshold_;
    }

    /// @inheritdoc ITreasuryRecovery
    function bindTreasury(address[] calldata approvers, address guardian) external override {
        if (address(treasury) != address(0)) revert AlreadyBound();
        for (uint256 i; i < _council.length; ++i) {
            address m = _council[i];
            if (m == msg.sender) revert InvalidAddress(m);
            if (m == guardian) revert CouncilRoleConflict(m);
            for (uint256 j; j < approvers.length; ++j) if (approvers[j] == m) revert CouncilRoleConflict(m);
        }
        treasury = AskirawaTreasury(msg.sender);
        emit TreasuryBound(msg.sender);
    }

    // ------------------------------------------------------------------------------------------ council actions

    /// @notice Starts a recovery with a complete replacement governance configuration and council.
    /// @dev Council members only; only when the inactivity gate is open; one live recovery at a time.
    /// @param config Replacement governance configuration, validated now and again at execution.
    /// @param newCouncil Replacement council (never overlapping the new approvers or guardian).
    /// @param newThreshold Replacement council threshold.
    /// @return id Sequential recovery identifier.
    function initiateRecovery(AskirawaTreasury.GovernancePayload calldata config, address[] calldata newCouncil,
        uint8 newThreshold) external nonReentrant returns (uint256 id) {
        AskirawaTreasury t = _treasury();
        if (!isCouncilMember[msg.sender]) revert NotCouncilMember();
        uint64 eligibleAt = recoveryEligibleAt();
        if (block.timestamp < eligibleAt) revert InactivityNotMet(eligibleAt);
        if (activeRecoveryId != 0 && !_expireIfStale(activeRecoveryId)) revert RecoveryInProgress(activeRecoveryId);
        _validate(t, config, newCouncil, newThreshold);
        id = nextRecoveryId++;
        bytes memory payload = abi.encode(config, newCouncil, newThreshold);
        Recovery storage r = recoveries[id];
        r.status = Status.Voting;
        r.epoch = uint64(t.currentEpoch());
        r.vetoQuorum = t.quorum();
        r.initiator = msg.sender;
        r.initiatedAt = uint64(block.timestamp);
        r.payloadHash = keccak256(payload);
        _payload[id] = payload;
        activeRecoveryId = id;
        emit RecoveryInitiated(id, msg.sender, r.epoch, r.payloadHash, r.initiatedAt + VOTING_WINDOW);
        emit RecoveryConfigItem(id, config.approvers, config.proposers, config.quorum, config.guardian,
            config.payrollDelay, config.configDelay, newCouncil, newThreshold);
        _castCouncilVote(id, r);
    }

    /// @notice Council approval of a recovery that is still collecting votes. Reaching the threshold starts the timelock.
    /// @param id Recovery identifier.
    function approveRecovery(uint256 id) external nonReentrant {
        AskirawaTreasury t = _treasury();
        Recovery storage r = recoveries[id];
        if (!isCouncilMember[msg.sender]) revert NotCouncilMember();
        if (r.status != Status.Voting) revert WrongState(id, r.status);
        _requireLive(t, id, r);
        _castCouncilVote(id, r);
    }

    /// @notice A current approver votes to veto. The normal treasury quorum, snapshotted at initiation, kills it.
    /// @dev Works while voting and during the timelock. A successful veto restarts the inactivity clock.
    /// @param id Recovery identifier.
    function vetoRecovery(uint256 id) external nonReentrant {
        AskirawaTreasury t = _treasury();
        Recovery storage r = recoveries[id];
        if (r.status != Status.Voting && r.status != Status.Timelocked) revert WrongState(id, r.status);
        _requireLive(t, id, r);
        if (!t.isApproverAt(r.epoch, msg.sender)) revert NotApprover();
        if (vetoVoted[id][msg.sender]) revert AlreadyVoted(id, msg.sender);
        vetoVoted[id][msg.sender] = true;
        ++r.vetoes;
        emit RecoveryVetoVoted(id, msg.sender, r.vetoes, r.vetoQuorum);
        if (r.vetoes >= r.vetoQuorum) {
            r.status = Status.Vetoed;
            activeRecoveryId = 0;
            lastResetAt = uint64(block.timestamp);
            emit RecoveryVetoed(id);
        }
    }

    /// @notice The initiator withdraws a recovery that is still collecting council votes.
    /// @param id Recovery identifier.
    function cancelRecovery(uint256 id) external nonReentrant {
        Recovery storage r = recoveries[id];
        if (r.status != Status.Voting) revert WrongState(id, r.status);
        if (msg.sender != r.initiator) revert Unauthorized();
        r.status = Status.Cancelled;
        activeRecoveryId = 0;
        emit RecoveryCancelled(id, msg.sender);
    }

    /// @notice Anyone can clear the live recovery once it can no longer succeed, freeing the single recovery slot.
    /// @param id Recovery identifier; must be the live recovery.
    function expireRecovery(uint256 id) external nonReentrant {
        _treasury();
        if (id == 0 || id != activeRecoveryId || !_expireIfStale(id)) revert RecoveryNotStale(id);
    }

    /// @notice After the timelock, installs the replacement governance configuration. Callable by anyone.
    /// @dev Revalidates everything. The treasury starts a new epoch, voids pending proposals and begins cooling.
    /// @param id Recovery identifier.
    function executeRecovery(uint256 id) external nonReentrant {
        AskirawaTreasury t = _treasury();
        Recovery storage r = recoveries[id];
        if (r.status != Status.Timelocked) revert WrongState(id, r.status);
        _requireLive(t, id, r);
        if (block.timestamp < r.executableAt) revert DelayNotElapsed(r.executableAt);
        (AskirawaTreasury.GovernancePayload memory config, address[] memory council, uint8 threshold) =
            abi.decode(_payload[id], (AskirawaTreasury.GovernancePayload, address[], uint8));
        _validate(t, config, council, threshold);
        r.status = Status.Executed;
        activeRecoveryId = 0;
        _setCouncil(council, threshold);
        t.installRecovery(config);
        emit RecoveryExecuted(id, t.currentEpoch(), t.coolingEnd());
    }

    // ------------------------------------------------------------------------------------------ views

    /// @notice Earliest time a new recovery may be initiated: 30 days after the last proposal execution, recovery or veto.
    /// @return eligibleAt Timestamp; before it, `initiateRecovery` reverts.
    function recoveryEligibleAt() public view returns (uint64 eligibleAt) {
        uint64 a = _treasury().lastActivityAt();
        return (a > lastResetAt ? a : lastResetAt) + INACTIVITY_PERIOD;
    }

    /// @notice Current council.
    /// @return members Council member addresses.
    function councilMembers() external view returns (address[] memory members) { return _council; }

    /// @notice ABI-encoded (GovernancePayload, address[] council, uint8 threshold) of a recovery.
    /// @param id Recovery identifier.
    /// @return payload Bytes whose keccak256 is the stored payloadHash.
    function getRecoveryPayload(uint256 id) external view returns (bytes memory payload) { return _payload[id]; }

    // ------------------------------------------------------------------------------------------ internals

    function _treasury() private view returns (AskirawaTreasury t) {
        t = treasury;
        if (address(t) == address(0)) revert NotBound();
    }

    function _castCouncilVote(uint256 id, Recovery storage r) private {
        if (councilVoted[id][msg.sender]) revert AlreadyVoted(id, msg.sender);
        councilVoted[id][msg.sender] = true;
        ++r.approvals;
        emit RecoveryCouncilVoted(id, msg.sender, r.approvals, councilThreshold);
        if (r.approvals >= councilThreshold) {
            r.status = Status.Timelocked;
            r.approvedAt = uint64(block.timestamp);
            r.executableAt = uint64(block.timestamp) + RECOVERY_DELAY;
            r.expiresAt = r.executableAt + EXECUTION_WINDOW;
            emit RecoveryQuorumReached(id, r.approvedAt, r.executableAt, r.expiresAt);
        }
    }

    /// @dev Zero when usable. 1 time ran out, 2 governance epoch changed, 3 a proposal executed since initiation.
    function _staleReason(AskirawaTreasury t, Recovery storage r) private view returns (uint8) {
        if (r.epoch != t.currentEpoch()) return 2;
        if (t.lastActivityAt() > r.initiatedAt) return 3;
        uint256 deadline = r.status == Status.Voting ? uint256(r.initiatedAt) + VOTING_WINDOW : r.expiresAt;
        return block.timestamp >= deadline ? 1 : 0;
    }

    function _requireLive(AskirawaTreasury t, uint256 id, Recovery storage r) private view {
        uint8 reason = _staleReason(t, r);
        if (reason != 0) revert RecoveryStale(id, reason);
    }

    function _expireIfStale(uint256 id) private returns (bool) {
        Recovery storage r = recoveries[id];
        uint8 reason = _staleReason(treasury, r);
        if (reason == 0) return false;
        r.status = Status.Expired;
        activeRecoveryId = 0;
        emit RecoveryExpired(id, reason);
        return true;
    }

    /// @dev The treasury validates the governance configuration; this contract validates the council against it.
    function _validate(AskirawaTreasury t, AskirawaTreasury.GovernancePayload memory config, address[] memory council,
        uint8 threshold) private view {
        t.validateGovernance(config);
        _checkCouncilShape(council, threshold);
        for (uint256 i; i < council.length; ++i) {
            address m = council[i];
            if (m == address(t) || m == address(this)) revert InvalidAddress(m);
            if (m == config.guardian) revert CouncilRoleConflict(m);
            for (uint256 k; k < config.approvers.length; ++k) if (config.approvers[k] == m) revert CouncilRoleConflict(m);
        }
    }

    function _checkCouncilShape(address[] memory council, uint8 threshold) private pure {
        uint256 n = council.length;
        if (threshold < MIN_THRESHOLD || n <= threshold || n > MAX_COUNCIL) revert InvalidCouncil(n, threshold);
        for (uint256 i; i < n; ++i) {
            if (council[i] == address(0)) revert InvalidAddress(council[i]);
            for (uint256 j; j < i; ++j) if (council[j] == council[i]) revert DuplicateMember(council[i]);
        }
    }

    function _setCouncil(address[] memory council, uint8 threshold) private {
        for (uint256 i; i < _council.length; ++i) isCouncilMember[_council[i]] = false;
        delete _council;
        for (uint256 i; i < council.length; ++i) {
            isCouncilMember[council[i]] = true;
            _council.push(council[i]);
        }
        councilThreshold = threshold;
    }
}
