/**
 * AskirawaFi — Treasury Analytics & Reports
 *
 * DATA SOURCE NOTES:
 * ─────────────────────────────────────────────────────────────────────────────
 * All transaction records are sourced from browser localStorage via the
 * payroll, recurring, and approvals libs. They are application-level records,
 * NOT independently verified on-chain data.
 *
 * A record is labeled "on-chain confirmed" only when:
 *   - It has a txHash (transaction hash from a real ERC-20 transfer() call), AND
 *   - Its status is 'confirmed' / 'completed' / 'executed'.
 *
 * Records without a txHash (drafts, pending approvals, scheduled-but-not-run
 * recurring payments) are clearly distinguished as application-level records.
 *
 * Historical on-chain analytics (e.g. all USDC transfers ever received by the
 * treasury wallet) require an event indexer, blockchain explorer API, or RPC
 * eth_getLogs scan — none of which exist in this application today. This is
 * noted in the UI and documented below.
 *
 * MISSING INFRASTRUCTURE for complete historical analytics:
 *   1. An event indexer (subgraph, Envio, or custom) to index Transfer events
 *      on the Arc Mainnet USDC contract for the treasury wallet address.
 *   2. An API to query that index by wallet address and date range.
 *   3. A backend service to correlate on-chain transfers with application records.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PayrollBatch } from './payroll'
import type { RecurringSchedule } from './recurring'
import type { ApprovalRequest } from './approvals'

// ─── Date range ───────────────────────────────────────────────────────────────

export type DateRangePreset =
  | 'last7'
  | 'last30'
  | 'last90'
  | 'thisMonth'
  | 'prevMonth'
  | 'custom'

export interface DateRange {
  preset: DateRangePreset
  from: number   // unix ms (inclusive)
  to: number     // unix ms (inclusive, end of day)
}

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  last90: 'Last 90 days',
  thisMonth: 'This month',
  prevMonth: 'Previous month',
  custom: 'Custom range',
}

export function buildDateRange(preset: DateRangePreset, customFrom?: string, customTo?: string): DateRange {
  const now = new Date()
  const endOfDay = (d: Date): number => {
    d.setHours(23, 59, 59, 999)
    return d.getTime()
  }
  const startOfDay = (d: Date): number => {
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  switch (preset) {
    case 'last7': {
      const from = new Date(now)
      from.setDate(from.getDate() - 6)
      return { preset, from: startOfDay(from), to: endOfDay(new Date(now)) }
    }
    case 'last30': {
      const from = new Date(now)
      from.setDate(from.getDate() - 29)
      return { preset, from: startOfDay(from), to: endOfDay(new Date(now)) }
    }
    case 'last90': {
      const from = new Date(now)
      from.setDate(from.getDate() - 89)
      return { preset, from: startOfDay(from), to: endOfDay(new Date(now)) }
    }
    case 'thisMonth': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { preset, from: startOfDay(from), to: endOfDay(to) }
    }
    case 'prevMonth': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const to = new Date(now.getFullYear(), now.getMonth(), 0)
      return { preset, from: startOfDay(from), to: endOfDay(to) }
    }
    case 'custom': {
      const from = customFrom ? new Date(customFrom) : new Date(now.getFullYear(), now.getMonth(), 1)
      const to = customTo ? new Date(customTo) : new Date(now)
      return { preset, from: startOfDay(from), to: endOfDay(to) }
    }
  }
}

// ─── Unified transaction record ───────────────────────────────────────────────

export type TxCategory = 'payroll' | 'recurring' | 'approval_transfer' | 'automation'
export type TxDirection = 'outgoing' | 'incoming' | 'unknown'
export type TxVerification = 'on_chain_confirmed' | 'submitted_unconfirmed' | 'local_only'

export interface AnalyticsTx {
  /** Stable dedup key — txHash when available, else synthetic id */
  key: string
  /** Source record ID */
  sourceId: string
  category: TxCategory
  /** Human label: batch name, schedule name, etc. */
  label: string
  timestamp: number          // unix ms — execution/confirmation time where known; else creation time
  direction: TxDirection
  amountUsdc: string         // raw string, bigint-parseable
  status: TxVerification
  /** Confirmed on-chain status text */
  onChainStatus: string
  /** The wallet that sent (where known) */
  fromAddress?: string
  /** The wallet that received */
  toAddress?: string
  txHash?: string
  /** Explorer URL */
  explorerUrl?: string
  /** Linked record ref */
  batchId?: string
  scheduleId?: string
  requestId?: string
}

