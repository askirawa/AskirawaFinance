import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { Menu, X } from 'lucide-react'
import { ARC_MAINNET_CHAIN_ID } from '../../config'
import NotificationPanel from '../notifications/NotificationPanel'
import type { Page } from '../../App'

// Page-title map
const PAGE_TITLES: Record<string, string> = {
  dashboard:     'Dashboard',
  payroll:       'Payroll',
  recurring:     'Recurring Payments',
  approvals:     'Approvals',
  automations:   'Automations',
  organization:  'Team & Roles',
  analytics:     'Analytics',
  activity:      'Activity',
  transactions:  'Transactions',
  notifications: 'Notifications',
  audit:         'Audit Log',
}

interface TopbarProps {
  activePage?: string
  onNavigate: (page: Page) => void
  onMobileMenuToggle: () => void
  mobileMenuOpen?: boolean
}

export default function Topbar({ activePage = 'dashboard', onNavigate, onMobileMenuToggle, mobileMenuOpen }: TopbarProps) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain() as {
    switchChain: (p: { chainId: number }) => void
    isPending: boolean
  }

  const isWrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID
  const pageTitle = PAGE_TITLES[activePage] ?? 'AskirawaFi'

  return (
    <div style={{ flexShrink: 0 }}>

      {/* Wrong-chain banner */}
      {isWrongChain && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '8px 20px',
          background: 'rgba(200,151,58,0.06)',
          borderBottom: '1px solid var(--warning-border)',
          fontSize: 12,
          color: 'var(--warning)',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          <span style={{ width: 5, height: 5, background: 'var(--warning)', display: 'inline-block', flexShrink: 0 }} />
          <span>Wrong network — switch to Arc Mainnet (chain ID 5042)</span>
          <button
            onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
            disabled={isSwitching}
            style={{
              background: 'transparent',
              color: 'var(--warning)',
              border: '1px solid var(--warning-border)',
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: isSwitching ? 0.5 : 1,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              borderRadius: 0,
            }}
          >
            {isSwitching ? 'Switching…' : 'Switch'}
          </button>
        </div>
      )}

      {/* Main topbar */}
      <div style={{
        height: 'var(--topbar-h)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 14,
      }}>

        {/* Hamburger / close — mobile */}
        <button
          className="lg:hidden"
          onClick={onMobileMenuToggle}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--ink)',
            cursor: 'pointer',
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            borderRadius: 0,
          }}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileMenuOpen ? <X size={16} strokeWidth={1.5} /> : <Menu size={16} strokeWidth={1.5} />}
        </button>

        {/* Page title */}
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 600,
          fontSize: 15,
          color: 'var(--ink)',
          letterSpacing: '-0.01em',
          flex: 1,
        }}>
          {pageTitle}
        </div>

        {/* Right strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

          {/* Network chip */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            border: '1px solid var(--border)',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: isConnected && !isWrongChain ? 'var(--ink-2)' : 'var(--subtle)',
            whiteSpace: 'nowrap',
          }}>
            <span style={{
              width: 5,
              height: 5,
              background: isConnected && !isWrongChain ? 'var(--success)' : 'var(--subtle)',
              display: 'inline-block',
              flexShrink: 0,
            }} />
            Arc · 5042
          </div>

          {/* Notifications */}
          <NotificationPanel onViewAll={onNavigate} />

          {/* Wallet */}
          <ConnectKitButton.Custom>
            {({ isConnected: ckConnected, show, address, truncatedAddress }) => (
              <button
                onClick={show}
                style={{
                  background: ckConnected ? 'transparent' : 'var(--ink)',
                  color: ckConnected ? 'var(--ink)' : 'var(--bg)',
                  border: '1px solid var(--border-strong)',
                  padding: '0 16px',
                  height: 36,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                  borderRadius: 0,
                }}
              >
                {ckConnected
                  ? (truncatedAddress ?? (address ? address.slice(0, 6) + '…' + address.slice(-4) : ''))
                  : 'Connect'}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </div>
  )
}
