import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useNotifications } from '../../context/NotificationContext'
import type { Page } from '../../App'
import { NAV_GROUPS } from './navItems'
import NavLinkButton from './NavLinkButton'
import BrandMark from './BrandMark'

interface MobileNavProps {
  activePage: Page
  onNavigate: (page: Page) => void
  onClose: () => void
}

export default function MobileNav({ activePage, onNavigate, onClose }: MobileNavProps) {
  const { unreadCount } = useNotifications()

  // Close on Escape and stop the page scrolling behind the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 49,
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 'min(300px, 86vw)',
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--border)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div style={{
          height: 'var(--topbar-h)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px 0 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <BrandMark />
          <button
            onClick={onClose}
            aria-label="Close menu"
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              color: 'var(--ink)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <nav style={{ flex: 1, padding: '12px 0' }}>
          {NAV_GROUPS.map(group => (
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
              {group.items.map(item => (
                <NavLinkButton
                  key={item.id}
                  item={item}
                  active={activePage === item.id}
                  count={item.id === 'notifications' ? unreadCount : 0}
                  height={52}
                  fontSize={15}
                  onSelect={() => onNavigate(item.id)}
                />
              ))}
            </div>
          ))}
        </nav>

        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '12px 20px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--subtle)',
        }}>
          Arc Mainnet (chain ID 5042)
        </div>
      </div>
    </>
  )
}
