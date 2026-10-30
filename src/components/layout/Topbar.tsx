import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { Menu, X } from 'lucide-react'
import { ARC_MAINNET_CHAIN_ID } from '../../config'
import NotificationPanel from '../notifications/NotificationPanel'
import { PAGE_TITLES } from './navItems'
import type { Page } from '../../App'

interface TopbarProps {
  activePage?: Page
  onNavigate: (page: Page) => void
  onMobileMenuToggle: () => void
  mobileMenuOpen?: boolean
}

const MONO = "'JetBrains Mono', monospace"

export default function Topbar({ activePage = 'dashboard', onNavigate, onMobileMenuToggle, mobileMenuOpen }: TopbarProps) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const isWrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID
  const pageTitle = PAGE_TITLES[activePage] ?? 'Askirawa Finance'

  return (
    <div style={{ flexShrink: 0, position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg)' }}>

      {isWrongChain && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: '6px 12px',
            padding: '8px 16px',
            background: 'var(--warning-dim)',
            borderBottom: '1px solid var(--warning-border)',
            fontSize: 13,
            color: 'var(--warning)',
          }}
        >
          <span>Your wallet is on the wrong network. Switch to Arc Mainnet to continue.</span>
          <button
            onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
            disabled={isSwitching}
            style={{
              background: 'transparent',
              color: 'var(--warning)',
              border: '1px solid var(--warning-border)',
              padding: '0 14px',
              height: 36,
              fontSize: 12,
              fontWeight: 600,
              cursor: isSwitching ? 'default' : 'pointer',
              opacity: isSwitching ? 0.5 : 1,
              fontFamily: MONO,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              borderRadius: 0,
            }}
          >
            {isSwitching ? 'Switching…' : 'Switch network'}
          </button>
        </div>
      )}

      <div style={{
        height: 'var(--topbar-h)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 10,
      }}>

        {/* Menu button (mobile and tablet) */}
        <button
          className="lg:hidden"
          onClick={onMobileMenuToggle}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--ink)',
            cursor: 'pointer',
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            borderRadius: 0,
          }}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X size={18} strokeWidth={1.5} /> : <Menu size={18} strokeWidth={1.5} />}
        </button>

        <div style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 600,
          fontSize: 15,
          color: 'var(--ink)',
          letterSpacing: '-0.01em',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {pageTitle}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

          {/* Network status (hidden on very small screens; the wrong-network banner still shows) */}
          <div
            className="hidden sm:flex"
            style={{
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              height: 36,
              border: '1px solid var(--border)',
              fontSize: 11,
              fontFamily: MONO,
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: isConnected && !isWrongChain ? 'var(--ink-2)' : 'var(--subtle)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{
              width: 6,
              height: 6,
              background: isConnected && !isWrongChain ? 'var(--success)' : 'var(--subtle)',
              display: 'inline-block',
              flexShrink: 0,
            }} />
            Arc Mainnet
          </div>

          <NotificationPanel onViewAll={onNavigate} />

          <ConnectKitButton.Custom>
            {({ isConnected: ckConnected, isConnecting, show, address, truncatedAddress }) => (
              <button
                onClick={() => {
                  // Make sure the navigation drawer never sits on top of the wallet dialog
                  if (mobileMenuOpen) onMobileMenuToggle()
                  show?.()
                }}
                style={{
                  background: ckConnected ? 'transparent' : 'var(--ink)',
                  color: ckConnected ? 'var(--ink)' : 'var(--bg)',
                  border: '1px solid var(--border-strong)',
                  padding: '0 14px',
                  height: 44,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: MONO,
                  letterSpacing: '0.04em',
                  textTransform: ckConnected ? 'none' : 'uppercase',
                  whiteSpace: 'nowrap',
                  borderRadius: 0,
                }}
              >
                {ckConnected
                  ? (truncatedAddress ?? (address ? address.slice(0, 6) + '…' + address.slice(-4) : 'Wallet'))
                  : isConnecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </div>
  )
}
