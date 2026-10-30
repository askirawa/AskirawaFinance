import { useNotifications } from '../../context/NotificationContext'
import type { Page } from '../../App'
import { NAV_GROUPS } from './navItems'
import NavLinkButton from './NavLinkButton'
import BrandMark from './BrandMark'

interface SidebarProps {
  activePage: Page
  onNavigate: (page: Page) => void
}

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { unreadCount } = useNotifications()

  return (
    <aside
      aria-label="Main navigation"
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
      <div style={{
        height: 'var(--topbar-h)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        flexShrink: 0,
      }}>
        <BrandMark />
      </div>

      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 8 }}>
            <div style={{
              padding: '8px 20px 4px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--subtle)',
            }}>
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLinkButton
                key={item.id}
                item={item}
                active={activePage === item.id}
                count={item.id === 'notifications' ? unreadCount : 0}
                height={44}
                fontSize={13}
                onSelect={() => onNavigate(item.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '12px 20px',
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--subtle)',
        lineHeight: 1.8,
      }}>
        Arc Mainnet (chain ID 5042)
      </div>
    </aside>
  )
}
