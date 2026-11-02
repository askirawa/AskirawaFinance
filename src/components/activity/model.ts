import { formatUsdc } from '../../onchain-money'
import { ACTION_LABEL } from '../../chain/format'
import type { ActivityItem, ActivityKind } from '../../chain/history'

export type Filter = 'all' | 'payments' | 'requests' | 'approvals' | 'recurring'

export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'payments', label: 'Payments' }, { id: 'requests', label: 'Requests' },
  { id: 'approvals', label: 'Approvals' }, { id: 'recurring', label: 'Recurring' },
]

const KINDS: Record<Exclude<Filter, 'all'>, ActivityKind[]> = {
  payments: ['payment', 'schedule-payment'],
  requests: ['request', 'cancelled', 'rejected'],
  approvals: ['vote'],
  recurring: ['schedule-payment', 'schedule-failed'],
}

export const matches = (item: ActivityItem, f: Filter) => f === 'all' || KINDS[f].includes(item.kind)

const FAIL_REASON: Record<string, string> = {
  '0': 'the treasury was paused', '1': 'the spending limit was reached', '2': 'the treasury did not have enough funds',
  '3': 'the USDC transfer was refused', '4': 'a condition was not met', '5': 'another reason',
}

export function titleOf(item: ActivityItem): string {
  const n = item.requestId
  switch (item.kind) {
    case 'funds-added': return 'Funds added'
    case 'request': return `Request #${n} submitted`
    case 'vote': return item.detail === 'approved' ? 'Approval recorded' : 'Rejection recorded'
    case 'payment': return item.detail && item.detail !== '1' ? `Request #${n} carried out` : `Payment confirmed (request #${n})`
    case 'cancelled': return `Request #${n} cancelled`
    case 'rejected': return `Request #${n} rejected`
    case 'schedule-payment': return 'Recurring payment confirmed'
    case 'schedule-failed': return 'Recurring payment attempt failed'
    case 'paused': return 'Treasury paused'
    case 'resumed': return 'Treasury resumed'
  }
}

/** Secondary line: the kind of request, or the reason a recurring attempt failed. */
export function detailOf(item: ActivityItem): string | null {
  if ((item.kind === 'request' || item.kind === 'payment') && item.detail) return ACTION_LABEL[Number(item.detail)] ?? null
  if (item.kind === 'vote') return item.requestId ? `On request #${item.requestId}` : null
  if (item.kind === 'schedule-failed') return `Reason: ${FAIL_REASON[item.detail ?? '5'] ?? 'another reason'}`
  if (item.kind === 'schedule-payment' && item.scheduleId) return `Schedule #${item.scheduleId}`
  if (item.kind === 'resumed' && item.requestId) return `Approved in request #${item.requestId}`
  return null
}

const WHO_LABEL: Partial<Record<ActivityKind, string>> = {
  'funds-added': 'From', request: 'Submitted by', vote: 'By', cancelled: 'By', paused: 'By', 'schedule-payment': 'Triggered by',
}

export const whoLabel = (k: ActivityKind) => WHO_LABEL[k]

const csvCell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(items: ActivityItem[]): string {
  const rows = items.map((i) => [
    i.timestamp !== undefined ? new Date(i.timestamp * 1000).toISOString() : `Block ${i.blockNumber}`,
    titleOf(i),
    i.amount !== undefined ? formatUsdc(i.amount) : '',
    i.counterparty ?? i.actor ?? '',
    i.txHash,
  ])
  return [['Date', 'Type', 'Amount (USDC)', 'Address', 'Transaction hash'], ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

export function downloadCsv(items: ActivityItem[]) {
  const url = URL.createObjectURL(new Blob([toCsv(items)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'askirawa-activity.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