// ─── Explorer URL helper ──────────────────────────────────────────────────────

const ARC_MAINNET_EXPLORER = 'https://explorer.arc.io'

export function arcExplorerTxUrl(hash: string): string {
  return `${ARC_MAINNET_EXPLORER}/tx/${hash}`
}

// ─── Payroll → AnalyticsTx ────────────────────────────────────────────────────

export function payrollToTxRecords(batches: PayrollBatch[]): AnalyticsTx[] {
  const records: AnalyticsTx[] = []

  for (const batch of batches) {
    for (const payment of batch.payments) {
      // Only include payments that have been attempted (have a status beyond 'pending' w/ no tx)
      // Draft batches with no activity are excluded
      if (batch.status === 'draft' && !payment.txHash) continue

      const p = payment
      const isConfirmed = p.status === 'confirmed'
      const isFailed = p.status === 'failed'
      const isProcessing = p.status === 'processing'

      let verification: TxVerification = 'local_only'
      let onChainStatus = 'Local record'

      if (p.txHash && isConfirmed) {
        verification = 'on_chain_confirmed'
        onChainStatus = 'Confirmed on Arc Mainnet'
      } else if (p.txHash && (isProcessing || isFailed)) {
        verification = 'submitted_unconfirmed'
        onChainStatus = isFailed ? 'Failed on-chain' : 'Submitted — awaiting confirmation'
      }

      const ts = p.confirmedAt ?? batch.submittedAt ?? batch.createdAt

      records.push({
        key: p.txHash ?? `payroll-${batch.id}-${p.id}`,
        sourceId: p.id,
        category: 'payroll',
        label: `${batch.name} — ${p.name}`,
        timestamp: ts,
        direction: 'outgoing',
        amountUsdc: p.amountUsdc,
        status: verification,
        onChainStatus,
        fromAddress: batch.createdBy,
        toAddress: p.walletAddress,
        txHash: p.txHash,
        explorerUrl: p.txHash ? arcExplorerTxUrl(p.txHash) : undefined,
        batchId: batch.id,
      })
    }
  }

  return records
}

// ─── Recurring → AnalyticsTx ──────────────────────────────────────────────────

export function recurringToTxRecords(schedules: RecurringSchedule[]): AnalyticsTx[] {
  const records: AnalyticsTx[] = []

  for (const schedule of schedules) {
    for (const exec of schedule.executionHistory) {
      const e = exec
      if (e.status === 'pending') continue  // not yet attempted

      let verification: TxVerification = 'local_only'
      let onChainStatus = 'Local record'

      if (e.txHash && e.status === 'confirmed') {
        verification = 'on_chain_confirmed'
        onChainStatus = 'Confirmed on Arc Mainnet'
      } else if (e.txHash && e.status === 'processing') {
        verification = 'submitted_unconfirmed'
        onChainStatus = 'Submitted — awaiting confirmation'
      } else if (e.status === 'failed') {
        onChainStatus = e.txHash ? 'Failed on-chain' : 'Execution failed'
        if (e.txHash) verification = 'submitted_unconfirmed'
      }

      const ts = e.executedAt ?? e.scheduledFor

      records.push({
        key: e.txHash ?? `recurring-${schedule.id}-${e.id}`,
        sourceId: e.id,
        category: 'recurring',
        label: `${schedule.name}`,
        timestamp: ts,
        direction: 'outgoing',
        amountUsdc: e.amountUsdc,
        status: verification,
        onChainStatus,
        fromAddress: schedule.createdBy,
        toAddress: schedule.recipientAddress,
        txHash: e.txHash,
        explorerUrl: e.txHash ? arcExplorerTxUrl(e.txHash) : undefined,
        scheduleId: schedule.id,
      })
    }
  }

  return records
}

// ─── Approvals → AnalyticsTx ──────────────────────────────────────────────────

