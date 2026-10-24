/**
 * AskirawaFi — Recurring Payments
 *
 * ARCHITECTURE NOTE:
 * The existing AskirawaFi contract (0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434)
 * can register single-recipient automations. However, it does NOT include an
 * on-chain scheduler or keeper that automatically executes transfers at the
 * configured interval. This means:
 *
 *   - Recurring payment schedules are stored in browser localStorage.
 *   - Each execution is a manual, wallet-signed USDC ERC-20 `transfer()` call.
 *   - Schedules labeled "awaiting execution" require a connected wallet to trigger.
 *   - TRUE automatic execution (daily/weekly/monthly without user action) would
 *     require either:
 *     (a) A keeper contract with pre-approved USDC allowance, OR
 *     (b) An off-chain scheduler service (e.g. Gelato, Chainlink Automation)
 *         authorized to call the contract on a schedule.
 *
 * Until that infrastructure exists, schedules are clearly labeled
 * "Awaiting Manual Execution" in the UI.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Frequency = 'daily' | 'weekly' | 'monthly'

export type ScheduleStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type ExecutionStatus = 'pending' | 'processing' | 'confirmed' | 'failed' | 'skipped'

export interface RecurringSchedule {
  id: string
  name: string
  recipientAddress: string
  amountUsdc: string          // string — no JS float arithmetic
  frequency: Frequency
  startDate: string           // ISO date string (YYYY-MM-DD)
  startTime: string           // HH:mm
  endDate?: string            // ISO date string — optional
  maxExecutions?: number      // optional cap
  description: string
  status: ScheduleStatus
  createdAt: number           // unix ms
  createdBy?: string          // wallet address
  pausedAt?: number
  cancelledAt?: number
  completedAt?: number
  executionHistory: ExecutionRecord[]
}

export interface ExecutionRecord {
  id: string
  scheduledFor: number        // unix ms
  executedAt?: number         // unix ms
  status: ExecutionStatus
  txHash?: string
  amountUsdc: string
  errorMessage?: string

  // ─── Treasury proposal fields (set when AskirawaFiTreasury is deployed) ───────
  /**
   * On-chain bytes32 proposal ID confirmed by proposeTransfer.
   * Authoritative ID for vote/execute calls.
   */
  treasuryProposalId?: string
  /** Tx hash of the proposeTransfer transaction. */
  treasuryProposeTxHash?: string
  /** Tx hash of the treasury execute transaction. */
  treasuryExecuteTxHash?: string
  /** Unix seconds expiry passed to proposeTransfer. */
  treasuryExpiresAt?: number
  /**
   * Frozen recipient address at propose time.
   * Must match the address passed to execute() exactly.
   */
  treasuryRecipient?: string
  /**
   * Frozen raw amount (decimal string of bigint, 6 decimals) at propose time.
   */
  treasuryAmountRaw?: string
}

// ─── USDC decimal helpers (integer bigint, no floats) ─────────────────────────

export const USDC_DECIMALS = 6

