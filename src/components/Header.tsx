import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { ARC_MAINNET_CHAIN_ID } from '../config'
import NotificationPanel from './notifications/NotificationPanel'
import type { Page } from '../App'

interface HeaderProps {
  activePage: Page
  onNavigate: (page: Page) => void
}

const NAV_ITEMS: { label: string; id: Page }[] = [
  { label: 'Dashboard', id: 'dashboard' },
  { label: 'Payroll', id: 'payroll' },
  { label: 'Recurring', id: 'recurring' },
  { label: 'Approvals', id: 'approvals' },
  { label: 'Analytics', id: 'analytics' },
  { label: 'Organization', id: 'organization' },
  { label: 'Activity', id: 'activity' },
  { label: 'Automations', id: 'automations' },
  { label: 'Transactions', id: 'transactions' },
  { label: 'Audit Log', id: 'audit' },
]

export default function Header({ activePage, onNavigate }: HeaderProps) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain() as { switchChain: (params: { chainId: number }) => void; isPending: boolean }

  const isWrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: 'rgba(9,20,28,0.92)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Wrong-chain banner */}
      {isWrongChain && (
        <div
          className="flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium"
          style={{
            background: 'var(--warning-dim)',
            borderBottom: '1px solid var(--warning-border)',
            color: 'var(--warning)',
          }}
        >
          <span>Your wallet is on the wrong network. Switch to Arc Mainnet to use Askirawa Finance.</span>
          <button
            onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
            disabled={isSwitching}
            className="rounded-md px-3 py-1 text-xs font-semibold transition-opacity"
            style={{
              background: 'var(--warning)',
              color: 'var(--bg)',
              opacity: isSwitching ? 0.6 : 1,
            }}
          >
            {isSwitching ? 'Switching…' : 'Switch to Arc Mainnet'}
          </button>
        </div>
      )}

      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-6 py-0" style={{ minHeight: 72 }}>
        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            className="flex items-center justify-center rounded-xl text-sm font-black"
            style={{
              width: 40,
              height: 40,
              background: 'var(--accent-dim)',
              border: '1px solid var(--accent-border)',
              color: 'var(--accent)',
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            A
          </div>
          <div>
            <div className="font-bold text-base display" style={{ color: 'var(--ink)', lineHeight: 1.1 }}>
              Askirawa Finance
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Programmable USDC Treasury
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-0">
          {NAV_ITEMS.map((item) => {
            const isActive = activePage === item.id
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="relative px-4 text-sm font-medium transition-colors"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: isActive ? 'var(--accent)' : 'var(--muted)',
                  paddingTop: 26,
                  paddingBottom: 26,
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Right: network chip + notification bell + connect */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            className="hidden sm:flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
            style={{
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              color: isConnected && !isWrongChain ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: isConnected && !isWrongChain ? 'var(--accent)' : 'var(--subtle)',
                display: 'inline-block',
              }}
            />
            Arc Mainnet
          </div>

          {/* Notification bell */}
          <NotificationPanel onViewAll={onNavigate} />

          <ConnectKitButton.Custom>
            {({ isConnected: ckConnected, show, address, truncatedAddress }) => (
              <button
                onClick={show}
                className="rounded-lg px-4 py-2 text-sm font-semibold transition-all"
                style={{
                  background: ckConnected ? 'var(--surface-strong)' : 'var(--accent)',
                  color: ckConnected ? 'var(--ink)' : 'var(--bg)',
                  border: ckConnected ? '1px solid var(--border-strong)' : 'none',
                  minHeight: 38,
                  cursor: 'pointer',
                }}
              >
                {ckConnected ? (truncatedAddress ?? address?.slice(0, 6) + '…') : 'Connect Wallet'}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>

      {/* Mobile nav */}
      <div
        className="md:hidden flex items-center gap-0 overflow-x-auto px-2"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activePage === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className="whitespace-nowrap px-4 py-3 text-xs font-medium transition-colors"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--muted)',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {item.label}
            </button>
          )
        })}
        {/* Mobile notification shortcut */}
        <button
          onClick={() => onNavigate('notifications')}
          className="whitespace-nowrap px-4 py-3 text-xs font-medium transition-colors"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: activePage === 'notifications' ? 'var(--accent)' : 'var(--muted)',
            borderBottom: activePage === 'notifications' ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >
          Notifications
        </button>
      </div>
    </header>
  )
}