export function approvalsToTxRecords(requests: ApprovalRequest[]): AnalyticsTx[] {
  const records: AnalyticsTx[] = []

  for (const req of requests) {
    // Only include if execution was attempted
    if (req.status !== 'executed' && req.status !== 'failed' && req.status !== 'executing') continue

    const isConfirmed = req.status === 'executed' && !!req.txHash && !!req.confirmedAt
    const isFailed = req.status === 'failed'

    let verification: TxVerification = 'local_only'
    let onChainStatus = 'Local record'

    if (isConfirmed) {
      verification = 'on_chain_confirmed'
      onChainStatus = 'Confirmed on Arc Mainnet'
    } else if (req.txHash) {
      verification = 'submitted_unconfirmed'
      onChainStatus = isFailed ? 'Failed on-chain' : 'Submitted — awaiting confirmation'
    }

    const ts = req.confirmedAt ?? req.updatedAt ?? req.createdAt

    records.push({
      key: req.txHash ?? `approval-${req.id}`,
      sourceId: req.id,
      category: 'approval_transfer',
      label: req.title,
      timestamp: ts,
      direction: 'outgoing',
      amountUsdc: req.amountUsdc,
      status: verification,
      onChainStatus,
      fromAddress: req.requesterAddress,
      toAddress: req.recipientAddress,
      txHash: req.txHash,
      explorerUrl: req.txHash ? arcExplorerTxUrl(req.txHash) : undefined,
      requestId: req.id,
    })
  }

  return records
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Merge records from multiple sources, deduplicating by txHash.
 * When two records share the same txHash (e.g. a payroll payment and an
 * approval request both recorded the same hash), keep the one with the
 * richer verification status.
 */
export function deduplicateTxRecords(records: AnalyticsTx[]): AnalyticsTx[] {
  const byKey = new Map<string, AnalyticsTx>()

  for (const r of records) {
    const existing = byKey.get(r.key)
    if (!existing) {
      byKey.set(r.key, r)
      continue
    }
    // Keep the record with more complete verification
    const priority = { on_chain_confirmed: 2, submitted_unconfirmed: 1, local_only: 0 }
    if ((priority[r.status] ?? 0) > (priority[existing.status] ?? 0)) {
      byKey.set(r.key, r)
    }
  }

  return Array.from(byKey.values())
}

// ─── Filtering ────────────────────────────────────────────────────────────────

export type TxFilter = {
  dateRange: DateRange
  category: TxCategory | 'all'
  direction: TxDirection | 'all'
  status: TxVerification | 'all'
  search: string
}

export function filterTxRecords(records: AnalyticsTx[], filter: TxFilter): AnalyticsTx[] {
  return records.filter(r => {
    if (r.timestamp < filter.dateRange.from || r.timestamp > filter.dateRange.to) return false
    if (filter.category !== 'all' && r.category !== filter.category) return false
    if (filter.direction !== 'all' && r.direction !== filter.direction) return false
    if (filter.status !== 'all' && r.status !== filter.status) return false
    if (filter.search.trim()) {
      const q = filter.search.toLowerCase()
      const match =
        r.txHash?.toLowerCase().includes(q) ||
        r.toAddress?.toLowerCase().includes(q) ||
        r.fromAddress?.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.amountUsdc.includes(q)
      if (!match) return false
    }
    return true
  })
}

// ─── Summary metrics ──────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  /** All filtered records, deduplicated */
  records: AnalyticsTx[]
  /** Bigint totals */
  totalOutgoingRaw: bigint
  totalIncomingRaw: bigint
  netFlowRaw: bigint
  payrollOutgoingRaw: bigint
  recurringOutgoingRaw: bigint
  approvalOutgoingRaw: bigint
  /** Counts */
  confirmedCount: number
  pendingCount: number
  failedCount: number
  totalCount: number
}

const USDC_DECIMALS = 6

export function parseUsdcSafe(value: string): bigint {
  try {
    const trimmed = value.trim()
    if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return 0n
    const [whole, frac = ''] = trimmed.split('.')
    const fracPadded = frac.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, '0')
    return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded)
  } catch {
    return 0n
  }
}

export function formatUsdcBigint(raw: bigint): string {
  if (raw < 0n) return `-${formatUsdcBigint(-raw)}`
  const divisor = BigInt(10 ** USDC_DECIMALS)
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '') || '0'
  const wholeFormatted = Number(whole).toLocaleString('en-US')
  return `${wholeFormatted}.${fracStr}`
}

