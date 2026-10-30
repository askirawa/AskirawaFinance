/**
 * Pure helpers for Treasury v2: proposal states, labels, payload decoding,
 * revert-reason messages and time formatting. No React, no network.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  decodeAbiParameters,
  encodeAbiParameters,
  parseAbiParameters,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { MODULE_V2_ABI } from './abi'

// ─── Enums (mirrors AskirawaTreasury.sol) ────────────────────────────────────

export const ACTION = { None: 0, Payroll: 1, Governance: 2, ModuleConfig: 3, ModuleAction: 4, Rescue: 5, Unpause: 6 } as const
export const ACTION_LABEL: Record<number, string> = {
  1: 'Payroll', 2: 'Governance change', 3: 'Module configuration', 4: 'Module action', 5: 'Token rescue', 6: 'Unpause treasury',
}

export const PSTATUS = { None: 0, Pending: 1, Approved: 2, Executable: 3, Executed: 4, Cancelled: 5, Rejected: 6, Expired: 7, Fenced: 8 } as const
export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'active'

export const PSTATUS_META: Record<number, { label: string; variant: BadgeVariant; help: string }> = {
  0: { label: 'Unknown', variant: 'neutral', help: 'No such proposal.' },
  1: { label: 'Pending', variant: 'warning', help: 'Waiting for enough approvals.' },
  2: { label: 'Approved', variant: 'active', help: 'Quorum reached. Waiting for the timelock to end.' },
  3: { label: 'Executable', variant: 'success', help: 'Timelock ended. Anyone can execute.' },
  4: { label: 'Executed', variant: 'success', help: 'Completed onchain.' },
  5: { label: 'Cancelled', variant: 'neutral', help: 'Cancelled before execution.' },
  6: { label: 'Rejected', variant: 'danger', help: 'Enough approvers rejected it that quorum is impossible.' },
  7: { label: 'Expired', variant: 'neutral', help: 'The expiry time passed before execution.' },
  8: { label: 'Voided', variant: 'neutral', help: 'Governance changed after this was created, so it can no longer run. Re-propose it.' },
}

export const RECOVERY_STATUS_META: Record<number, { label: string; variant: BadgeVariant; help: string }> = {
  0: { label: 'None', variant: 'neutral', help: '' },
  1: { label: 'Collecting council votes', variant: 'warning', help: 'Needs the council threshold within 7 days. Approvers can veto.' },
  2: { label: 'Timelocked', variant: 'active', help: '14 day delay. The treasury approvers can still veto with their normal quorum.' },
  3: { label: 'Executed', variant: 'success', help: 'Replacement governance installed.' },
  4: { label: 'Vetoed', variant: 'danger', help: 'The approvers vetoed it.' },
  5: { label: 'Cancelled', variant: 'neutral', help: 'The initiator withdrew it.' },
  6: { label: 'Expired', variant: 'neutral', help: 'Out of time, or voided by activity or a governance change.' },
}
export const RECOVERY_STALE_REASON: Record<number, string> = {
  1: 'it ran out of time', 2: 'governance changed since it started', 3: 'a proposal executed since it started (the approvers are active)',
}

export const MODULE_STATUS_LABEL: Record<number, { label: string; variant: BadgeVariant }> = {
  0: { label: 'None', variant: 'neutral' },
  1: { label: 'Active', variant: 'active' },
  2: { label: 'Paused', variant: 'warning' },
  3: { label: 'Cancelled', variant: 'neutral' },
  4: { label: 'Completed', variant: 'success' },
}
export const FREQUENCY_LABEL = ['Daily', 'Weekly', 'Monthly'] as const

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProposalCore {
  action: number; status: number; epoch: bigint; quorum: number; proposer: Address
  createdAt: bigint; approvedAt: bigint; executableAt: bigint; expiresAt: bigint
  approvals: number; rejections: number; totalAmount: bigint; payloadHash: Hex; memoRef: Hex
}

export interface GovernanceDetails {
  approvers: readonly Address[]; proposers: readonly Address[]; quorum: number
  guardian: Address; payrollDelay: number; configDelay: number
}

export type ProposalDetails =
  | { kind: 'payroll'; items: readonly { to: Address; amount: bigint }[] }
  | { kind: 'governance'; config: GovernanceDetails }
  | { kind: 'moduleConfig'; module: Address; enabled: boolean; perTxMax: bigint; windowMax: bigint; windowLength: number }
  | { kind: 'moduleAction'; module: Address; actionCode: number; data: Hex; fundingAmount: bigint }
  | { kind: 'rescue'; token: Address; to: Address; amount: bigint }
  | { kind: 'unpause'; pauseCount: bigint }
  | { kind: 'unknown' }

// ─── Payload decoding / encoding ─────────────────────────────────────────────

const GOV_TUPLE = 'address[] approvers, address[] proposers, uint8 quorum, address guardian, uint32 payrollDelay, uint32 configDelay'

export function decodePayload(action: number, payload: Hex): ProposalDetails {
  try {
    if (action === ACTION.Governance) {
      const [c] = decodeAbiParameters(parseAbiParameters(`(${GOV_TUPLE}) c`), payload)
      return { kind: 'governance', config: c }
    }
    if (action === ACTION.ModuleConfig) {
      const [c] = decodeAbiParameters(parseAbiParameters('(address module, bool enabled, uint96 perTxMax, uint96 windowMax, uint32 windowLength) c'), payload)
      return { kind: 'moduleConfig', ...c }
    }
    if (action === ACTION.ModuleAction) {
      const [c] = decodeAbiParameters(parseAbiParameters('(address module, uint8 actionCode, bytes data, uint96 fundingAmount) c'), payload)
      return { kind: 'moduleAction', ...c }
    }
    if (action === ACTION.Rescue) {
      const [c] = decodeAbiParameters(parseAbiParameters('(address token, address to, uint256 amount) c'), payload)
      return { kind: 'rescue', ...c }
    }
    if (action === ACTION.Unpause) {
      const [c] = decodeAbiParameters(parseAbiParameters('(bool unpause, uint64 pauseCount) c'), payload)
      return { kind: 'unpause', pauseCount: c.pauseCount }
    }
  } catch {
    return { kind: 'unknown' }
  }
  return { kind: 'unknown' }
}

export interface ScheduleInput {
  recipient: Address; amount: bigint; frequency: number; startTime: bigint; endTime: bigint
  maxExecutions: number; maxTotal: bigint; minTreasuryBalanceAfter: bigint; executor: Address; memoRef: Hex
}

/** ABI encoding of ScheduleParams, the `data` for module action CREATE_SCHEDULE. */
export function encodeScheduleParams(p: ScheduleInput): Hex {
  return encodeAbiParameters(
    parseAbiParameters('(address recipient, uint96 amount, uint8 frequency, uint64 startTime, uint64 endTime, uint32 maxExecutions, uint96 maxTotal, uint96 minTreasuryBalanceAfter, address executor, bytes32 memoRef) p'),
    [p],
  )
}

