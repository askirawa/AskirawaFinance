/**
 * NotificationContext — app-wide notification state.
 *
 * Provides:
 *   - notifications: the full list from localStorage
 *   - unreadCount: count of unread notifications
 *   - emit: add a notification (deduped by id)
 *   - markRead / markAllRead / clear / clearAll: mutation helpers
 *   - refresh: reload from localStorage (call after external mutations)
 *
 * The context also provides logAudit() so any component can record an audit
 * event without importing audit.ts directly.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import {
  loadNotifications,
  appendNotification,
  markAsRead,
  markAllAsRead,
  clearNotification,
  clearAll,
  type AppNotification,
} from '../lib/notifications'
import {
  logAuditEvent,
  type AuditEntry,
} from '../lib/audit'

interface NotificationContextValue {
  notifications: AppNotification[]
  unreadCount: number
  /** Persist a new notification and update state. Deduped by id. */
  emit: (notif: AppNotification) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clear: (id: string) => void
  clearAllNotifs: () => void
  /** Reload notifications from localStorage (after external mutations). */
  refresh: () => void
  /** Persist an audit entry and update state. Returns the entry. */
  logAudit: (fields: Omit<AuditEntry, 'id' | 'timestamp'>) => AuditEntry
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(() => loadNotifications())

  const refresh = useCallback(() => {
    setNotifications(loadNotifications())
  }, [])

  const emit = useCallback((notif: AppNotification) => {
    // appendNotification writes to localStorage and skips duplicates by id.
    // Re-read after the write so state always matches the authoritative store.
    appendNotification(notif)
    setNotifications(loadNotifications())
  }, [])

  const markRead = useCallback((id: string) => {
    setNotifications(prev => markAsRead(prev, id))
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications(prev => markAllAsRead(prev))
  }, [])

  const clear = useCallback((id: string) => {
    setNotifications(prev => clearNotification(prev, id))
  }, [])

  const clearAllNotifs = useCallback(() => {
    setNotifications(clearAll([]))
  }, [])

  const logAudit = useCallback((fields: Omit<AuditEntry, 'id' | 'timestamp'>) => {
    return logAuditEvent(fields)
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        emit,
        markRead,
        markAllRead,
        clear,
        clearAllNotifs,
        refresh,
        logAudit,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider')
  return ctx
}