export function computeSummary(filteredRecords: AnalyticsTx[]): AnalyticsSummary {
  let totalOutgoingRaw = 0n
  let totalIncomingRaw = 0n
  let payrollOutgoingRaw = 0n
  let recurringOutgoingRaw = 0n
  let approvalOutgoingRaw = 0n
  let confirmedCount = 0
  let pendingCount = 0
  let failedCount = 0

  for (const r of filteredRecords) {
    const amt = parseUsdcSafe(r.amountUsdc)
    if (r.direction === 'outgoing') totalOutgoingRaw += amt
    if (r.direction === 'incoming') totalIncomingRaw += amt

    if (r.direction === 'outgoing') {
      if (r.category === 'payroll') payrollOutgoingRaw += amt
      if (r.category === 'recurring') recurringOutgoingRaw += amt
      if (r.category === 'approval_transfer') approvalOutgoingRaw += amt
    }

    if (r.status === 'on_chain_confirmed') confirmedCount++
    else if (r.status === 'submitted_unconfirmed') pendingCount++
    else failedCount++ // local_only records are neither confirmed nor pending
  }

  return {
    records: filteredRecords,
    totalOutgoingRaw,
    totalIncomingRaw,
    netFlowRaw: totalIncomingRaw - totalOutgoingRaw,
    payrollOutgoingRaw,
    recurringOutgoingRaw,
    approvalOutgoingRaw,
    confirmedCount,
    pendingCount,
    failedCount,
    totalCount: filteredRecords.length,
  }
}

// ─── Time-series chart data ───────────────────────────────────────────────────

export interface DailyBucket {
  date: string    // YYYY-MM-DD
  outgoing: bigint
  incoming: bigint
  payroll: bigint
  recurring: bigint
}

/**
 * Build daily buckets for a set of records within a date range.
 * Used for the cash flow bar chart.
 */
