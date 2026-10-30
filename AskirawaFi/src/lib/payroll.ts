/**
 * AskirawaFi — Payroll Management
 *
 * ARCHITECTURE NOTE:
 * The existing AskirawaFi Automation Registry contract (0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434)
 * supports single-recipient automations only (createAutomation takes one recipient + amount).
 * It does NOT support batch multi-recipient payroll.
 *
 * A dedicated PayrollBatch contract would be required for true atomic on-chain batch execution.
 * Until that contract is deployed, payroll batches are:
 *   - Stored in browser localStorage (clearly labeled as local records).
 *   - Executed as sequential individual USDC ERC-20 transfers, one per employee.
 *   - Each transfer is a real on-chain USDC transaction on Arc Mainnet.
 *   - "Batch" completion is tracked by individual tx hash confirmation, not a single tx.
 *
 * This means: (a) no atomicity — some employees may succeed and others fail;
 * (b) the treasury wallet signs each transfer individually;
 * (c) a dedicated payroll contract would solve both limitations in a future phase.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type BatchStatus =
  | 'draft'
  | 'ready'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'

export type PaymentStatus = 'pending' | 'processing' | 'confirmed' | 'failed'

export type ScheduleType = 'immediate' | 'scheduled'

export interface EmployeeEntry {
  id: string
  name: string
  walletAddress: string
  amountUsdc: string        // string, not float — avoids JS floating-point errors
  description: string
}

export interface EmployeePayment extends EmployeeEntry {
  status: PaymentStatus
  txHash?: string
  confirmedAt?: number      // unix timestamp ms
  errorMessage?: string
}

export interface PayrollBatch {
  id: string
  name: string
  scheduleType: ScheduleType
  scheduledDate?: string    // ISO date string, only for 'scheduled'
  createdAt: number         // unix timestamp ms
  createdBy?: string        // wallet address of creator
  submittedAt?: number
  completedAt?: number
  status: BatchStatus
  payments: EmployeePayment[]
  /** Note shown to treasury team */
  note: string
}

// ─── USDC decimal helpers (integer bigint arithmetic, no floats) ───────────────

export const USDC_DECIMALS = 6

/**
 * Parse a USDC string amount ("1234.56") into the raw bigint representation
 * (e.g. 1234560000n for 6 decimals). Throws if the input is invalid.
 * Never uses parseFloat internally.
 */
