import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { Menu } from 'lucide-react'
import { ARC_MAINNET_CHAIN_ID } from '../../config'
import NotificationPanel from '../notifications/NotificationPanel'
import type { Page } from '../../App'

interface TopbarProps {
  onNavigate: (page: Page) => void
  onMobileMenuToggle: () => void
}

export default function Topbar({ onNavigate, onMobileMenuToggle }: TopbarProps) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain() as {
    switchChain: (p: { chainId: number }) => void
    isPending: boolean
  }

  const isWrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID

  return (
    <div style={{ flexShrink: 0 }}>
      {/* Wrong-chain banner */}
      {isWrongChain && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '8px 20px',
            background: 'rgba(232,184,76,0.08)',
            borderBottom: '1px solid var(--warning-border)',
            fontSize: 13,
            color: 'var(--warning)',
            fontWeight: 500,
          }}
        >
          <span
            style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', display: 'inline-block', flexShrink: 0 }}
          />
          <span>Wrong network — switch to Arc Mainnet to use AskirawaFi</span>
          <button
            onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
            disabled={isSwitching}
            style={{
              background: 'var(--warning)',
              color: '#18100a',
              border: 'none',
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              opacity: isSwitching ? 0.6 : 1,
              fontFamily: 'inherit',
              letterSpacing: '0.03em',
            }}
          >
            {isSwitching ? 'Switching…' : 'Switch Network'}
          </button>
        </div>
      )}

      {/* Main topbar */}
      <div
        style={{
          height: 60,
          borderBottom: '1px solid var(--border)',
          background: 'rgba(7,13,20,0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          gap: 12,
        }}
      >
        {/* Mobile menu button */}
        <button
          className="lg:hidden"
          onClick={onMobileMenuToggle}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--muted)',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Menu size={20} />
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Network pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              borderRadius: 8,
              padding: '5px 11px',
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              fontSize: 12,
              fontWeight: 500,
              color: isConnected && !isWrongChain ? 'var(--accent)' : 'var(--muted)',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isConnected && !isWrongChain ? 'var(--accent)' : 'var(--subtle)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            Arc Mainnet
          </div>

          {/* Notifications */}
          <NotificationPanel onViewAll={onNavigate} />

          {/* Wallet */}
          <ConnectKitButton.Custom>
            {({ isConnected: ckConnected, show, address, truncatedAddress }) => (
              <button
                onClick={show}
                style={{
                  background: ckConnected ? 'var(--surface-strong)' : 'var(--accent)',
                  color: ckConnected ? 'var(--ink)' : '#021a0e',
                  border: ckConnected ? '1px solid var(--border-strong)' : '1px solid transparent',
                  borderRadius: 8,
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {ckConnected
                  ? (truncatedAddress ?? (address ? address.slice(0, 6) + '…' + address.slice(-4) : ''))
                  : 'Connect Wallet'}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </div>
  )
}
