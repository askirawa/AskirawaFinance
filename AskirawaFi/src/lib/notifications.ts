/**
 * AskirawaFi — Notification System
 *
 * DISCLOSURE:
 * Notifications are stored in browser localStorage. They are application-level
 * records only — not delivered by email, SMS, push, or any external service.
 * They reflect actions taken in this browser session; they do not represent
 * messages sent to other users or confirmed by external infrastructure.
 *
 * Notification events are generated from actual application actions (batch
 * created, execution confirmed, approval submitted, etc.). A notification is
 * never generated before the underlying action has been recorded or a
 * transaction receipt confirmed.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationCategory =
  | 'payroll'
  | 'recurring'
  | 'approval'
  | 'organization'
  | 'transaction'
  | 'system'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

export interface AppNotification {
  id: string
  /** Unix ms timestamp */
  timestamp: number
  category: NotificationCategory
  severity: NotificationSeverity
  title: string
  description: string
  read: boolean
  /** Entity reference: batch id, schedule id, request id, org id, etc. */
  entityId?: string
  entityLabel?: string
  /** On-chain tx hash if applicable */
  txHash?: string
  /** Associated audit entry id */
  auditEntryId?: string
}

// ─── ID generation ────────────────────────────────────────────────────────────

export function generateNotifId(): string {
  return `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const STORAGE_KEY = 'askirawafi_notifications_v1'
const MAX_NOTIFICATIONS = 500

export function loadNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AppNotification[]) : []
  } catch {
    return []
  }
}

export function saveNotifications(notifications: AppNotification[]): void {
  const capped = notifications.length > MAX_NOTIFICATIONS
    ? notifications.slice(-MAX_NOTIFICATIONS)
    : notifications
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
  } catch {
    // localStorage full — skip silently
  }
}

/**
 * Append a notification. Skips if one with the same id already exists.
 * Returns the updated list.
 */
export function appendNotification(notif: AppNotification): AppNotification[] {
  const existing = loadNotifications()
  if (existing.some(n => n.id === notif.id)) return existing
  const next = [...existing, notif]
  saveNotifications(next)
  return next
}

// ─── Factory helper ───────────────────────────────────────────────────────────

export function createNotification(
  fields: Omit<AppNotification, 'id' | 'timestamp' | 'read'>
): AppNotification {
  return {
    id: generateNotifId(),
    timestamp: Date.now(),
    read: false,
    ...fields,
  }
}

/** Create and immediately persist a notification. Returns the notification. */
export function emitNotification(
  fields: Omit<AppNotification, 'id' | 'timestamp' | 'read'>
): AppNotification {
  const n = createNotification(fields)
  appendNotification(n)
  return n
}

// ─── Mutation helpers ─────────────────────────────────────────────────────────

export function markAsRead(notifications: AppNotification[], id: string): AppNotification[] {
  const next = notifications.map(n => n.id === id ? { ...n, read: true } : n)
  saveNotifications(next)
  return next
}

export function markAllAsRead(notifications: AppNotification[]): AppNotification[] {
  const next = notifications.map(n => ({ ...n, read: true }))
  saveNotifications(next)
  return next
}

export function clearNotification(notifications: AppNotification[], id: string): AppNotification[] {
  const next = notifications.filter(n => n.id !== id)
  saveNotifications(next)
  return next
}

export function clearAll(_notifications: AppNotification[]): AppNotification[] {
  saveNotifications([])
  return []
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  payroll: 'Payroll',
  recurring: 'Recurring',
  approval: 'Approvals',
  organization: 'Organization',
  transaction: 'Transaction',
  system: 'System',
}

export const SEVERITY_COLORS: Record<NotificationSeverity, string> = {
  info: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
}

export function formatNotifTs(ms: number): string {
  const now = Date.now()
  const diff = now - ms
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  const d = new Date(ms)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Pre-built notification generators ───────────────────────────────────────
// These are called from feature hooks at the action/result boundary.

export const Notify = {
  // ── Payroll ────────────────────────────────────────────────────────────────
  payrollBatchCreated(batchId: string, batchName: string): AppNotification {
    return emitNotification({
      category: 'payroll',
      severity: 'info',
      title: 'Payroll batch created',
      description: `"${batchName}" has been saved as a draft and is ready for review.`,
      entityId: batchId,
      entityLabel: batchName,
    })
  },
  payrollBatchExecuted(batchId: string, batchName: string, confirmedCount: number, failedCount: number): AppNotification {
    const severity: NotificationSeverity = failedCount > 0 ? (confirmedCount > 0 ? 'warning' : 'error') : 'success'
    return emitNotification({
      category: 'payroll',
      severity,
      title: failedCount === 0 ? 'Payroll batch completed' : 'Payroll batch partially completed',
      description: `"${batchName}": ${confirmedCount} confirmed, ${failedCount} failed.`,
      entityId: batchId,
      entityLabel: batchName,
    })
  },
  payrollPaymentConfirmed(batchId: string, batchName: string, employeeName: string, txHash: string): AppNotification {
    return emitNotification({
      category: 'payroll',
      severity: 'success',
      title: 'Payment confirmed',
      description: `Payment to ${employeeName} in batch "${batchName}" confirmed on Arc Mainnet.`,
      entityId: batchId,
      entityLabel: batchName,
      txHash,
    })
  },
  payrollPaymentFailed(batchId: string, batchName: string, employeeName: string, reason: string): AppNotification {
    return emitNotification({
      category: 'payroll',
      severity: 'error',
      title: 'Payment failed',
      description: `Payment to ${employeeName} in "${batchName}" failed: ${reason}`,
      entityId: batchId,
      entityLabel: batchName,
    })
  },

  // ── Recurring ──────────────────────────────────────────────────────────────
  recurringCreated(scheduleId: string, scheduleName: string): AppNotification {
    return emitNotification({
      category: 'recurring',
      severity: 'info',
      title: 'Recurring schedule created',
      description: `"${scheduleName}" is active and awaiting manual execution.`,
      entityId: scheduleId,
      entityLabel: scheduleName,
    })
  },
  recurringPaused(scheduleId: string, scheduleName: string): AppNotification {
    return emitNotification({
      category: 'recurring',
      severity: 'warning',
      title: 'Schedule paused',
      description: `Recurring schedule "${scheduleName}" has been paused.`,
      entityId: scheduleId,
      entityLabel: scheduleName,
    })
  },
  recurringResumed(scheduleId: string, scheduleName: string): AppNotification {
    return emitNotification({
      category: 'recurring',
      severity: 'info',
      title: 'Schedule resumed',
      description: `Recurring schedule "${scheduleName}" is active again.`,
      entityId: scheduleId,
      entityLabel: scheduleName,
    })
  },
  recurringCancelled(scheduleId: string, scheduleName: string): AppNotification {
    return emitNotification({
      category: 'recurring',
      severity: 'warning',
      title: 'Schedule cancelled',
      description: `Recurring schedule "${scheduleName}" has been cancelled. No future payments will execute.`,
      entityId: scheduleId,
      entityLabel: scheduleName,
    })
  },
  recurringExecutionConfirmed(scheduleId: string, scheduleName: string, amount: string, txHash: string): AppNotification {
    return emitNotification({
      category: 'recurring',
      severity: 'success',
      title: 'Recurring payment confirmed',
      description: `${amount} USDC sent via "${scheduleName}" and confirmed on Arc Mainnet.`,
      entityId: scheduleId,
      entityLabel: scheduleName,
      txHash,
    })
  },
  recurringExecutionFailed(scheduleId: string, scheduleName: string, reason: string): AppNotification {
    return emitNotification({
      category: 'recurring',
      severity: 'error',
      title: 'Recurring payment failed',
      description: `Execution of "${scheduleName}" failed: ${reason}`,
      entityId: scheduleId,
      entityLabel: scheduleName,
    })
  },

  // ── Approvals ──────────────────────────────────────────────────────────────
  approvalRequestCreated(requestId: string, title: string): AppNotification {
    return emitNotification({
      category: 'approval',
      severity: 'info',
      title: 'Approval request submitted',
      description: `"${title}" is pending approval.`,
      entityId: requestId,
      entityLabel: title,
    })
  },
  approvalDecisionApproved(requestId: string, title: string, approverAddr: string): AppNotification {
    return emitNotification({
      category: 'approval',
      severity: 'success',
      title: 'Request approved',
      description: `"${title}" was approved by ${approverAddr.slice(0, 8)}…`,
      entityId: requestId,
      entityLabel: title,
    })
  },
  approvalDecisionRejected(requestId: string, title: string, approverAddr: string): AppNotification {
    return emitNotification({
      category: 'approval',
      severity: 'error',
      title: 'Request rejected',
      description: `"${title}" was rejected by ${approverAddr.slice(0, 8)}…`,
      entityId: requestId,
      entityLabel: title,
    })
  },
  approvalThresholdReached(requestId: string, title: string): AppNotification {
    return emitNotification({
      category: 'approval',
      severity: 'success',
      title: 'Approval threshold reached',
      description: `"${title}" has all required approvals and is ready to execute.`,
      entityId: requestId,
      entityLabel: title,
    })
  },
  approvalExecuted(requestId: string, title: string, txHash: string): AppNotification {
    return emitNotification({
      category: 'approval',
      severity: 'success',
      title: 'Transfer executed',
      description: `"${title}" was executed and confirmed on Arc Mainnet.`,
      entityId: requestId,
      entityLabel: title,
      txHash,
    })
  },
  approvalCancelled(requestId: string, title: string): AppNotification {
    return emitNotification({
      category: 'approval',
      severity: 'warning',
      title: 'Request cancelled',
      description: `Approval request "${title}" has been cancelled.`,
      entityId: requestId,
      entityLabel: title,
    })
  },
  approvalFailed(requestId: string, title: string, reason: string): AppNotification {
    return emitNotification({
      category: 'approval',
      severity: 'error',
      title: 'Transfer failed',
      description: `"${title}" execution failed: ${reason}`,
      entityId: requestId,
      entityLabel: title,
    })
  },

  // ── Organization ───────────────────────────────────────────────────────────
  orgCreated(orgId: string, orgName: string): AppNotification {
    return emitNotification({
      category: 'organization',
      severity: 'info',
      title: 'Organization created',
      description: `"${orgName}" has been created. This is a local record — not on-chain verified.`,
      entityId: orgId,
      entityLabel: orgName,
    })
  },
  orgUpdated(orgId: string, orgName: string): AppNotification {
    return emitNotification({
      category: 'organization',
      severity: 'info',
      title: 'Organization updated',
      description: `"${orgName}" settings have been updated.`,
      entityId: orgId,
      entityLabel: orgName,
    })
  },
  memberInvited(orgId: string, orgName: string, walletAddress: string): AppNotification {
    return emitNotification({
      category: 'organization',
      severity: 'info',
      title: 'Member invited',
      description: `${walletAddress.slice(0, 8)}… was invited to "${orgName}". No email was sent — share the link manually.`,
      entityId: orgId,
      entityLabel: orgName,
    })
  },
  memberAccepted(orgId: string, orgName: string, walletAddress: string): AppNotification {
    return emitNotification({
      category: 'organization',
      severity: 'success',
      title: 'Invitation accepted',
      description: `${walletAddress.slice(0, 8)}… accepted their invitation to "${orgName}".`,
      entityId: orgId,
      entityLabel: orgName,
    })
  },
  memberDeclined(orgId: string, orgName: string, walletAddress: string): AppNotification {
    return emitNotification({
      category: 'organization',
      severity: 'warning',
      title: 'Invitation declined',
      description: `${walletAddress.slice(0, 8)}… declined their invitation to "${orgName}".`,
      entityId: orgId,
      entityLabel: orgName,
    })
  },
  memberRoleChanged(orgId: string, orgName: string, walletAddress: string, newRole: string): AppNotification {
    return emitNotification({
      category: 'organization',
      severity: 'info',
      title: 'Role updated',
      description: `${walletAddress.slice(0, 8)}…'s role in "${orgName}" changed to ${newRole}.`,
      entityId: orgId,
      entityLabel: orgName,
    })
  },
  memberRemoved(orgId: string, orgName: string, walletAddress: string): AppNotification {
    return emitNotification({
      category: 'organization',
      severity: 'warning',
      title: 'Member removed',
      description: `${walletAddress.slice(0, 8)}… was removed from "${orgName}".`,
      entityId: orgId,
      entityLabel: orgName,
    })
  },

  // ── Transactions ───────────────────────────────────────────────────────────
  txConfirmed(description: string, txHash: string): AppNotification {
    return emitNotification({
      category: 'transaction',
      severity: 'success',
      title: 'Transaction confirmed',
      description: `${description} — confirmed on Arc Mainnet.`,
      txHash,
    })
  },
  txFailed(description: string, reason: string): AppNotification {
    return emitNotification({
      category: 'transaction',
      severity: 'error',
      title: 'Transaction failed',
      description: `${description} failed: ${reason}`,
    })
  },
}
