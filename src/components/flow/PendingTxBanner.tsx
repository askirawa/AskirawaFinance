import { Loader2 } from 'lucide-react'
import { useResumedTransactions } from '../../chain/pendingTx'
import { ExplorerLink } from './shared'

const TEXT = {
  pending: 'A transaction you submitted before this page reloaded is still waiting for network confirmation. It is not final yet.',
  confirmed: 'A transaction you submitted before this page reloaded is now confirmed on-chain.',
  failed: 'A transaction you submitted before this page reloaded failed on-chain. Nothing changed.',
  unknown: 'We could not find the result of a transaction submitted before this page reloaded. Check its receipt before trying again.',
} as const

/** Shows transactions that were still in flight when the page was reloaded, with their real current state. */
export default function PendingTxBanner() {
  const { items, dismiss } = useResumedTransactions()
  if (items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
      {items.map((t) => (
        <div key={t.hash} role="status" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px', background: 'var(--surface-muted)', border: '1px solid var(--border-strong)' }}>
          {t.phase === 'pending' && <Loader2 size={16} className="animate-spin" />}
          <span style={{ flex: 1, minWidth: 200, fontSize: 14, color: 'var(--ink-2)' }}>{TEXT[t.phase]}</span>
          <ExplorerLink hash={t.hash} label="View transaction" />
          {t.phase !== 'pending' && (
            <button onClick={() => dismiss(t.hash)} style={{ minHeight: 44, padding: '0 14px', background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: 'pointer' }}>Dismiss</button>
          )}
        </div>
      ))}
    </div>
  )
}