export function parseUsdcString(value: string): bigint {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid USDC amount: "${value}"`)
  }
  const [whole, frac = ''] = trimmed.split('.')
  const fracPadded = frac.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, '0')
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded)
}

export function formatUsdcBigint(raw: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS)
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '') || '0'
  return `${Number(whole).toLocaleString('en-US')}.${fracStr}`
}

// ─── Date / schedule math ─────────────────────────────────────────────────────

/**
 * Compute the Nth future execution date from a start date + time, given frequency.
 * Handles month-end edge cases (e.g. Jan 31 + 1 month = Feb 28/29, never Mar 3).
 * n=0 returns the first execution (startDate + startTime).
 */
export function computeNthExecution(
  startDate: string,
  startTime: string,
  frequency: Frequency,
  n: number
): Date {
  const [year, month, day] = startDate.split('-').map(Number)
  const [hour, minute] = startTime.split(':').map(Number)

  const base = new Date(year, month - 1, day, hour, minute, 0, 0)

  if (frequency === 'daily') {
    base.setDate(base.getDate() + n)
  } else if (frequency === 'weekly') {
    base.setDate(base.getDate() + n * 7)
  } else {
    // monthly — add n months, clamp to end of target month
    const targetMonth = (month - 1 + n) % 12
    const targetYear = year + Math.floor((month - 1 + n) / 12)
    const maxDay = new Date(targetYear, targetMonth + 1, 0).getDate()
    base.setFullYear(targetYear, targetMonth, Math.min(day, maxDay))
  }

  return base
}

/**
 * Find the next scheduled execution date for a schedule.
 * Returns null if the schedule is past its end date or max executions.
 */
export function nextExecutionDate(schedule: RecurringSchedule): Date | null {
  if (schedule.status !== 'active') return null

  const confirmedCount = schedule.executionHistory.filter(
    e => e.status === 'confirmed'
  ).length

  if (schedule.maxExecutions != null && confirmedCount >= schedule.maxExecutions) {
    return null
  }

  // Find first execution n=0,1,2,… that is in the future and hasn't been confirmed
  const now = Date.now()
  for (let n = confirmedCount; n < confirmedCount + 1000; n++) {
    const d = computeNthExecution(schedule.startDate, schedule.startTime, schedule.frequency, n)
    if (d.getTime() > now) {
      // Check endDate
      if (schedule.endDate) {
        const end = new Date(schedule.endDate + 'T23:59:59')
        if (d > end) return null
      }
      return d
    }
  }
  return null
}

/**
 * Return all pending (unconfirmed + unexecuted) execution slots up to the next N.
 */
export function upcomingExecutions(schedule: RecurringSchedule, count = 3): Date[] {
  if (schedule.status !== 'active') return []
  const confirmedCount = schedule.executionHistory.filter(e => e.status === 'confirmed').length
  const results: Date[] = []
  const now = Date.now()

  for (let n = confirmedCount; results.length < count && n < confirmedCount + 100; n++) {
    const d = computeNthExecution(schedule.startDate, schedule.startTime, schedule.frequency, n)
    if (schedule.endDate) {
      const end = new Date(schedule.endDate + 'T23:59:59')
      if (d > end) break
    }
    if (schedule.maxExecutions != null && n >= schedule.maxExecutions) break
    if (d.getTime() > now) results.push(d)
  }
  return results
}

/**
 * Total projected payout for a schedule (max executions × amount, or n×amount for finite end date).
 * Returns null when the schedule is open-ended with no max.
 */
export function projectedTotal(schedule: RecurringSchedule): bigint | null {
  if (schedule.maxExecutions != null) {
    try {
      return parseUsdcString(schedule.amountUsdc) * BigInt(schedule.maxExecutions)
    } catch { return null }
  }
  return null
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ScheduleValidationResult {
  valid: boolean
  errors: Partial<Record<ScheduleField, string>>
  globalErrors: string[]
}

export type ScheduleField =
  | 'name'
  | 'recipientAddress'
  | 'amountUsdc'
  | 'frequency'
  | 'startDate'
  | 'startTime'
  | 'endDate'
  | 'maxExecutions'

export function validateScheduleForm(fields: {
  name: string
  recipientAddress: string
  amountUsdc: string
  frequency: string
  startDate: string
  startTime: string
  endDate: string
  maxExecutions: string
}): ScheduleValidationResult {
  const errors: Partial<Record<ScheduleField, string>> = {}
  const globalErrors: string[] = []
  const now = new Date()

  if (!fields.name.trim()) {
    errors.name = 'Schedule name is required.'
  }

  if (!fields.recipientAddress.trim()) {
    errors.recipientAddress = 'Recipient address is required.'
  } else if (!/^0x[0-9a-fA-F]{40}$/.test(fields.recipientAddress.trim())) {
    errors.recipientAddress = 'Invalid Ethereum address.'
  }

  if (!fields.amountUsdc.trim()) {
    errors.amountUsdc = 'Amount is required.'
  } else {
    try {
      const raw = parseUsdcString(fields.amountUsdc)
      if (raw <= 0n) errors.amountUsdc = 'Amount must be greater than zero.'
    } catch {
      errors.amountUsdc = 'Invalid amount. Use decimal format (e.g. 100.00).'
    }
  }

  if (!['daily', 'weekly', 'monthly'].includes(fields.frequency)) {
    errors.frequency = 'Select a frequency.'
  }

  if (!fields.startDate) {
    errors.startDate = 'Start date is required.'
  } else {
    const startDt = new Date(fields.startDate + 'T' + (fields.startTime || '00:00'))
    if (isNaN(startDt.getTime())) {
      errors.startDate = 'Invalid start date.'
    } else if (startDt < now) {
      // Allow past start dates — the first future execution will be computed
    }
  }

  if (!fields.startTime) {
    errors.startTime = 'Start time is required.'
  }

  if (fields.endDate) {
    const endDt = new Date(fields.endDate + 'T23:59:59')
    const startDt = new Date(fields.startDate + 'T' + (fields.startTime || '00:00'))
    if (isNaN(endDt.getTime())) {
      errors.endDate = 'Invalid end date.'
    } else if (endDt <= startDt) {
      errors.endDate = 'End date must be after start date.'
    }
  }

  if (fields.maxExecutions) {
    const n = parseInt(fields.maxExecutions, 10)
    if (isNaN(n) || n <= 0) {
      errors.maxExecutions = 'Max executions must be a positive integer.'
    }
  }

  return {
    valid: Object.keys(errors).length === 0 && globalErrors.length === 0,
    errors,
    globalErrors,
  }
}

// ─── Status display helpers ───────────────────────────────────────────────────

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'active'

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

export function scheduleStatusVariant(status: ScheduleStatus): BadgeVariant {
  if (status === 'active') return 'active'
  if (status === 'completed') return 'success'
  if (status === 'paused') return 'warning'
  if (status === 'cancelled' || status === 'failed') return 'danger'
  return 'neutral'
}

export function executionStatusVariant(status: ExecutionStatus): BadgeVariant {
  if (status === 'confirmed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'processing') return 'active'
  if (status === 'skipped') return 'warning'
  return 'neutral'
}

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  confirmed: 'Confirmed',
  failed: 'Failed',
  skipped: 'Skipped',
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const STORAGE_KEY = 'askirawafi_recurring_v1'

export function loadSchedules(): RecurringSchedule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecurringSchedule[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveSchedules(schedules: RecurringSchedule[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules))
}

export function upsertSchedule(
  schedules: RecurringSchedule[],
  schedule: RecurringSchedule
): RecurringSchedule[] {
  const idx = schedules.findIndex(s => s.id === schedule.id)
  if (idx === -1) return [...schedules, schedule]
  const next = [...schedules]
  next[idx] = schedule
  return next
}

// ─── ID / display helpers ────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function formatScheduleId(id: string): string {
  return `REC-${id.split('-')[0].toUpperCase()}`
}

export function formatTs(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
