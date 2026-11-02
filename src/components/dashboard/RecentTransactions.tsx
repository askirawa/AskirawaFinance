import SectionCard from '../ui/SectionCard'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import { ACTION_LABEL, dateTime, usdc } from '../../chain/format'
import type { ActivityItem, HistoryState } from '../../chain/history'
import { useLabels } from '../../chain/addressBook'
import { ExplorerLink } from '../flow/shared'
import { shortAddress } from '../../chain/format'

const KINDS = new Set(['payment', 'schedule-payment', 'funds-added'])

export function recentTransactions(history: HistoryState): ActivityItem[] {
  // A confirmed non-payroll request (for example registering a schedule) moves no money, so it is not listed here.
  return history.items.filter((i) => KINDS.has(i.kind) && (i.kind !== 'payment' || Number(i.detail) === 1)).slice(0, 6)
}

function describe(i: ActivityItem, nameOf: (a: string) => string | undefined): string {
  if (i.kind === 'funds-added') return 'Funds added'
  if (i.kind === 'schedule-payment') {
    const to = i.counterparty ? (nameOf(i.counterparty) ?? shortAddress(i.counterparty)) : 'recipient'
    return `Recurring payment to ${to}`
  }
  const action = Number(i.detail)
  return action === 1 ? 'Payroll paid' : `${ACTION_LABEL[action] ?? 'Request'} completed`
}

export default function RecentTransactions({ history, onViewAll }: { history: HistoryState; onViewAll: () => void }) {
  const { nameOf } = useLabels()
  const rows = recentTransactions(history)
  const scanning = !history.complete && !history.error
  return (
    <SectionCard label="Latest" title="Recent transactions" actions={<Button variant="secondary" arrow={false} className="min-h-[44px]" onClick={onViewAll}>View all activity</Button>}>
      {rows.length === 0 ? (
        <div role="status" style={{ padding: 20, color: 'var(--muted)', fontSize: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
          {scanning ? <><Spinner size={16} /> Reading recent activity…</>
            : history.error ? 'Could not read recent activity right now. It will retry automatically.'
              : 'No transactions yet.'}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((i) => (
            <li key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--border)', minHeight: 56 }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ color: 'var(--ink)', fontWeight: 600, overflowWrap: 'anywhere' }}>{describe(i, nameOf)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{i.timestamp ? dateTime(i.timestamp) : `Block ${i.blockNumber.toString()}`}</div>
              </div>
              {i.amount !== undefined && i.amount > 0n && (
                <div className="mono" style={{ color: i.kind === 'funds-added' ? 'var(--success)' : 'var(--ink)', whiteSpace: 'nowrap' }}>
                  {i.kind === 'funds-added' ? '+' : ''}{usdc(i.amount)} USDC
                </div>
              )}
              <ExplorerLink hash={i.txHash} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
