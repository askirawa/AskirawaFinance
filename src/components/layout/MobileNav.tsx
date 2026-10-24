import {
  LayoutDashboard, Wallet, RefreshCw, CheckSquare,
  BarChart2, Bell, BookOpen, Activity, Zap, List, Building2,
} from 'lucide-react'
import { useNotifications } from '../../context/NotificationContext'
import type { Page } from '../../App'

interface MobileNavProps {
  activePage: Page
  onNavigate: (page: Page) => void
  onClose: () => void
}

const ALL_NAV: { id: Page; label: string; icon: React.ReactNode; group: string; section: string; index: string }[] = [
  { group: 'Overview',     section: '00', id: 'dashboard',    label: 'Dashboard',           icon: <LayoutDashboard size={14} strokeWidth={1.5} />, index: '00' },
  { group: 'Treasury',     section: '01', id: 'payroll',       label: 'Payroll',             icon: <Wallet size={14} strokeWidth={1.5} />,          index: '01' },
  { group: 'Treasury',     section: '01', id: 'recurring',     label: 'Recurring Payments',  icon: <RefreshCw size={14} strokeWidth={1.5} />,        index: '02' },
  { group: 'Treasury',     section: '01', id: 'approvals',     label: 'Approvals',           icon: <CheckSquare size={14} strokeWidth={1.5} />,      index: '03' },
  { group: 'Treasury',     section: '01', id: 'automations',   label: 'Automations',         icon: <Zap size={14} strokeWidth={1.5} />,              index: '04' },
  { group: 'Organisation', section: '02', id: 'organization',  label: 'Team & Roles',        icon: <Building2 size={14} strokeWidth={1.5} />,        index: '05' },
  { group: 'Insights',     section: '03', id: 'analytics',     label: 'Analytics',           icon: <BarChart2 size={14} strokeWidth={1.5} />,        index: '06' },
  { group: 'Insights',     section: '03', id: 'activity',      label: 'Activity',            icon: <Activity size={14} strokeWidth={1.5} />,         index: '07' },
  { group: 'Insights',     section: '03', id: 'transactions',  label: 'Transactions',        icon: <List size={14} strokeWidth={1.5} />,             index: '08' },
  { group: 'Logs',         section: '04', id: 'notifications', label: 'Notifications',       icon: <Bell size={14} strokeWidth={1.5} />,             index: '09' },
  { group: 'Logs',         section: '04', id: 'audit',         label: 'Audit Log',           icon: <BookOpen size={14} strokeWidth={1.5} />,         index: '10' },
]

export default function MobileNav({ activePage, onNavigate, onClose }: MobileNavProps) {
  const { unreadCount } = useNotifications()

  const groups = [...new Set(ALL_NAV.map(n => n.group))]

  return (
    <>
      {/* Backdrop — dim + blur */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 49,
        }}
      />

      {/* Drawer */}
      <div style={{
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
      }}>

        {/* Header */}
        <div style={{
          height: 'var(--topbar-h)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          borderBottom: '1px solid var(--border)',
          gap: 10,
          flexShrink: 0,
        }}>
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
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 13,
              color: 'var(--ink)',
              letterSpacing: '-0.02em',
            }}>AskirawaFi</div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--subtle)',
            }}>USDC Treasury</div>
          </div>
        </div>

        {/* Workspace row */}
        <div style={{
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, background: 'var(--ink)', opacity: 0.5, display: 'inline-block' }} />
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
          }}>01</span>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 0' }}>
          {groups.map(group => {
            const items = ALL_NAV.filter(n => n.group === group)
            const sectionId = items[0]?.section ?? '00'
            return (
              <div key={group} style={{ marginBottom: 4 }}>
                <div style={{
                  padding: '8px 20px 4px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--subtle)',
                }}>
                  {sectionId} / {group.toUpperCase()}
                </div>
                {items.map(item => {
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
                        height: 52,
                        padding: '0 20px',
                        border: 'none',
                        borderLeft: isActive ? '3px solid var(--ink)' : '3px solid transparent',
                        background: isActive ? 'var(--nav-active-bg)' : 'transparent',
                        color: isActive ? 'var(--ink)' : 'var(--muted)',
                        cursor: 'pointer',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 14,
                        fontWeight: isActive ? 500 : 400,
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7 }}>{item.icon}</span>
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {showBadge ? (
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10,
                          color: 'var(--ink)',
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border-strong)',
                          padding: '1px 5px',
                          letterSpacing: '0.04em',
                        }}>
                          {unreadCount > 99 ? '99+' : String(unreadCount).padStart(2, '0')}
                        </span>
                      ) : (
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10,
                          color: 'var(--subtle)',
                        }}>{item.index}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
      </div>
    </>
  )
}
