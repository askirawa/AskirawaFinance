import { useState } from 'react'
import {
  LayoutDashboard, Wallet, RefreshCw, CheckSquare,
  Users, BarChart2, Bell, BookOpen,
  Activity, Zap, List, ChevronLeft, ChevronRight,
  Building2,
} from 'lucide-react'
import { useNotifications } from '../../context/NotificationContext'
import type { Page } from '../../App'

interface SidebarProps {
  activePage: Page
  onNavigate: (page: Page) => void
}

type NavGroup = {
  label: string
  items: { id: Page; label: string; icon: React.ReactNode }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
    ],
  },
  {
    label: 'Treasury',
    items: [
      { id: 'payroll',      label: 'Payroll',            icon: <Wallet size={16} /> },
      { id: 'recurring',    label: 'Recurring Payments', icon: <RefreshCw size={16} /> },
      { id: 'approvals',    label: 'Approvals',          icon: <CheckSquare size={16} /> },
      { id: 'automations',  label: 'Automations',        icon: <Zap size={16} /> },
    ],
  },
  {
    label: 'Organisation',
    items: [
      { id: 'organization', label: 'Team & Roles',   icon: <Building2 size={16} /> },
    ],
  },
  {
    label: 'Insights',
    items: [
      { id: 'analytics',    label: 'Analytics',    icon: <BarChart2 size={16} /> },
      { id: 'activity',     label: 'Activity',     icon: <Activity size={16} /> },
      { id: 'transactions', label: 'Transactions', icon: <List size={16} /> },
    ],
  },
  {
    label: 'Logs',
    items: [
      { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
      { id: 'audit',         label: 'Audit Log',     icon: <BookOpen size={16} /> },
    ],
  },
]

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { unreadCount } = useNotifications()

  const w = collapsed ? 64 : 240

  return (
    <aside
      style={{
        width: w,
        minWidth: w,
        maxWidth: w,
        height: '100vh',
        position: 'sticky',
        top: 0,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease',
        zIndex: 30,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {/* Logo */}
      <div
        style={{
          height: 60,
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: collapsed ? '0 14px' : '0 18px',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)',
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800,
            fontSize: 15,
            flexShrink: 0,
          }}
        >
          A
        </div>
        {!collapsed && (
          <div style={{ overflow: 'hidden' }}>
            <div
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 14,
                color: 'var(--ink)',
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
              }}
            >
              AskirawaFi
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              USDC Treasury
            </div>
          </div>
        )}
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, padding: collapsed ? '12px 8px' : '12px 10px', overflowY: 'auto' }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 4 }}>
            {!collapsed && (
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--subtle)',
                  padding: '10px 8px 4px',
                }}
              >
                {group.label}
              </div>
            )}
            {collapsed && <div style={{ height: 8 }} />}
            {group.items.map((item) => {
              const isActive = activePage === item.id
              const showBadge = item.id === 'notifications' && unreadCount > 0
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: collapsed ? '9px 11px' : '9px 10px',
                    borderRadius: 8,
                    border: '1px solid transparent',
                    background: isActive ? 'var(--accent-dim)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--muted)',
                    borderColor: isActive ? 'var(--accent-border)' : 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    transition: 'all 0.12s',
                    textAlign: 'left',
                    marginBottom: 1,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    position: 'relative',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'var(--surface-hover)'
                      e.currentTarget.style.color = 'var(--ink-2)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = 'var(--muted)'
                    }
                  }}
                >
                  <span style={{ flexShrink: 0 }}>{item.icon}</span>
                  {!collapsed && <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
                  {showBadge && !collapsed && (
                    <span
                      style={{
                        background: 'var(--accent)',
                        color: '#021a0e',
                        borderRadius: 99,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '1px 6px',
                        minWidth: 18,
                        textAlign: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                  {showBadge && collapsed && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 5,
                        right: 5,
                        width: 8,
                        height: 8,
                        background: 'var(--accent)',
                        borderRadius: '50%',
                      }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px', flexShrink: 0 }}>
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            padding: '8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--muted)',
            cursor: 'pointer',
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--surface-hover)'
            e.currentTarget.style.color = 'var(--ink)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--surface)'
            e.currentTarget.style.color = 'var(--muted)'
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!collapsed && <span style={{ fontSize: 12, marginLeft: 8 }}>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