/** ABI encoding of (uint256 scheduleId, bool skipMissed), the `data` for RESUME_SCHEDULE. */
export function encodeResume(scheduleId: bigint, skipMissed: boolean): Hex {
  return encodeAbiParameters(parseAbiParameters('uint256 id, bool skipMissed'), [scheduleId, skipMissed])
}

// ─── Authorization helpers (client-side mirrors of the contract rules) ───────

export interface Viewer { isApprover: boolean; isProposer: boolean; isGuardian: boolean; address?: Address }

/** Whether the viewer may cast a vote. The contract is still the final authority. */
export function canVote(p: ProposalCore, derived: number, v: Viewer, myVote: number, currentEpoch: bigint): boolean {
  return v.isApprover && myVote === 0 && p.epoch === currentEpoch && (derived === PSTATUS.Pending)
}

export function canCancel(p: ProposalCore, derived: number, v: Viewer): boolean {
  const live = derived === PSTATUS.Pending || derived === PSTATUS.Approved || derived === PSTATUS.Executable || derived === PSTATUS.Fenced
  if (!live || !v.address) return false
  if (p.proposer.toLowerCase() === v.address.toLowerCase()) return true
  return v.isGuardian && p.action !== ACTION.Governance && p.action !== ACTION.Unpause
}

