// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITreasuryModule} from "./interfaces/ITreasuryModule.sol";
import {IAskirawaTreasury} from "./interfaces/IAskirawaTreasury.sol";
import {IRecurringPaymentModule} from "./interfaces/IRecurringPaymentModule.sol";
import {ScheduleMath} from "./libraries/ScheduleMath.sol";

/// @title IRecurringTreasuryBudget
/// @notice Local ABI projection of the core's existing public modules mapping and relevant errors.
interface IRecurringTreasuryBudget {
    /// @notice Returns registration and budget fields in the exact order used by the core.
    /// @param module Registered module address.
    /// @return enabled Whether enabled.
    /// @return codehash Pinned runtime hash.
    /// @return perTxMax Per-call raw USDC limit.
    /// @return windowMax Per-window raw USDC limit.
    /// @return windowLength Window duration in seconds.
    /// @return windowStart Current stored window anchor.
    /// @return windowSpent Current stored window spend.
    function modules(address module) external view returns (bool enabled, bytes32 codehash,
        uint96 perTxMax, uint96 windowMax, uint32 windowLength, uint64 windowStart, uint96 windowSpent);
    /// @notice Core outflows are paused.
    error TreasuryPaused();
    /// @notice Core per-call or window budget is exhausted.
    error BudgetExceeded();
    /// @notice Treasury token balance is insufficient.
    error InsufficientBalance(uint256 have, uint256 need);
    /// @notice Token failed exact-debit accounting.
    error BalanceDeltaMismatch(uint256 beforeBalance, uint256 afterBalance, uint256 expected);
}

/**
 * @title RecurringPaymentModule
 * @notice UNAUDITED immutable Treasury v2 recurring payments and automation rules.
 * @dev The legacy Automation Registry is never called. No owner, upgrade path or recovery policy.
 * Quorum authorization is exclusively the core's responsibility. Creation/resume callbacks do not draw funds.
 * Every mutation uses OpenZeppelin's STORAGE reentrancy guard, compatible with the Paris EVM.
 * Only execute draws funds, exclusively via the core's codehash-pinned, budget-limited payFromModule.
 * executedCount counts successful payments; a separate skippedPeriods mapping advances calendar indices.
 * All dates are UTC. End time constrains due dates, not actual late execution times, as specified in Part 2.
 */
