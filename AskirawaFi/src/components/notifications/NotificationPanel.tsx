/**
 * NotificationPanel — bell icon + dropdown panel for the app header.
 *
 * Renders a bell button with an unread badge. Clicking opens an inline
 * dropdown showing the 10 most recent notifications with mark-read,
 * clear, and "View all" actions.
 */

import { useState, useRef, useEffect } from 'react'
import { Bell, Check, CheckCheck, Trash2, X } from 'lucide-react'
import { useNotifications } from '../../context/NotificationContext'
import {
  SEVERITY_COLORS,
  CATEGORY_LABELS,
  formatNotifTs,
  type NotificationCategory,
} from '../../lib/notifications'
import type { Page } from '../../App'

const CATEGORY_ICONS: Record<NotificationCategory, string> = {
  payroll: '💼',
  recurring: '🔄',
  approval: '✅',
  organization: '🏢',
  transaction: '⛓',
  system: '⚙',
}

interface NotificationPanelProps {
  onViewAll: (page: Page) => void
}

export default function NotificationPanel({ onViewAll }: NotificationPanelProps) {
  const { notifications, unreadCount, markRead, markAllRead, clear } = useNotifications()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Show the 10 most recent, newest first
  const recent = [...notifications].reverse().slice(0, 10)

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 38,
          height: 38,
          borderRadius: 8,
          background: open ? 'var(--surface-strong)' : 'var(--surface-muted)',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          color: unreadCount > 0 ? 'var(--accent)' : 'var(--muted)',
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
      >
        <Bell size={16} strokeWidth={2} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: 'var(--danger)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 360,
            maxHeight: 480,
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 16,
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px 12px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Notifications</span>
              {unreadCount > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--accent)',
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-border)',
                    borderRadius: 6,
                    padding: '1px 6px',
                  }}
                >
                  {unreadCount} unread
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  title="Mark all as read"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--muted)', padding: 4, borderRadius: 6,
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <CheckCheck size={14} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted)', padding: 4, borderRadius: 6,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {recent.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                <Bell size={24} strokeWidth={1.5} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
                No notifications yet
              </div>
            ) : (
              recent.map(n => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '11px 14px',
                    borderBottom: '1px solid var(--border)',
                    background: n.read ? 'transparent' : 'rgba(53,217,139,0.03)',
                    transition: 'background 0.15s',
                    cursor: 'default',
                  }}
                >
                  {/* Severity dot + icon */}
                  <div style={{ flexShrink: 0, paddingTop: 2 }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: n.read ? 'var(--border)' : SEVERITY_COLORS[n.severity],
                        marginTop: 4,
                      }}
                    />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 10, color: 'var(--subtle)' }}>
                        {CATEGORY_ICONS[n.category]} {CATEGORY_LABELS[n.category]}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', lineHeight: 1.3, marginBottom: 3 }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, marginBottom: 4 }}>
                      {n.description}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--subtle)' }}>
                      {formatNotifTs(n.timestamp)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                    {!n.read && (
                      <button
                        onClick={() => markRead(n.id)}
                        title="Mark as read"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--accent)', padding: 3, borderRadius: 4,
                          display: 'flex', alignItems: 'center',
                        }}
                      >
                        <Check size={12} />
                      </button>
                    )}
                    <button
                      onClick={() => clear(n.id)}
                      title="Dismiss"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--subtle)', padding: 3, borderRadius: 4,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setOpen(false); onViewAll('notifications') }}
              style={{
                flex: 1,
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--ink-2)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '7px 0',
              }}
            >
              View all notifications
            </button>
            <button
              onClick={() => { setOpen(false); onViewAll('audit') }}
              style={{
                flex: 1,
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--ink-2)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '7px 0',
              }}
            >
              Audit log
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
