// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITreasuryModule} from "./ITreasuryModule.sol";
import {ScheduleMath} from "../libraries/ScheduleMath.sol";

/**
 * @title IRecurringPaymentModule
 * @notice UNAUDITED fixed-payment schedules and automation rules, which are one object.
 * @dev The legacy Automation Registry is never called. Amounts are raw six-decimal USDC units.
 */
interface IRecurringPaymentModule is ITreasuryModule {
    /// @notice None identifies an unassigned schedule id; terminal states cannot be resumed.
    enum ScheduleStatus { None, Active, Paused, Cancelled, Completed }
    /// @notice ExecutionFailed reason codes, with stable ordinal values 0 through 5.
    enum FailureReason { PAUSED, BUDGET, INSUFFICIENT_BALANCE, TOKEN_REVERT, CONDITION, OTHER }
    /// @notice ScheduleAutoPaused reason codes, with stable ordinal values 0 and 1.
    enum AutoPauseReason { BACKLOG, FAILURES }

    /**
     * @notice Immutable terms encoded in CREATE_SCHEDULE proposal data.
     * @dev Zero endTime/maxExecutions/maxTotal/minTreasuryBalanceAfter disables that limit.
     * A zero executor allows anyone; current approvers may always execute.
     * startTime is clamped to approval-execution time to establish the permanent UTC anchor.
     */
    struct ScheduleParams {
        address recipient;
        uint96 amount;
        ScheduleMath.Frequency frequency;
        uint64 startTime;
        uint64 endTime;
        uint32 maxExecutions;
        uint96 maxTotal;
        uint96 minTreasuryBalanceAfter;
        address executor;
        bytes32 memoRef;
    }

    /**
     * @notice Fixed schedule terms plus payment, retry and lifecycle state.
     * @dev startTime is the effective anchor. executedCount counts successful payments ONLY.
     * Calendar period index = executedCount + skippedPeriods(id), stored separately to retain
     * the specified struct layout. totalPaid is exactly executedCount * amount.
     */
    struct Schedule {
        address recipient;
        uint96 amount;
        uint64 startTime;
        uint64 nextDue;
        uint64 nextRetryAt;
        uint64 endTime;
        ScheduleMath.Frequency frequency;
        ScheduleStatus status;
        uint32 executedCount;
        uint32 maxExecutions;
        uint8 failures;
        uint96 totalPaid;
        uint96 maxTotal;
        uint96 minTreasuryBalanceAfter;
        address executor;
        uint64 createdByProposal;
        bytes32 memoRef;
    }

    /// @notice Complete approved terms and both requested and effective anchor times.
    event ScheduleCreated(uint256 indexed scheduleId, uint256 indexed proposalId, address indexed recipient,
        uint96 amount, ScheduleMath.Frequency frequency, uint64 startTime, uint64 effectiveStart,
        uint64 endTime, uint32 maxExecutions, uint96 maxTotal, uint96 minTreasuryBalanceAfter,
        address executor, bytes32 memoRef);
    /// @notice One successful payment; periodIndex includes skipped calendar periods, totalPaid does not.
    event ScheduleExecuted(uint256 indexed scheduleId, uint256 periodIndex, address indexed recipient,
        uint96 amount, uint64 dueAt, uint64 executedAt, address indexed executor, uint96 totalPaid);
    /// @notice A rate-limited soft failure; no payment or calendar-period advancement occurred.
    event ExecutionFailed(uint256 indexed scheduleId, uint256 periodIndex, FailureReason reasonCode,
        uint8 failures, uint64 nextRetryAt);
    /// @notice Automated protective pause; reason codes use AutoPauseReason, not FailureReason.
    event ScheduleAutoPaused(uint256 indexed scheduleId, AutoPauseReason reasonCode);
    /// @notice A current approver or nonzero current guardian paused the schedule.
    event SchedulePaused(uint256 indexed scheduleId, address indexed by);
    /// @notice Quorum-authorized resume; skippedPeriods is this resume's delta, not its lifetime total.
    event ScheduleResumed(uint256 indexed scheduleId, uint256 skippedPeriods);
    /// @notice Terminal cancellation by a current approver or nonzero current guardian.
    event ScheduleCancelled(uint256 indexed scheduleId, address indexed by);
    /// @notice Terminal completion due to a limit or the supported arithmetic horizon.
    event ScheduleCompleted(uint256 indexed scheduleId);

