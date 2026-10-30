import {
  LayoutDashboard, Wallet, RefreshCw, CheckSquare,
  Users, BarChart2, Bell, BookOpen,
  Activity, Zap, List, X, Building2,
} from 'lucide-react'
import { useNotifications } from '../../context/NotificationContext'
import type { Page } from '../../App'

interface MobileNavProps {
  activePage: Page
  onNavigate: (page: Page) => void
  onClose: () => void
}

const ALL_NAV: { id: Page; label: string; icon: React.ReactNode; group: string }[] = [
  { group: 'Overview',      id: 'dashboard',     label: 'Dashboard',           icon: <LayoutDashboard size={16} /> },
  { group: 'Treasury',      id: 'payroll',        label: 'Payroll',             icon: <Wallet size={16} /> },
  { group: 'Treasury',      id: 'recurring',      label: 'Recurring Payments',  icon: <RefreshCw size={16} /> },
  { group: 'Treasury',      id: 'approvals',      label: 'Approvals',           icon: <CheckSquare size={16} /> },
  { group: 'Treasury',      id: 'automations',    label: 'Automations',         icon: <Zap size={16} /> },
  { group: 'Organisation',  id: 'organization',   label: 'Team & Roles',        icon: <Building2 size={16} /> },
  { group: 'Insights',      id: 'analytics',      label: 'Analytics',           icon: <BarChart2 size={16} /> },
  { group: 'Insights',      id: 'activity',       label: 'Activity',            icon: <Activity size={16} /> },
  { group: 'Insights',      id: 'transactions',   label: 'Transactions',        icon: <List size={16} /> },
  { group: 'Logs',          id: 'notifications',  label: 'Notifications',       icon: <Bell size={16} /> },
  { group: 'Logs',          id: 'audit',          label: 'Audit Log',           icon: <BookOpen size={16} /> },
]

export default function MobileNav({ activePage, onNavigate, onClose }: MobileNavProps) {
  const { unreadCount } = useNotifications()

  const groups = [...new Set(ALL_NAV.map(n => n.group))]

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(7,13,20,0.7)',
          zIndex: 49,
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Drawer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 280,
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--border)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 18px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)',
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              A
            </div>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                AskirawaFi
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>USDC Treasury</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 10px' }}>
          {groups.map(group => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--subtle)',
                  padding: '8px 8px 4px',
                }}
              >
                {group}
              </div>
              {ALL_NAV.filter(n => n.group === group).map(item => {
                const isActive = activePage === item.id
                const showBadge = item.id === 'notifications' && unreadCount > 0
                return (
                  <button
                    key={item.id}
                    onClick={() => { onNavigate(item.id); onClose() }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '10px 10px',
                      borderRadius: 8,
                      border: '1px solid transparent',
                      background: isActive ? 'var(--accent-dim)' : 'transparent',
                      color: isActive ? 'var(--accent)' : 'var(--muted)',
                      borderColor: isActive ? 'var(--accent-border)' : 'transparent',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 14,
                      fontWeight: isActive ? 600 : 400,
                      textAlign: 'left',
                      marginBottom: 1,
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {showBadge && (
                      <span
                        style={{
                          background: 'var(--accent)',
                          color: '#021a0e',
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                        }}
                      >
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
      </div>
    </>
  )
}
