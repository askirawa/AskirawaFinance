/**
 * NotificationPanel — bell icon + dropdown panel for the app header.
 *
 * Renders a bell button with an unread badge. Clicking opens an inline
 * dropdown showing the 10 most recent notifications with mark-read,
 * clear, and "View all" actions.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Bell, Check, CheckCheck, Trash2, X } from 'lucide-react'
import { useNotifications } from '../../context/NotificationContext'
import {
  SEVERITY_COLORS,
  CATEGORY_LABELS,
  formatNotifTs,
} from '../../lib/notifications'
import type { Page } from '../../App'

const PANEL_MAX_WIDTH = 360
const VIEWPORT_MARGIN = 12

interface NotificationPanelProps {
  onViewAll: (page: Page) => void
}

export default function NotificationPanel({ onViewAll }: NotificationPanelProps) {
  const { notifications, unreadCount, markRead, markAllRead, clear } = useNotifications()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 56, left: VIEWPORT_MARGIN })
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Place the panel under the bell, right-aligned to it, but never past either
  // edge of the viewport (so it fits on a 360px-wide phone).
  const updatePosition = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const vw = window.innerWidth
    const width = Math.min(PANEL_MAX_WIDTH, vw - VIEWPORT_MARGIN * 2)
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.right - width, vw - width - VIEWPORT_MARGIN))
    setPos({ top: rect.bottom + 8, left })
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('resize', updatePosition)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  // Show the 10 most recent, newest first
  const recent = [...notifications].reverse().slice(0, 10)

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => { updatePosition(); setOpen(o => !o) }}
        aria-label="Notifications"
        aria-expanded={open}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
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
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: 'min(360px, calc(100vw - 24px))',
            maxHeight: `min(480px, calc(100dvh - ${Math.round(pos.top)}px - 12px))`,
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Notifications</span>
              {unreadCount > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--accent)',
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-border)',
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
                  aria-label="Mark all as read"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--muted)', padding: 4, width: 40, height: 40,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <CheckCheck size={14} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted)', padding: 4, width: 40, height: 40,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                No notifications yet. They will appear here as you use the app.
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
                    background: n.read ? 'transparent' : 'var(--accent-dim)',
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
                        {CATEGORY_LABELS[n.category]}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', lineHeight: 1.3, marginBottom: 3, overflowWrap: 'anywhere' }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, marginBottom: 4, overflowWrap: 'anywhere' }}>
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
                        aria-label="Mark as read"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--accent)', padding: 3, width: 40, height: 40,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Check size={12} />
                      </button>
                    )}
                    <button
                      onClick={() => clear(n.id)}
                      title="Dismiss"
                      aria-label="Dismiss notification"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--subtle)', padding: 3, width: 40, height: 40,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => { setOpen(false); onViewAll('notifications') }}
              style={{
                flex: '1 1 120px',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                color: 'var(--ink-2)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '7px 4px',
                minHeight: 44,
              }}
            >
              View all notifications
            </button>
            <button
              onClick={() => { setOpen(false); onViewAll('audit') }}
              style={{
                flex: '1 1 120px',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                color: 'var(--ink-2)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '7px 4px',
                minHeight: 44,
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