    /// @notice Only the bound treasury may apply approved actions.
    error OnlyTreasury();
    /// @notice Caller lacks current pause/cancel authority or schedule execution permission.
    error Unauthorized();
    /// @notice Constructor treasury has no code.
    error InvalidTreasury();
    /// @notice Retry delay is outside [1 hour, 7 days], or maxFailures outside [1,10].
    error InvalidRetryConfiguration();
    /// @notice Recipient is zero, the bound treasury, or this module.
    error InvalidRecipient(address recipient);
    /// @notice Payment is zero or exceeds the current core per-call budget.
    error InvalidAmount(uint96 amount, uint96 perTxMax);
    /// @notice Start, end or total constraint is invalid.
    error InvalidScheduleParameters();
    /// @notice Unknown module action discriminator.
    error UnknownAction(uint8 actionCode);
    /// @notice A schedule id has never been assigned.
    error UnknownSchedule(uint256 scheduleId);
    /// @notice Schedule is not in a state allowed by the requested operation.
    error InvalidStatus(uint256 scheduleId, ScheduleStatus status);
    /// @notice Current time is before the schedule's next due boundary.
    error NotDue(uint64 nextDue);
    /// @notice Current time is before the schedule's retry gate.
    error RetryNotReady(uint64 nextRetryAt);
    /// @notice Timestamp or proposal identifier cannot be represented in uint64.
    error SnapshotOverflow();

    /// @notice Pauses an Active schedule; current approver or nonzero guardian only.
    /// @param id Schedule identifier.
    function pause(uint256 id) external;
    /// @notice Cancels an Active or Paused schedule terminally; stopping authority only.
    /// @param id Schedule identifier.
    function cancel(uint256 id) external;
    /// @notice Attempts one due fixed payment, or performs completion/auto-pause maintenance.
    /// @param id Schedule identifier; no payment terms can be supplied by the caller.
    function execute(uint256 id) external;
    /// @notice Returns stored state, or a zero-valued struct for an unassigned id.
    /// @param id Schedule identifier.
    /// @return schedule Stored schedule.
    function getSchedule(uint256 id) external view returns (Schedule memory schedule);
    /// @notice Reports Active schedules past both timing gates, independent of caller and payment outcome.
    /// @param id Schedule identifier.
    /// @return due Whether execute is time-eligible; hard-stop and failure maintenance may still occur.
    function isDue(uint256 id) external view returns (bool due);
    /// @notice Scans a page of assigned ids and returns time-eligible ids this caller may execute.
    /// @dev offset is a zero-based offset into ALL schedules; limit bounds ids scanned, not matches.
    /// Soft conditions, core/token availability, hard stops and backlog are evaluated by execute.
    /// @param offset Zero-based id-list offset; schedule id = offset + 1.
    /// @param limit Maximum number of assigned ids scanned; advance offset by limit for the next page.
    /// @return ids Eligible ids in ascending order, with no zero padding.
    function dueSchedules(uint256 offset, uint256 limit) external view returns (uint256[] memory ids);
    /// @notice Returns stored nextDue, or zero for an unknown id; terminal values are historical only.
    /// @param id Schedule identifier.
    /// @return timestamp Stored due timestamp, excluding the independent retry gate.
    function nextDueAt(uint256 id) external view returns (uint64 timestamp);
    /// @notice Returns paid-count and amount headroom; skipped periods consume neither.
    /// @dev Zero for unknown/terminal ids. Disabled explicit limits use uint32/uint96 storage ceilings.
    /// Amount headroom need not be a multiple of amount; counts are bounded by that headroom.
    /// Future endTime/calendar-horizon effects are not projected into this accounting view.
    /// @param id Schedule identifier.
    /// @return executionsLeft Additional successful payments allowed by count/amount accounting.
    /// @return amountLeft Raw amount headroom, capped by remaining payment-count capacity.
    function remaining(uint256 id) external view returns (uint256 executionsLeft, uint256 amountLeft);
    /// @notice Returns the number of assigned schedule ids, including terminal schedules.
    /// @return count Assigned count.
    function scheduleCount() external view returns (uint256 count);
    /// @notice Returns lifetime unpaid calendar periods skipped by quorum resumes.
    /// @param id Schedule identifier.
    /// @return count Skipped count; calendar period = this value + executedCount.
    function skippedPeriods(uint256 id) external view returns (uint256 count);
    /// @notice Returns the immutable soft-failure retry interval in seconds.
    /// @return delay Retry interval.
    function retryDelay() external view returns (uint32 delay);
    /// @notice Returns the immutable consecutive-failure auto-pause threshold.
    /// @return count Failure threshold.
    function maxFailures() external view returns (uint8 count);
}