export function parseUsdcString(value: string): bigint {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid USDC amount: "${value}"`)
  }
  const [whole, frac = ''] = trimmed.split('.')
  const fracPadded = frac.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, '0')
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded)
}

/**
 * Format a raw bigint USDC amount as a human-readable string ("1,234.56").
 */
export function formatUsdcBigint(raw: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS)
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '') || '0'
  const wholeFormatted = Number(whole).toLocaleString('en-US')
  return `${wholeFormatted}.${fracStr}`
}

/**
 * Sum all employee amounts in a batch as a bigint to avoid floating-point errors.
 * Returns 0n if any entry is invalid.
 */
export function sumBatchAmounts(entries: EmployeeEntry[]): bigint {
  let total = 0n
  for (const e of entries) {
    try {
      total += parseUsdcString(e.amountUsdc)
    } catch {
      // skip invalid — validation should catch these separately
    }
  }
  return total
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface EntryError {
  field: 'name' | 'walletAddress' | 'amountUsdc'
  message: string
}

export interface ValidationResult {
  valid: boolean
  entryErrors: Map<string, EntryError[]>  // keyed by entry.id
  globalErrors: string[]
}

export function validateBatchEntries(entries: EmployeeEntry[]): ValidationResult {
  const entryErrors = new Map<string, EntryError[]>()
  const globalErrors: string[] = []
  const seenAddresses = new Map<string, string>() // address -> first entry name

  if (entries.length === 0) {
    globalErrors.push('Add at least one employee.')
  }

  for (const entry of entries) {
    const errors: EntryError[] = []

    if (!entry.name.trim()) {
      errors.push({ field: 'name', message: 'Name is required.' })
    }

    if (!entry.walletAddress.trim()) {
      errors.push({ field: 'walletAddress', message: 'Wallet address is required.' })
    } else if (!/^0x[0-9a-fA-F]{40}$/.test(entry.walletAddress.trim())) {
      errors.push({ field: 'walletAddress', message: 'Invalid Ethereum address.' })
    } else {
      const lower = entry.walletAddress.toLowerCase()
      if (seenAddresses.has(lower)) {
        errors.push({
          field: 'walletAddress',
          message: `Duplicate address (same as ${seenAddresses.get(lower)}).`,
        })
      } else {
        seenAddresses.set(lower, entry.name.trim() || 'unnamed entry')
      }
    }

    if (!entry.amountUsdc.trim()) {
      errors.push({ field: 'amountUsdc', message: 'Amount is required.' })
    } else {
      try {
        const raw = parseUsdcString(entry.amountUsdc)
        if (raw <= 0n) errors.push({ field: 'amountUsdc', message: 'Amount must be greater than 0.' })
      } catch {
        errors.push({ field: 'amountUsdc', message: 'Invalid amount. Use decimal format (e.g. 500.00).' })
      }
    }

    if (errors.length > 0) entryErrors.set(entry.id, errors)
  }

  return {
    valid: entryErrors.size === 0 && globalErrors.length === 0,
    entryErrors,
    globalErrors,
  }
}

// ─── Derived batch stats ───────────────────────────────────────────────────────

export interface BatchStats {
  totalRaw: bigint
  totalFormatted: string
  employeeCount: number
  confirmedCount: number
  failedCount: number
  pendingCount: number
}

export function getBatchStats(batch: PayrollBatch): BatchStats {
  const totalRaw = batch.payments.reduce((acc, p) => {
    try { return acc + parseUsdcString(p.amountUsdc) } catch { return acc }
  }, 0n)
  return {
    totalRaw,
    totalFormatted: formatUsdcBigint(totalRaw),
    employeeCount: batch.payments.length,
    confirmedCount: batch.payments.filter(p => p.status === 'confirmed').length,
    failedCount: batch.payments.filter(p => p.status === 'failed').length,
    pendingCount: batch.payments.filter(p => p.status === 'pending' || p.status === 'processing').length,
  }
}

export function deriveBatchStatus(payments: EmployeePayment[]): BatchStatus {
  if (payments.length === 0) return 'draft'
  const allConfirmed = payments.every(p => p.status === 'confirmed')
  const allFailed = payments.every(p => p.status === 'failed')
  const anyProcessing = payments.some(p => p.status === 'processing')
  const anyConfirmed = payments.some(p => p.status === 'confirmed')
  const anyFailed = payments.some(p => p.status === 'failed')

  if (allConfirmed) return 'completed'
  if (allFailed) return 'failed'
  if (anyProcessing) return 'processing'
  if (anyConfirmed && anyFailed) return 'partial'
  return 'processing'
}

// ─── Status display helpers ────────────────────────────────────────────────────

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  processing: 'Processing',
  completed: 'Completed',
  partial: 'Partial',
  failed: 'Failed',
}

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'active'

export function batchStatusVariant(status: BatchStatus): BadgeVariant {
  if (status === 'completed') return 'success'
  if (status === 'partial') return 'warning'
  if (status === 'failed') return 'danger'
  if (status === 'processing') return 'active'
  return 'neutral'
}

export function paymentStatusVariant(status: PaymentStatus): BadgeVariant {
  if (status === 'confirmed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'processing') return 'active'
  return 'neutral'
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const STORAGE_KEY = 'askirawafi_payroll_batches_v1'

export function loadBatches(): PayrollBatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PayrollBatch[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveBatches(batches: PayrollBatch[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(batches))
}

export function upsertBatch(batches: PayrollBatch[], batch: PayrollBatch): PayrollBatch[] {
  const idx = batches.findIndex(b => b.id === batch.id)
  if (idx === -1) return [...batches, batch]
  const next = [...batches]
  next[idx] = batch
  return next
}

// ─── ID generator ─────────────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function formatBatchId(id: string): string {
  return `PAY-${id.split('-')[0].toUpperCase()}`
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
