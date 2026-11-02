import { ExplorerLink, Who } from '../flow/shared'
import { dateTime, usdc } from '../../chain/format'
import type { ActivityItem } from '../../chain/history'
import type { Navigate } from '../../nav'
import { detailOf, titleOf, whoLabel } from './model'

const MONO = "'JetBrains Mono', monospace"
const small = { fontSize: 13, color: 'var(--muted)' } as const

export default function ActivityCard({ item, onNavigate }: { item: ActivityItem; onNavigate: Navigate }) {
  const detail = detailOf(item)
  const failed = item.kind === 'schedule-failed'
  return (
    <li style={{ listStyle: 'none', padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${failed ? 'var(--danger)' : 'var(--border-strong)'}` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, color: 'var(--ink)' }}>{titleOf(item)}</strong>
        {item.amount !== undefined && <span className="mono" style={{ fontSize: 15, color: 'var(--ink)' }}>{usdc(item.amount)} USDC</span>}
      </div>
      {detail && <div style={{ ...small, marginTop: 4 }}>{detail}</div>}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--ink-2)' }}>
        {item.counterparty && <div><span style={small}>To </span><Who address={item.counterparty} /></div>}
        {item.actor && <div><span style={small}>{whoLabel(item.kind) ?? 'By'} </span><Who address={item.actor} /></div>}
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.04em', color: 'var(--subtle)' }}>
          {item.timestamp !== undefined ? dateTime(item.timestamp) : `Block ${item.blockNumber}`}
        </span>
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          {item.requestId !== undefined && item.kind !== 'resumed' && (
            <button type="button" onClick={() => onNavigate('approvals', { requestId: item.requestId })}
              style={{ minHeight: 44, padding: '0 12px', background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: 'pointer', fontSize: 13 }}>
              Open request
            </button>
          )}
          <span style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center' }}><ExplorerLink hash={item.txHash} /></span>
        </span>
      </div>
    </li>
  )
}
