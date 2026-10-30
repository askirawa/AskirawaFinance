import { ConnectKitButton } from 'connectkit'
import { useSwitchChain } from 'wagmi'
import { Wallet, AlertTriangle } from 'lucide-react'
import { useWrongNetwork } from '../hooks/useTreasury'

interface WalletGateProps {
  children: React.ReactNode
}

/**
 * Renders children when a wallet is connected, otherwise shows a prompt.
 * This does NOT block the whole page — it wraps specific data sections.
 */
export default function WalletGate({ children }: WalletGateProps) {
  return <>{children}</>
}

export function WalletRequired({ message }: { message?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-4 text-center"
      style={{
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        color: 'var(--muted)',
      }}
    >
      <div
        className="mb-4 flex items-center justify-center"
        style={{
          width: 52,
          height: 52,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--subtle)',
        }}
      >
        <Wallet size={22} strokeWidth={1.5} />
      </div>
      <p className="mb-1 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
        Connect your wallet
      </p>
      <p className="mb-5 text-xs max-w-xs" style={{ color: 'var(--muted)' }}>
        {message ?? 'Connect a wallet to continue. On a phone you can pick your wallet app from the list.'}
      </p>
      <ConnectKitButton label="Connect wallet" />
    </div>
  )
}

/**
 * Renders an amber banner when the connected wallet is on the wrong chain.
 * Renders nothing when the wallet is disconnected or on the correct chain.
 * Place this at the top of any page that makes treasury transactions.
 */
export function WrongNetworkBanner() {
  const { isWrongNetwork, requiredChainId, connectedChainId } = useWrongNetwork()
  const { switchChain } = useSwitchChain()

  if (!isWrongNetwork) return null

  return (
    <div
      className="flex flex-wrap items-start gap-3 px-4 py-3 mb-4 text-sm"
      style={{
        background: 'var(--warning-dim)',
        border: '1px solid var(--warning-border)',
        color: 'var(--warning)',
      }}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
      <div className="flex-1 min-w-0" style={{ minWidth: 180, overflowWrap: 'anywhere' }}>
        Wrong network. Switch to Arc Mainnet to continue.
        {connectedChainId !== null && (
          <span> Your wallet is on chain ID {connectedChainId}.</span>
        )}
      </div>
      <button
        onClick={() => switchChain?.({ chainId: requiredChainId })}
        className="shrink-0 px-4 text-xs font-semibold"
        style={{
          minHeight: 44,
          background: 'var(--warning-dim)',
          border: '1px solid var(--warning-border)',
          color: 'var(--warning)',
          cursor: 'pointer',
        }}
      >
        Switch to Arc Mainnet
      </button>
    </div>
  )
}
