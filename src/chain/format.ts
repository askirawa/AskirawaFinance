/** Plain-language formatting and status vocabulary. Raw USDC amounts are 6-decimal base units. */
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'
import { formatUsdc } from '../onchain-money'

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/** "1,234.50" from raw base units. Never pass floats on money paths. */
export function usdc(raw: bigint): string {
  const [whole, frac = ''] = formatUsdc(raw).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const cents = (frac + '00').slice(0, 2)
  const rest = frac.length > 2 ? frac.slice(2).replace(/0+$/, '') : ''
  return `${grouped}.${cents}${rest}`
}

export function dateTime(seconds: bigint | number): string {
  const ms = Number(seconds) * 1000
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function dateOnly(seconds: bigint | number): string {
  return new Date(Number(seconds) * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function timeLeft(untilSeconds: bigint | number, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const diff = Number(untilSeconds) - nowSeconds
  if (diff <= 0) return 'now'
  if (diff < 3600) return `${Math.ceil(diff / 60)} min`
  if (diff < 86400) return `${Math.ceil(diff / 3600)} h`
  return `${Math.ceil(diff / 86400)} days`
}

// ─── Proposal vocabulary (mirrors AskirawaTreasury.Action / ProposalStatus) ─────────────────────
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export const ACTION_LABEL: Record<number, string> = {
  1: 'Payroll',
  2: 'Team and approval rules change',
  3: 'Recurring payments budget',
  4: 'Recurring payment schedule',
  5: 'Recover tokens',
  6: 'Resume treasury',
}

/** Index = ProposalStatus enum value. */
export const STATUS_VIEW: { label: string; hint: string; tone: Tone }[] = [
  { label: 'Unknown', hint: 'No such request.', tone: 'neutral' },
  { label: 'Waiting for approval', hint: 'Needs more approvals before it can be paid.', tone: 'warning' },
  { label: 'Approved, waiting period', hint: 'Enough approvals. A safety delay must pass before payment.', tone: 'info' },
  { label: 'Ready to pay', hint: 'Fully approved. Anyone can now trigger the payment.', tone: 'success' },
  { label: 'Payment confirmed', hint: 'The payment was executed on-chain.', tone: 'success' },
  { label: 'Cancelled', hint: 'This request was cancelled. Nothing was paid.', tone: 'neutral' },
  { label: 'Rejected', hint: 'Approvers rejected this request. Nothing was paid.', tone: 'danger' },
  { label: 'Expired', hint: 'It was not completed in time. Nothing was paid.', tone: 'neutral' },
  { label: 'Replaced by a rules change', hint: 'Approver rules changed after this was submitted. Submit it again.', tone: 'neutral' },
]

export const SCHEDULE_STATUS: { label: string; tone: Tone }[] = [
  { label: 'Unknown', tone: 'neutral' },
  { label: 'Active', tone: 'success' },
  { label: 'Paused', tone: 'warning' },
  { label: 'Cancelled', tone: 'neutral' },
  { label: 'Finished', tone: 'neutral' },
]

export const FREQUENCY_LABEL = ['Daily', 'Weekly', 'Monthly'] as const

// ─── Errors → plain language ────────────────────────────────────────────────────────────────────
const ERROR_TEXT: Record<string, string> = {
  NotApprover: 'This wallet is not an approver for the treasury.',
  NotProposer: 'This wallet is not allowed to create payment requests.',
  AlreadyVoted: 'This wallet has already voted on this request.',
  Expired: 'This request has expired.',
  NotPending: 'This request is no longer open.',
  WrongEpoch: 'Approval rules changed after this request was created. Create it again.',
  QuorumNotReached: 'Not enough approvals yet.',
  DelayNotElapsed: 'The safety waiting period has not finished yet.',
  InsufficientBalance: 'The treasury does not hold enough USDC for this payment.',
  TreasuryPaused: 'The treasury is paused. Payments are blocked until it is resumed.',
  SpendingCoolingOff: 'Payments are temporarily blocked after a recovery.',
  BudgetExceeded: 'This would exceed the spending limit configured for recurring payments.',
  InvalidPaymentCount: 'A payroll needs between 1 and 100 recipients.',
  InvalidAddress: 'One of the addresses is not allowed.',
  ZeroAmount: 'Every amount must be greater than zero.',
  InvalidExpiry: 'The approval deadline is outside the allowed range.',
  Unauthorized: 'This wallet is not allowed to do that.',
  NotDue: 'This payment is not due yet.',
  RetryNotReady: 'A recent attempt failed. Retrying is allowed after the retry delay.',
  InvalidStatus: 'This schedule is not in a state that allows that action.',
}

export function describeError(error: unknown): { message: string; cancelled: boolean } {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return { message: 'You cancelled the request in your wallet.', cancelled: true }
    }
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && ERROR_TEXT[name]) return { message: ERROR_TEXT[name], cancelled: false }
      if (name) return { message: `The contract refused this action (${name}).`, cancelled: false }
    }
    const text = error.shortMessage.toLowerCase()
    if (text.includes('insufficient funds')) {
      return { message: 'Your wallet does not have enough USDC to pay the network fee.', cancelled: false }
    }
    return { message: error.shortMessage, cancelled: false }
  }
  return { message: 'Something went wrong. Please try again.', cancelled: false }
}

/**
 * Status wording for one request. Only payroll requests end in a payment. A schedule request ends in a registered
 * schedule, which has not paid anyone yet, so the wording must not say "payment".
 */
export function statusViewFor(status: number, action: number): { label: string; hint: string; tone: Tone } {
  const base = STATUS_VIEW[status] ?? STATUS_VIEW[0]
  if (action !== 1 && status === 1) return { ...base, hint: 'Needs more approvals before it can go ahead.' }
  if (action !== 1 && status === 2) return { ...base, hint: 'Enough approvals. A safety delay must pass before it can be started.' }
  if (action === 1 || (status !== 3 && status !== 4)) return base
  const schedule = action === 4
  if (status === 3) {
    return {
      label: schedule ? 'Ready to start' : 'Ready to apply',
      hint: schedule ? 'Fully approved. Anyone can now start it. Starting it does not pay anyone.' : 'Fully approved. Anyone can now apply it.',
      tone: base.tone,
    }
  }
  return {
    label: schedule ? 'Registered, unpaid' : 'Applied',
    hint: schedule ? 'The schedule or change is recorded on-chain. No payment has been made by this step.' : 'The change was applied on-chain.',
    tone: 'info',
  }
}