contract RecurringPaymentModule is IRecurringPaymentModule, ReentrancyGuard {
    /// @notice Approved action code for abi.encode(ScheduleParams).
    uint8 public constant CREATE_SCHEDULE = 1;
    /// @notice Approved action code for abi.encode(uint256 scheduleId, bool skipMissed).
    uint8 public constant RESUME_SCHEDULE = 2;
    /// @notice Maximum outstanding periods allowed before protective auto-pause.
    uint8 public constant MAX_BACKLOG = 3;
    /// @inheritdoc ITreasuryModule
    address public immutable override treasury;
    /// @inheritdoc IRecurringPaymentModule
    uint32 public immutable override retryDelay;
    /// @inheritdoc IRecurringPaymentModule
    uint8 public immutable override maxFailures;
    /// @notice Next assigned schedule identifier; ids start at one and are never reused.
    uint256 public nextScheduleId = 1;
    /// @notice Specified schedule struct layout; getSchedule returns the complete struct.
    mapping(uint256 => Schedule) public schedules;
    /// @inheritdoc IRecurringPaymentModule
    mapping(uint256 => uint256) public override skippedPeriods;

    /**
     * @notice Binds this module to an existing treasury without assigning deployer privileges.
     * @param treasury_ Deployed treasury core.
     * @param retryDelay_ Retry interval in [1 hour, 7 days].
     * @param maxFailures_ Consecutive-failure auto-pause threshold in [1,10].
     */
    constructor(address treasury_, uint32 retryDelay_, uint8 maxFailures_) {
        if (treasury_.code.length == 0) revert InvalidTreasury();
        if (retryDelay_ < 1 hours || retryDelay_ > 7 days || maxFailures_ == 0 || maxFailures_ > 10) {
            revert InvalidRetryConfiguration();
        }
        treasury = treasury_;
        retryDelay = retryDelay_;
        maxFailures = maxFailures_;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(ITreasuryModule).interfaceId
            || interfaceId == type(IRecurringPaymentModule).interfaceId;
    }

    /// @inheritdoc ITreasuryModule
    function onApproved(uint256 proposalId, uint8 actionCode, bytes calldata data) external override nonReentrant {
        if (msg.sender != treasury) revert OnlyTreasury();
        if (actionCode == CREATE_SCHEDULE) {
            _create(proposalId, abi.decode(data, (ScheduleParams)));
        } else if (actionCode == RESUME_SCHEDULE) {
            (uint256 id, bool skipMissed) = abi.decode(data, (uint256, bool));
            _resume(id, skipMissed);
        } else {
            revert UnknownAction(actionCode);
        }
    }

    /// @inheritdoc IRecurringPaymentModule
    function pause(uint256 id) external override nonReentrant {
        _requireStoppingAuthority();
        Schedule storage s = _known(id);
        if (s.status != ScheduleStatus.Active) revert InvalidStatus(id, s.status);
        s.status = ScheduleStatus.Paused;
        emit SchedulePaused(id, msg.sender);
    }

    /// @inheritdoc IRecurringPaymentModule
    function cancel(uint256 id) external override nonReentrant {
        _requireStoppingAuthority();
        Schedule storage s = _known(id);
        if (s.status != ScheduleStatus.Active && s.status != ScheduleStatus.Paused) revert InvalidStatus(id, s.status);
        s.status = ScheduleStatus.Cancelled;
        emit ScheduleCancelled(id, msg.sender);
    }

    /// @inheritdoc IRecurringPaymentModule
    function execute(uint256 id) external override nonReentrant {
        Schedule storage s = _known(id);
        if (s.status != ScheduleStatus.Active) revert InvalidStatus(id, s.status);
        if (block.timestamp < s.nextDue) revert NotDue(s.nextDue);
        if (block.timestamp < s.nextRetryAt) revert RetryNotReady(s.nextRetryAt);
        if (!_allowed(s, msg.sender)) revert Unauthorized();
        if (_limitsReached(s)) {
            _complete(id, s);
            return;
        }
        uint256 period = uint256(s.executedCount) + skippedPeriods[id];
        uint256 lastPeriod = ScheduleMath.maxPeriod(s.startTime, s.frequency);
        // A nonexistent period beyond the calendar horizon is never treated as overdue.
        if (period + MAX_BACKLOG <= lastPeriod &&
            ScheduleMath.add(s.startTime, s.frequency, period + MAX_BACKLOG) <= block.timestamp) {
            s.status = ScheduleStatus.Paused;
            emit ScheduleAutoPaused(id, AutoPauseReason.BACKLOG);
            return;
        }
        if (s.minTreasuryBalanceAfter != 0) {
            try IAskirawaTreasury(treasury).balance() returns (uint256 balance) {
                if (balance < uint256(s.amount) + s.minTreasuryBalanceAfter) {
                    _fail(id, s, period, FailureReason.CONDITION);
                    return;
                }
            } catch (bytes memory reason) {
                _fail(id, s, period, _classify(reason));
                return;
            }
        }
        uint64 dueAt = s.nextDue;
        // Validate stored timestamp representation before interacting; success-dependent writes follow payment.
        uint64 executedAt = _time64(block.timestamp);
        bytes32 ref = keccak256(abi.encode(id, period));
        try IAskirawaTreasury(treasury).payFromModule(s.recipient, s.amount, ref) {
            ++s.executedCount;
            s.totalPaid += s.amount;
            s.failures = 0;
            s.nextRetryAt = 0;
            if (period < lastPeriod) s.nextDue = ScheduleMath.add(s.startTime, s.frequency, period + 1);
            emit ScheduleExecuted(id, period, s.recipient, s.amount, dueAt, executedAt, msg.sender, s.totalPaid);
            if (period == lastPeriod || _limitsReached(s)) _complete(id, s);
        } catch (bytes memory reason) {
            _fail(id, s, period, _classify(reason));
        }
    }

    /// @inheritdoc IRecurringPaymentModule
    function getSchedule(uint256 id) external view override returns (Schedule memory schedule) { return schedules[id]; }

    /// @inheritdoc IRecurringPaymentModule
    function isDue(uint256 id) public view override returns (bool due) {
        Schedule storage s = schedules[id];
        return s.status == ScheduleStatus.Active && block.timestamp >= s.nextDue && block.timestamp >= s.nextRetryAt;
    }

    /// @inheritdoc IRecurringPaymentModule
    function dueSchedules(uint256 offset, uint256 limit) external view override returns (uint256[] memory ids) {
        uint256 count = nextScheduleId - 1;
        if (offset >= count || limit == 0) return new uint256[](0);
        uint256 scanned = count - offset;
        if (limit < scanned) scanned = limit;
        uint256 matches;
        // Two bounded passes avoid assembly-based array resizing and return no padding.
        for (uint256 i; i < scanned; ++i) {
            uint256 id = offset + i + 1;
            if (isDue(id) && _allowed(schedules[id], msg.sender)) ++matches;
        }
        ids = new uint256[](matches);
        uint256 cursor;
        for (uint256 i; i < scanned; ++i) {
            uint256 id = offset + i + 1;
            if (isDue(id) && _allowed(schedules[id], msg.sender)) ids[cursor++] = id;
        }
    }

    /// @inheritdoc IRecurringPaymentModule
    function nextDueAt(uint256 id) external view override returns (uint64 timestamp) { return schedules[id].nextDue; }

    /// @inheritdoc IRecurringPaymentModule
    function remaining(uint256 id) external view override returns (uint256 executionsLeft, uint256 amountLeft) {
        Schedule storage s = schedules[id];
        if (s.status != ScheduleStatus.Active && s.status != ScheduleStatus.Paused) return (0, 0);
        uint256 countCap = s.maxExecutions == 0 ? type(uint32).max : s.maxExecutions;
        uint256 totalCap = s.maxTotal == 0 ? type(uint96).max : s.maxTotal;
        executionsLeft = countCap > s.executedCount ? countCap - s.executedCount : 0;
        amountLeft = totalCap > s.totalPaid ? totalCap - s.totalPaid : 0;
        uint256 payableCount = amountLeft / s.amount;
        if (payableCount < executionsLeft) executionsLeft = payableCount;
        uint256 countAmount = (countCap - s.executedCount) * uint256(s.amount);
        if (countAmount < amountLeft) amountLeft = countAmount;
    }

    /// @inheritdoc IRecurringPaymentModule
    function scheduleCount() external view override returns (uint256 count) { return nextScheduleId - 1; }

    /// @dev Enforces fixed terms, the current core per-call budget, and checked timestamp/proposal narrowing.
    function _create(uint256 proposalId, ScheduleParams memory p) private {
        if (p.recipient == address(0) || p.recipient == treasury || p.recipient == address(this)) {
            revert InvalidRecipient(p.recipient);
        }
        (,, uint96 perTxMax,,,,) = IRecurringTreasuryBudget(treasury).modules(address(this));
        if (p.amount == 0 || p.amount > perTxMax) revert InvalidAmount(p.amount, perTxMax);
        uint64 now64 = _time64(block.timestamp);
        uint64 start = p.startTime > now64 ? p.startTime : now64;
        if (p.startTime > block.timestamp + 366 days || (p.endTime != 0 && p.endTime <= start) ||
            (p.maxTotal != 0 && p.maxTotal < p.amount)) revert InvalidScheduleParameters();
        // ABI enum decoding rejects out-of-range frequency values before reaching this function.
        ScheduleMath.add(start, p.frequency, 0);
        if (proposalId > type(uint64).max) revert SnapshotOverflow();
        uint256 id = nextScheduleId++;
        Schedule storage s = schedules[id];
        s.recipient = p.recipient;
        s.amount = p.amount;
        s.startTime = start;
        s.nextDue = start;
        s.endTime = p.endTime;
        s.frequency = p.frequency;
        s.status = ScheduleStatus.Active;
        s.maxExecutions = p.maxExecutions;
        s.maxTotal = p.maxTotal;
        s.minTreasuryBalanceAfter = p.minTreasuryBalanceAfter;
        s.executor = p.executor;
        s.createdByProposal = uint64(proposalId);
        s.memoRef = p.memoRef;
        emit ScheduleCreated(id, proposalId, p.recipient, p.amount, p.frequency, p.startTime, start,
            p.endTime, p.maxExecutions, p.maxTotal, p.minTreasuryBalanceAfter, p.executor, p.memoRef);
    }

    /// @dev Calendar skips never consume paid execution count or total limits. No-skip retains backlog protection.
    function _resume(uint256 id, bool skipMissed) private {
        Schedule storage s = _known(id);
        if (s.status != ScheduleStatus.Paused) revert InvalidStatus(id, s.status);
        uint256 skipped;
        if (skipMissed) {
            uint256 currentPeriod = uint256(s.executedCount) + skippedPeriods[id];
            uint256 nextPeriod = ScheduleMath.firstPeriodAfter(s.startTime, s.frequency, block.timestamp);
            if (nextPeriod > currentPeriod) {
                skipped = nextPeriod - currentPeriod;
                skippedPeriods[id] += skipped;
                s.nextDue = ScheduleMath.add(s.startTime, s.frequency, nextPeriod);
            }
        }
        s.failures = 0;
        s.nextRetryAt = 0;
        s.status = ScheduleStatus.Active;
        emit ScheduleResumed(id, skipped);
    }

    /// @dev Includes explicit due-date/count/total hard stops and implicit storage-capacity limits.
    function _limitsReached(Schedule storage s) private view returns (bool) {
        return (s.endTime != 0 && s.nextDue > s.endTime)
            || s.executedCount == type(uint32).max
            || (s.maxExecutions != 0 && s.executedCount >= s.maxExecutions)
            || uint256(s.totalPaid) + s.amount > type(uint96).max
            || (s.maxTotal != 0 && uint256(s.totalPaid) + s.amount > s.maxTotal);
    }

    /// @dev Changes only lifecycle state; no payment is made.
    function _complete(uint256 id, Schedule storage s) private {
        s.status = ScheduleStatus.Completed;
        emit ScheduleCompleted(id);
    }

    /// @dev A soft failure leaves recipient, paid totals and calendar index untouched.
    function _fail(uint256 id, Schedule storage s, uint256 period, FailureReason reason) private {
        ++s.failures;
        s.nextRetryAt = _time64(block.timestamp + retryDelay);
        emit ExecutionFailed(id, period, reason, s.failures, s.nextRetryAt);
        if (s.failures >= maxFailures) {
            s.status = ScheduleStatus.Paused;
            emit ScheduleAutoPaused(id, AutoPauseReason.FAILURES);
        }
    }

    /// @dev Current governance membership is consulted for each restricted execution.
    function _allowed(Schedule storage s, address caller) private view returns (bool) {
        return s.executor == address(0) || s.executor == caller || IAskirawaTreasury(treasury).isApprover(caller);
    }

    /// @dev Guardian zero never authorizes a caller. Roles are current, not creation snapshots.
    function _requireStoppingAuthority() private view {
        IAskirawaTreasury core = IAskirawaTreasury(treasury);
        address currentGuardian = core.guardian();
        if (!core.isApprover(msg.sender) && !(currentGuardian != address(0) && currentGuardian == msg.sender)) {
            revert Unauthorized();
        }
    }

    /// @dev State-changing entry points reject unknown ids rather than acting on empty storage.
    function _known(uint256 id) private view returns (Schedule storage s) {
        s = schedules[id];
        if (s.status == ScheduleStatus.None) revert UnknownSchedule(id);
    }

    /// @dev Examines ONLY four selector bytes; never decodes revert arguments, strings or nested payloads.
    /// Token errors bubble through the core. Error(string) is a recognized legacy-token diagnostic;
    /// arbitrary unknown selectors (including module disabled/code-changed) and short data map to OTHER.
    function _classify(bytes memory reason) private pure returns (FailureReason) {
        if (reason.length < 4) return FailureReason.OTHER;
        bytes4 selector = bytes4((uint32(uint8(reason[0])) << 24) | (uint32(uint8(reason[1])) << 16)
            | (uint32(uint8(reason[2])) << 8) | uint32(uint8(reason[3])));
        if (selector == IRecurringTreasuryBudget.TreasuryPaused.selector) return FailureReason.PAUSED;
        if (selector == IRecurringTreasuryBudget.BudgetExceeded.selector) return FailureReason.BUDGET;
        if (selector == IRecurringTreasuryBudget.InsufficientBalance.selector) return FailureReason.INSUFFICIENT_BALANCE;
        if (selector == IRecurringTreasuryBudget.BalanceDeltaMismatch.selector
            || selector == bytes4(keccak256("SafeERC20FailedOperation(address)"))
            || selector == bytes4(keccak256("ERC20InsufficientBalance(address,uint256,uint256)"))
            || selector == bytes4(keccak256("ERC20InvalidSender(address)"))
            || selector == bytes4(keccak256("ERC20InvalidReceiver(address)"))
            || selector == bytes4(keccak256("ERC20InsufficientAllowance(address,uint256,uint256)"))
            || selector == bytes4(keccak256("ERC20InvalidApprover(address)"))
            || selector == bytes4(keccak256("ERC20InvalidSpender(address)"))
            || selector == bytes4(keccak256("EnforcedPause()"))
            || selector == bytes4(keccak256("Error(string)"))) return FailureReason.TOKEN_REVERT;
        return FailureReason.OTHER;
    }

    /// @dev Explicit checked narrowing rather than truncating timestamps.
    function _time64(uint256 timestamp) private pure returns (uint64) {
        if (timestamp > type(uint64).max) revert SnapshotOverflow();
        return uint64(timestamp);
    }
}
