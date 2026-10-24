import {
  LayoutDashboard, Wallet, RefreshCw, CheckSquare,
  BarChart2, Bell, BookOpen, Activity, Zap, List, Building2,
} from 'lucide-react'
import { useNotifications } from '../../context/NotificationContext'
import type { Page } from '../../App'

interface SidebarProps {
  activePage: Page
  onNavigate: (page: Page) => void
}

type NavItem = { id: Page; label: string; icon: React.ReactNode; index: string }
type NavGroup = { label: string; section: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    section: '00',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} strokeWidth={1.5} />, index: '00' },
    ],
  },
  {
    label: 'Treasury',
    section: '01',
    items: [
      { id: 'payroll',     label: 'Payroll',            icon: <Wallet size={14} strokeWidth={1.5} />,      index: '01' },
      { id: 'recurring',   label: 'Recurring Payments', icon: <RefreshCw size={14} strokeWidth={1.5} />,   index: '02' },
      { id: 'approvals',   label: 'Approvals',          icon: <CheckSquare size={14} strokeWidth={1.5} />, index: '03' },
      { id: 'automations', label: 'Automations',        icon: <Zap size={14} strokeWidth={1.5} />,         index: '04' },
    ],
  },
  {
    label: 'Organisation',
    section: '02',
    items: [
      { id: 'organization', label: 'Team & Roles', icon: <Building2 size={14} strokeWidth={1.5} />, index: '05' },
    ],
  },
  {
    label: 'Insights',
    section: '03',
    items: [
      { id: 'analytics',    label: 'Analytics',    icon: <BarChart2 size={14} strokeWidth={1.5} />, index: '06' },
      { id: 'activity',     label: 'Activity',     icon: <Activity size={14} strokeWidth={1.5} />,  index: '07' },
      { id: 'transactions', label: 'Transactions', icon: <List size={14} strokeWidth={1.5} />,      index: '08' },
    ],
  },
  {
    label: 'Logs',
    section: '04',
    items: [
      { id: 'notifications', label: 'Notifications', icon: <Bell size={14} strokeWidth={1.5} />,     index: '09' },
      { id: 'audit',         label: 'Audit Log',     icon: <BookOpen size={14} strokeWidth={1.5} />, index: '10' },
    ],
  },
]

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { unreadCount } = useNotifications()

  return (
    <aside
      style={{
        width: 'var(--sidebar-w)',
        minWidth: 'var(--sidebar-w)',
        maxWidth: 'var(--sidebar-w)',
        height: '100vh',
        position: 'sticky',
        top: 0,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 30,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {/* Logo strip */}
      <div style={{
        height: 'var(--topbar-h)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 10,
        flexShrink: 0,
      }}>
        {/* Square logo mark */}
        <div style={{
          width: 28,
          height: 28,
          background: 'var(--ink)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800,
            fontSize: 13,
            color: 'var(--bg)',
            lineHeight: 1,
          }}>A</span>
        </div>
        <div>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: 13,
            color: 'var(--ink)',
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}>
            AskirawaFi
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--subtle)',
            lineHeight: 1.2,
          }}>
            USDC Treasury
          </div>
        </div>
      </div>

      {/* Workspace row */}
      <div style={{
        padding: '14px 20px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{
          width: 6,
          height: 6,
          background: 'var(--ink)',
          opacity: 0.6,
          display: 'inline-block',
        }} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          flex: 1,
        }}>Workspace</span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: 'var(--subtle)',
          letterSpacing: '0.06em',
        }}>01</span>
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 4 }}>
            {/* Section label */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 20px 4px',
              gap: 8,
            }}>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--subtle)',
              }}>
                {group.section} / {group.label.toUpperCase()}
              </span>
            </div>

            {/* Nav items */}
            {group.items.map((item) => {
              const isActive = activePage === item.id
              const showBadge = item.id === 'notifications' && unreadCount > 0

              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    height: 48,
                    padding: '0 20px',
                    border: 'none',
                    borderLeft: isActive ? '3px solid var(--ink)' : '3px solid transparent',
                    background: isActive ? 'var(--nav-active-bg)' : 'transparent',
                    color: isActive ? 'var(--ink)' : 'var(--muted)',
                    cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 13,
                    fontWeight: isActive ? 500 : 400,
                    transition: 'all 0.15s',
                    textAlign: 'left',
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
                  <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7 }}>{item.icon}</span>
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.label}
                  </span>
                  {showBadge ? (
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: 'var(--ink)',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-strong)',
                      padding: '1px 5px',
                      letterSpacing: '0.04em',
                      flexShrink: 0,
                    }}>
                      {unreadCount > 99 ? '99+' : String(unreadCount).padStart(2, '0')}
                    </span>
                  ) : (
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: 'var(--subtle)',
                      letterSpacing: '0.04em',
                      flexShrink: 0,
                    }}>
                      {item.index}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '12px 20px',
        flexShrink: 0,
      }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'var(--subtle)',
          lineHeight: 1.8,
        }}>
          Arc Mainnet · 5042<br />
          USDC Treasury v1
        </div>
      </div>
    </aside>
  )
}