// ─── Time ────────────────────────────────────────────────────────────────────

/** Current wall-clock time in whole seconds (kept outside components so render stays pure). */
export const nowSeconds = () => Math.floor(Date.now() / 1000)

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s}s`
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s % 60}s`
}

export function formatTimestamp(sec: bigint | number): string {
  const n = Number(sec)
  return n > 0 ? new Date(n * 1000).toLocaleString() : '—'
}

/** The next time-based milestone for a proposal, for the countdown label. */
export function countdownLabel(p: ProposalCore, derived: number, nowSec: number): string | null {
  if (derived === PSTATUS.Approved) return `Executable in ${formatDuration(Number(p.executableAt) - nowSec)}`
  if (derived === PSTATUS.Pending) return `Expires in ${formatDuration(Number(p.expiresAt) - nowSec)}`
  if (derived === PSTATUS.Executable) return `Expires in ${formatDuration(Number(p.expiresAt) - nowSec)}`
  return null
}

// ─── Revert / wallet error messages ──────────────────────────────────────────

const ERROR_TEXT: Record<string, string> = {
  NotProposer: 'Your wallet is not an approver or proposer in the current governance setup.',
  NotApprover: 'Your wallet is not an approver for this proposal.',
  Unauthorized: 'Your wallet is not allowed to do this.',
  NotPending: 'This proposal is no longer pending.',
  Expired: 'This proposal has expired.',
  WrongEpoch: 'Governance changed after this proposal was created, so it can no longer run. Create a new one.',
  AlreadyVoted: 'You have already voted.',
  QuorumNotReached: 'Not enough approvals yet.',
  DelayNotElapsed: 'The timelock has not ended yet.',
  InvalidExpiry: 'Expiry must be after the timelock plus one hour and within 30 days.',
  ZeroAmount: 'Amount must be greater than zero.',
  InvalidPaymentCount: 'A payroll needs between 1 and 100 payments.',
  TreasuryPaused: 'The treasury is paused.',
  NotPaused: 'The treasury is not paused.',
  StalePauseUnpause: 'This unpause proposal belongs to an earlier pause.',
  InsufficientBalance: 'The treasury does not hold enough USDC.',
  BalanceDeltaMismatch: 'The token balance did not change by the expected amount, so the transfer was reverted.',
  BudgetExceeded: 'The module budget (per payment or per window) would be exceeded.',
  ModuleDisabled: 'The module is not enabled. Enable it through governance first.',
  ModuleCodeChanged: 'The module code no longer matches the registered code.',
  InvalidModule: 'This address is not a valid module for this treasury.',
  InvalidBudget: 'The module budget values are invalid.',
  ModuleCallbackFailed: 'The module rejected the action.',
  InvalidQuorum: 'Quorum must be at least 2 and no more than the number of approvers.',
  InvalidRoleCount: 'You need between 2 and 20 approvers and at most 50 proposers.',
  DuplicateRole: 'An address appears more than once in the same list.',
  InvalidAddress: 'An address is zero or is the treasury itself.',
  InvalidDelay: 'A delay is out of range, or below the treasury minimum configuration delay.',
  CannotRescueUSDC: 'USDC cannot be rescued.',
  NoCode: 'That address is not a contract.',
  NotDue: 'This schedule is not due yet.',
  RetryNotReady: 'This schedule is waiting for its retry delay.',
  InvalidStatus: 'This schedule is not in a state that allows this action.',
  NothingToRecover: 'The module holds no USDC to return.',
  ReentrancyGuardReentrantCall: 'Reentrant call blocked.',
  NotRecovery: 'Only the recovery contract can do this.',
  InactivityNotMet: 'Recovery is not allowed yet: the treasury must be inactive for 30 days (no executed proposal).',
  SpendingCoolingOff: 'Payroll and module payments are blocked for 7 days after a recovery.',
  CoolingNotFinished: 'The cooling period has not ended, or was already acknowledged.',
  NotCouncilMember: 'Your wallet is not a recovery council member.',
  RecoveryInProgress: 'Another recovery is still live.',
  WrongState: 'This recovery is not in the right state for that action.',
  RecoveryStale: 'This recovery can no longer succeed (time ran out, governance changed, or the approvers executed a proposal).',
  RecoveryNotStale: 'This recovery is still usable.',
  InvalidCouncil: 'The council needs 3 to 7 members and a threshold of at least 2 and below the member count.',
  DuplicateMember: 'A council member appears twice.',
  CouncilRoleConflict: 'A council member is also an approver or the guardian, which is not allowed.',
  AlreadyBound: 'This recovery contract already serves another treasury.',
  NotBound: 'This recovery contract is not bound to a treasury yet.',
}

