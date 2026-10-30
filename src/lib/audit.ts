/**
 * Askirawa Finance — Audit Log
 *
 * DISCLOSURE:
 * Audit entries are stored in browser localStorage. They are NOT tamper-proof,
 * cryptographically signed, or independently verified. Anyone controlling this
 * browser can modify or delete them. This is an application-level activity record,
 * not an on-chain immutable audit trail.
 *
 * On-chain confirmed events are identified by a txHash recorded at the time the
 * existing transaction flows received a successful receipt. Events without a txHash
 * are local application actions only.
 *
 * Never log private keys, seed phrases, signing secrets, or other credentials.
 */

// ─── Event categories and actions ────────────────────────────────────────────

export type AuditCategory =
  | 'payroll'
  | 'recurring'
  | 'approval'
  | 'organization'
  | 'transaction'
  | 'analytics'
  | 'system'

export type AuditAction =
  // Payroll
  | 'payroll_batch_created'
  | 'payroll_batch_submitted'
  | 'payroll_batch_approved'
  | 'payroll_batch_started'
  | 'payroll_batch_executed'
  | 'payroll_payment_confirmed'
  | 'payroll_payment_failed'
  // Recurring
  | 'recurring_schedule_created'
  | 'recurring_schedule_paused'
  | 'recurring_schedule_resumed'
  | 'recurring_schedule_cancelled'
  | 'recurring_execution_submitted'
  | 'recurring_execution_confirmed'
  | 'recurring_execution_failed'
  // Approvals
  | 'approval_request_created'
  | 'approval_decision_approved'
  | 'approval_decision_rejected'
  | 'approval_threshold_reached'
  | 'approval_request_sending'
  | 'approval_send_cancelled'
  | 'approval_request_executed'
  | 'approval_request_cancelled'
  | 'approval_request_failed'
  // Organization
  | 'org_created'
  | 'org_updated'
  | 'org_deleted'
  | 'member_invited'
  | 'member_accepted'
  | 'member_declined'
  | 'member_role_changed'
  | 'member_removed'
  // Transactions
  | 'tx_submitted'
  | 'tx_confirmed'
  | 'tx_failed'
  // Analytics / exports
  | 'csv_exported'
  | 'audit_log_exported'
  // System
  | 'app_initialized'

export type AuditOutcome = 'success' | 'failure' | 'pending' | 'info'

export interface AuditEntry {
  /** Stable unique ID — never reused */
  id: string
  /** Unix ms timestamp */
  timestamp: number
  category: AuditCategory
  action: AuditAction
  /** Connected wallet address at the time of the action, or null if unavailable */
  actorAddress: string | null
  /** Human-readable description — must never include secrets */
  description: string
  outcome: AuditOutcome
  /** Payroll batch id, schedule id, request id, org id, etc. */
  entityId?: string
  /** Human-readable entity name */
  entityLabel?: string
  /** Confirmed on-chain transaction hash */
  txHash?: string
  /** Organization context if available */
  orgId?: string
  /** Additional structured metadata — no secrets */
  meta?: Record<string, string | number | boolean | null>
}

// ─── ID generation ────────────────────────────────────────────────────────────

export function generateAuditId(): string {
  return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const STORAGE_KEY = 'askirawafi_audit_log_v1'
const MAX_ENTRIES = 2000 // cap to avoid localStorage bloat

export function loadAuditLog(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AuditEntry[]) : []
  } catch {
    return []
  }
}

export function saveAuditLog(entries: AuditEntry[]): void {
  // Keep most recent MAX_ENTRIES; oldest entries are evicted first
  const capped = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
  } catch {
    // localStorage may be full — silently skip rather than crashing
  }
}

/**
 * Append a new entry. Returns the updated log.
 * Deduplication: if an entry with the same id already exists, skips it.
 */
export function appendAuditEntry(entry: AuditEntry): AuditEntry[] {
  const existing = loadAuditLog()
  if (existing.some(e => e.id === entry.id)) return existing
  const next = [...existing, entry]
  saveAuditLog(next)
  return next
}

// ─── Factory helper ───────────────────────────────────────────────────────────

export function createAuditEntry(
  fields: Omit<AuditEntry, 'id' | 'timestamp'>
): AuditEntry {
  return {
    id: generateAuditId(),
    timestamp: Date.now(),
    ...fields,
  }
}