export function buildDailyBuckets(records: AnalyticsTx[], range: DateRange): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>()

  // Pre-populate all days in the range
  const cursor = new Date(range.from)
  const end = new Date(range.to)
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10)
    buckets.set(key, { date: key, outgoing: 0n, incoming: 0n, payroll: 0n, recurring: 0n })
    cursor.setDate(cursor.getDate() + 1)
  }

  for (const r of records) {
    const key = new Date(r.timestamp).toISOString().slice(0, 10)
    const bucket = buckets.get(key)
    if (!bucket) continue
    const amt = parseUsdcSafe(r.amountUsdc)
    if (r.direction === 'outgoing') {
      bucket.outgoing += amt
      if (r.category === 'payroll') bucket.payroll += amt
      if (r.category === 'recurring') bucket.recurring += amt
    } else if (r.direction === 'incoming') {
      bucket.incoming += amt
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Category breakdown ───────────────────────────────────────────────────────

export interface CategorySlice {
  category: TxCategory | 'incoming'
  label: string
  amountRaw: bigint
  count: number
  color: string
}

export function buildCategoryBreakdown(records: AnalyticsTx[]): CategorySlice[] {
  const map = new Map<string, CategorySlice>()

  const colors: Record<string, string> = {
    payroll: 'var(--accent)',
    recurring: '#6366f1',
    approval_transfer: '#f59e0b',
    automation: '#8b5cf6',
    incoming: '#22c55e',
  }

  const labels: Record<string, string> = {
    payroll: 'Payroll',
    recurring: 'Recurring',
    approval_transfer: 'Treasury Transfer',
    automation: 'Automation',
    incoming: 'Incoming',
  }

  for (const r of records) {
    const key = r.direction === 'incoming' ? 'incoming' : r.category
    const existing = map.get(key)
    const amt = parseUsdcSafe(r.amountUsdc)
    if (existing) {
      existing.amountRaw += amt
      existing.count++
    } else {
      map.set(key, {
        category: key,
        label: labels[key] ?? key,
        amountRaw: amt,
        count: 1,
        color: colors[key] ?? 'var(--subtle)',
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => Number(b.amountRaw - a.amountRaw))
}

// ─── CSV export ───────────────────────────────────────────────────────────────

/**
 * Sanitize a cell value for CSV output:
 * - Wrap in quotes if it contains commas, quotes, or newlines.
 * - Escape internal double-quotes by doubling them.
 * - Prefix with a single quote if it starts with =, +, -, @, TAB, CR
 *   to prevent spreadsheet formula injection.
 */
export function csvCell(value: string | number | undefined | null): string {
  const str = value == null ? '' : String(value)
  // Formula injection prevention
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str
  // Quote if necessary
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

export interface CsvExportOptions {
  records: AnalyticsTx[]
  rangeLabel: string
  fromLabel: string
  toLabel: string
  summary: AnalyticsSummary
}

export function generateTransactionCsv(opts: CsvExportOptions): string {
  const { records, summary, rangeLabel, fromLabel, toLabel } = opts

  const lines: string[] = []

  // Summary header block
  lines.push(`# AskirawaFi Treasury Analytics Report`)
  lines.push(`# Period: ${rangeLabel} (${fromLabel} to ${toLabel})`)
  lines.push(`# Generated: ${new Date().toISOString()}`)
  lines.push(`# Note: "On-chain confirmed" records have a txHash verified on Arc Mainnet.`)
  lines.push(`#       "Local record" records exist only in browser localStorage.`)
  lines.push('')
  lines.push('## Summary')
  lines.push(`Total Outgoing USDC,${formatUsdcBigint(summary.totalOutgoingRaw)}`)
  lines.push(`Total Incoming USDC,${formatUsdcBigint(summary.totalIncomingRaw)}`)
  lines.push(`Net Cash Flow,${formatUsdcBigint(summary.netFlowRaw)}`)
  lines.push(`Payroll Expenditure,${formatUsdcBigint(summary.payrollOutgoingRaw)}`)
  lines.push(`Recurring Payments,${formatUsdcBigint(summary.recurringOutgoingRaw)}`)
  lines.push(`Treasury Transfers,${formatUsdcBigint(summary.approvalOutgoingRaw)}`)
  lines.push(`Confirmed Transactions,${summary.confirmedCount}`)
  lines.push(`Pending Transactions,${summary.pendingCount}`)
  lines.push(`Local Records Only,${summary.totalCount - summary.confirmedCount - summary.pendingCount}`)
  lines.push('')

  // Transaction detail
  lines.push('## Transaction Detail')
  const headers = [
    'Date',
    'Time',
    'Category',
    'Description',
    'Direction',
    'Amount (USDC)',
    'From Address',
    'To Address',
    'Status',
    'Verification',
    'Transaction Hash',
    'Batch / Schedule Ref',
  ]
  lines.push(headers.map(csvCell).join(','))

  for (const r of records) {
    const dt = new Date(r.timestamp)
    const dateStr = dt.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
    const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

    const categoryLabel: Record<TxCategory, string> = {
      payroll: 'Payroll',
      recurring: 'Recurring Payment',
      approval_transfer: 'Treasury Transfer',
      automation: 'Automation',
    }

    const verificationLabel: Record<TxVerification, string> = {
      on_chain_confirmed: 'On-chain confirmed',
      submitted_unconfirmed: 'Submitted (unconfirmed)',
      local_only: 'Local record only',
    }

    const ref = r.batchId
      ? `PAY-${r.batchId.split('-')[0].toUpperCase()}`
      : r.scheduleId
        ? `REC-${r.scheduleId.split('-')[0].toUpperCase()}`
        : r.requestId
          ? `APR-${r.requestId.split('-')[0].toUpperCase()}`
          : ''

    lines.push([
      csvCell(dateStr),
      csvCell(timeStr),
      csvCell(categoryLabel[r.category] ?? r.category),
      csvCell(r.label),
      csvCell(r.direction),
      csvCell(formatUsdcBigint(parseUsdcSafe(r.amountUsdc))),
      csvCell(r.fromAddress ?? ''),
      csvCell(r.toAddress ?? ''),
      csvCell(r.onChainStatus),
      csvCell(verificationLabel[r.status]),
      csvCell(r.txHash ?? ''),
      csvCell(ref),
    ].join(','))
  }

  return lines.join('\r\n')  // RFC 4180: CRLF line endings
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
