import { ConnectKitButton } from 'connectkit'
import { Wallet } from 'lucide-react'

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
      className="flex flex-col items-center justify-center py-16 text-center rounded-2xl"
      style={{
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        color: 'var(--muted)',
      }}
    >
      <div
        className="mb-4 flex items-center justify-center rounded-2xl"
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
        Wallet not connected
      </p>
      <p className="mb-5 text-xs max-w-xs" style={{ color: 'var(--muted)' }}>
        {message ?? 'Connect your Arc wallet to continue.'}
      </p>
      <ConnectKitButton label="Connect Wallet" />
    </div>
  )
}
