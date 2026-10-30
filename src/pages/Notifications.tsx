/**
 * Notifications — full notifications page.
 */

import { useState, useMemo } from 'react'
import { Bell, Check, CheckCheck, Trash2, Filter } from 'lucide-react'
import { useNotifications } from '../context/NotificationContext'
import {
  CATEGORY_LABELS,
  SEVERITY_COLORS,
  formatNotifTs,
  type NotificationCategory,
  type NotificationSeverity,
} from '../lib/notifications'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'

type CategoryFilter = 'all' | NotificationCategory
type SeverityFilter = 'all' | NotificationSeverity
type ReadFilter = 'all' | 'unread' | 'read'

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
}

const PAGE_SIZE = 20

export default function Notifications() {
  const { notifications, unreadCount, markRead, markAllRead, clear, clearAllNotifs } = useNotifications()

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [readFilter, setReadFilter] = useState<ReadFilter>('all')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    let list = [...notifications].reverse()
    if (categoryFilter !== 'all') list = list.filter(n => n.category === categoryFilter)
    if (severityFilter !== 'all') list = list.filter(n => n.severity === severityFilter)
    if (readFilter === 'unread') list = list.filter(n => !n.read)
    if (readFilter === 'read') list = list.filter(n => n.read)
    return list
  }, [notifications, categoryFilter, severityFilter, readFilter])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function resetPage() { setPage(0) }

  const selectStyle = {
    background: 'var(--surface-muted)',
    border: '1px solid var(--border)',
    color: 'var(--ink-2)',
    fontSize: 12,
    padding: '6px 10px',
    minHeight: 44,
    maxWidth: '100%',
    cursor: 'pointer',
  } as React.CSSProperties

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow="Alerts"
        title="Notifications"
        subtitle="Alerts about what you do in this app. They are saved in this browser only."
        action={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--surface-muted)', border: '1px solid var(--border)',
                minHeight: 44, color: 'var(--ink-2)', fontSize: 13,
                fontWeight: 600, cursor: 'pointer', padding: '8px 14px',
              }}
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={() => { if (window.confirm('Delete all notifications from this browser? This cannot be undone.')) clearAllNotifs() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--surface-muted)', border: '1px solid var(--border)',
                minHeight: 44, color: 'var(--muted)', fontSize: 13,
                fontWeight: 600, cursor: 'pointer', padding: '8px 14px',
              }}
            >
              <Trash2 size={14} />
              Clear all
            </button>
          )}
        </div>
        }
      />

      {/* Disclosure */}
      <div
        style={{
          padding: '10px 14px',
          background: 'var(--warning-dim)',
          border: '1px solid var(--warning-border)',
          fontSize: 12,
          color: 'var(--warning)',
        }}
      >
        Notifications are saved in this browser only. They are not emailed or sent anywhere, and other people and other devices cannot see them.
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: 12 }}>
        {[
          { label: 'Total', value: notifications.length },
          { label: 'Unread', value: unreadCount },
          { label: 'Success', value: notifications.filter(n => n.severity === 'success').length },
          { label: 'Errors', value: notifications.filter(n => n.severity === 'error').length },
          { label: 'Warnings', value: notifications.filter(n => n.severity === 'warning').length },
        ].map(s => (
          <Card key={s.label}>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filter bar */}
      <Card>
        <div style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <Filter size={14} style={{ color: 'var(--subtle)', flexShrink: 0 }} />
          <select
            value={readFilter}
            onChange={e => { setReadFilter(e.target.value as ReadFilter); resetPage() }}
            style={selectStyle}
          >
            <option value="all">All</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
          <select
            value={categoryFilter}
            onChange={e => { setCategoryFilter(e.target.value as CategoryFilter); resetPage() }}
            style={selectStyle}
          >
            <option value="all">All categories</option>
            {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <select
            value={severityFilter}
            onChange={e => { setSeverityFilter(e.target.value as SeverityFilter); resetPage() }}
            style={selectStyle}
          >
            <option value="all">All types</option>
            {(['info', 'success', 'warning', 'error'] as NotificationSeverity[]).map(s => (
              <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: 'var(--subtle)', marginLeft: 'auto' }}>
            {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </Card>

      {/* Notification list */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>
            {readFilter === 'unread' ? 'Unread' : readFilter === 'read' ? 'Read' : 'All'} notifications
          </span>
        </CardHeader>
        <CardBody style={{ padding: 0 }}>
          {paginated.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notifications"
              description={filtered.length === 0 && notifications.length === 0
                ? 'Notifications will appear here as you use Askirawa Finance.'
                : 'Nothing matches these filters. Change a filter to see more.'}
            />
          ) : (
            <div>
              {paginated.map((n, idx) => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '14px 16px',
                    borderBottom: idx < paginated.length - 1 ? '1px solid var(--border)' : 'none',
                    background: n.read ? 'transparent' : 'var(--accent-dim)',
                  }}
                >
                  {/* Indicator */}
                  <div style={{ paddingTop: 6, flexShrink: 0 }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: n.read ? 'var(--border)' : SEVERITY_COLORS[n.severity],
                      }}
                    />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{n.title}</span>
                      <Badge variant={
                        n.severity === 'success' ? 'success'
                        : n.severity === 'warning' ? 'warning'
                        : n.severity === 'error' ? 'danger'
                        : 'neutral'
                      }>
                        {CATEGORY_LABELS[n.category]}
                      </Badge>
                      {!n.read && <Badge variant="active">Unread</Badge>}
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 6px', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                      {n.description}
                    </p>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--subtle)' }}>{formatNotifTs(n.timestamp)}</span>
                      {n.txHash && (
                        <a
                          href={`https://explorer.arc.io/tx/${n.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'underline', wordBreak: 'break-all' }}
                        >
                          Transaction {n.txHash.slice(0, 10)}… ↗
                        </a>
                      )}
                      {n.entityLabel && (
                        <span style={{ fontSize: 11, color: 'var(--subtle)' }}>
                          Related to: {n.entityLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'flex-start' }}>
                    {!n.read && (
                      <button
                        onClick={() => markRead(n.id)}
                        title="Mark as read"
                        aria-label="Mark as read"
                        style={{ minWidth: 40, minHeight: 40, justifyContent: 'center',
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--accent)', padding: 6,
                          display: 'flex', alignItems: 'center',
                        }}
                      >
                        <Check size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => clear(n.id)}
                      title="Dismiss"
                      aria-label="Dismiss notification"
                      style={{ minWidth: 40, minHeight: 40, justifyContent: 'center',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--subtle)', padding: 6,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ ...selectStyle, opacity: page === 0 ? 0.4 : 1 }}
          >
            Previous
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 10px' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{ ...selectStyle, opacity: page >= totalPages - 1 ? 0.4 : 1 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