/** Turn any thrown viem/wagmi error into a short, honest message. */
export function describeError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return 'You rejected the request in your wallet.'
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name) return ERROR_TEXT[name] ?? `The contract rejected this action (${name}).`
      if (reverted.reason) return `The contract rejected this action: ${reverted.reason}`
    }
    return err.shortMessage || 'The transaction failed.'
  }
  return err instanceof Error ? err.message : 'The transaction failed.'
}

// ─── Recurring execution outcome (from receipt logs) ─────────────────────────


const FAILURE_REASON = ['the treasury is paused', 'the module budget is exhausted', 'the treasury balance is too low', 'the token transfer failed', 'the minimum balance condition was not met', 'an unspecified error']

/**
 * RecurringPaymentModule.execute records a failed payment as a soft failure instead of reverting.
 * Returns a message when the receipt shows anything other than a completed payment, else null.
 */
export function inspectScheduleExecution(receipt: TransactionReceipt): string | null {
  const logs = parseEventLogs({ abi: MODULE_V2_ABI, logs: receipt.logs, strict: false })
  if (logs.some((l) => l.eventName === 'ScheduleExecuted')) return null
  const failed = logs.find((l) => l.eventName === 'ExecutionFailed')
  if (failed) {
    const a = failed.args as { reasonCode?: number; failures?: number }
    return `The payment did not go through: ${FAILURE_REASON[a.reasonCode ?? 5] ?? 'unknown reason'}. Failure ${a.failures ?? '?'} recorded; the schedule retries after its delay.`
  }
  if (logs.some((l) => l.eventName === 'ScheduleAutoPaused')) return 'The schedule was auto-paused (backlog). It needs a governance resume.'
  if (logs.some((l) => l.eventName === 'ScheduleCompleted')) return 'The schedule reached its limit and is completed. No payment was made.'
  return 'No payment event was emitted. Nothing was paid.'
}

export interface RecoveryRecord {
  status: number; epoch: bigint; vetoQuorum: number; initiator: Address; initiatedAt: bigint; approvedAt: bigint
  executableAt: bigint; expiresAt: bigint; approvals: number; vetoes: number; payloadHash: Hex
}

export interface RecoveryPayloadView { config: GovernanceDetails; council: readonly Address[]; threshold: number }

/** Decodes the stored recovery payload: (GovernancePayload, address[] council, uint8 threshold). */
export function decodeRecoveryPayload(payload: Hex): RecoveryPayloadView | null {
  try {
    const [config, council, threshold] = decodeAbiParameters(
      parseAbiParameters(`(${GOV_TUPLE}) config, address[] council, uint8 threshold`), payload)
    return { config, council, threshold }
  } catch {
    return null
  }
}