/** Convenience: create and immediately persist an audit entry. Returns the entry. */
export function logAuditEvent(fields: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
  const entry = createAuditEntry(fields)
  appendAuditEntry(entry)
  return entry
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  payroll: 'Payroll',
  recurring: 'Recurring',
  approval: 'Approvals',
  organization: 'Organization',
  transaction: 'Transaction',
  analytics: 'Analytics',
  system: 'System',
}

export const ACTION_LABELS: Record<AuditAction, string> = {
  payroll_batch_created: 'Batch created',
  payroll_batch_submitted: 'Sent for approval',
  payroll_batch_approved: 'Approval recorded',
  payroll_batch_started: 'Batch started',
  payroll_batch_executed: 'Batch sent',
  payroll_payment_confirmed: 'Payment confirmed',
  payroll_payment_failed: 'Payment failed',
  recurring_schedule_created: 'Schedule created',
  recurring_schedule_paused: 'Schedule paused',
  recurring_schedule_resumed: 'Schedule resumed',
  recurring_schedule_cancelled: 'Schedule cancelled',
  recurring_execution_submitted: 'Sent for approval',
  recurring_execution_confirmed: 'Payment confirmed',
  recurring_execution_failed: 'Payment failed',
  approval_request_created: 'Request created',
  approval_decision_approved: 'Approved',
  approval_decision_rejected: 'Rejected',
  approval_threshold_reached: 'Fully approved',
  approval_request_sending: 'Sending payment',
  approval_send_cancelled: 'Send cancelled',
  approval_request_executed: 'Request sent',
  approval_request_cancelled: 'Request cancelled',
  approval_request_failed: 'Transfer failed',
  org_created: 'Organization created',
  org_updated: 'Organization updated',
  org_deleted: 'Organization deleted',
  member_invited: 'Member invited',
  member_accepted: 'Invitation accepted',
  member_declined: 'Invitation declined',
  member_role_changed: 'Role changed',
  member_removed: 'Member removed',
  tx_submitted: 'Transaction submitted',
  tx_confirmed: 'Transaction confirmed',
  tx_failed: 'Transaction failed',
  csv_exported: 'CSV exported',
  audit_log_exported: 'Audit log exported',
  app_initialized: 'App started',
}

export const OUTCOME_LABELS: Record<AuditOutcome, string> = {
  success: 'Success',
  failure: 'Failed',
  pending: 'Pending',
  info: 'Info',
}

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'active'

export function outcomeVariant(outcome: AuditOutcome): BadgeVariant {
  if (outcome === 'success') return 'success'
  if (outcome === 'failure') return 'danger'
  if (outcome === 'pending') return 'warning'
  return 'neutral'
}

export function formatAuditTs(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export function formatAuditId(id: string): string {
  return id.slice(0, 16).toUpperCase()
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value)
  // Strip formula-injection prefixes
  const stripped = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  if (stripped.includes(',') || stripped.includes('"') || stripped.includes('\n')) {
    return `"${stripped.replace(/"/g, '""')}"`
  }
  return stripped
}

const AUDIT_CSV_HEADERS = [
  'Entry ID', 'Timestamp', 'Category', 'Action', 'Outcome',
  'Actor Address', 'Description', 'Entity ID', 'Entity Label',
  'Transaction Hash', 'Organization ID',
]

export function auditEntriesToCsv(entries: AuditEntry[]): string {
  const lines: string[] = [AUDIT_CSV_HEADERS.join(',')]
  for (const e of entries) {
    lines.push([
      csvEscape(e.id),
      csvEscape(formatAuditTs(e.timestamp)),
      csvEscape(CATEGORY_LABELS[e.category]),
      csvEscape(ACTION_LABELS[e.action]),
      csvEscape(OUTCOME_LABELS[e.outcome]),
      csvEscape(e.actorAddress ?? 'Unknown'),
      csvEscape(e.description),
      csvEscape(e.entityId ?? ''),
      csvEscape(e.entityLabel ?? ''),
      csvEscape(e.txHash ?? ''),
      csvEscape(e.orgId ?? ''),
    ].join(','))
  }
  return lines.join('\r\n')
}

export function downloadAuditCsv(entries: AuditEntry[], filename?: string): void {
  const csv = auditEntriesToCsv(entries)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `askirawa-finance-audit-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
