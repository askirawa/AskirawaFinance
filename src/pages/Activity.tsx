import { useMemo, useState } from 'react'
import { Download, History as HistoryIcon, Loader2 } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import { SetupNotice } from '../components/flow/shared'
import ActivityCard from '../components/activity/ActivityCard'
import { FILTERS, downloadCsv, matches, type Filter } from '../components/activity/model'
import { useHistory } from '../chain/history'
import { useTreasuryOverview } from '../chain/hooks'
import type { Navigate } from '../nav'

/** Everything that happened in the treasury, read from contract events. Replaces the old Transactions page. */
export default function Activity({ onNavigate }: { onNavigate: Navigate }) {
  const overview = useTreasuryOverview()
  const history = useHistory()
  const [filter, setFilter] = useState<Filter>('all')
  const rows = useMemo(() => history.items.filter((i) => matches(i, filter)), [history.items, filter])
  const configured = overview.state !== 'unconfigured'
  const scanning = configured && !history.complete && !history.error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader eyebrow="Records" title="Activity"
        subtitle="Funds added, requests, approvals and payments, read from the treasury contract."
        action={configured && (
          <button type="button" onClick={() => downloadCsv(rows)} disabled={rows.length === 0}
            style={{ minHeight: 44, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.4 }}>
            <span className="feature-icon" style={{ display: 'inline-flex' }}><Download size={15} /></span> Export CSV
          </button>
        )} />
      <SetupNotice overview={overview} />

      {configured && (
        <>
          <div role="group" aria-label="Filter activity" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                style={{ minHeight: 44, padding: '0 16px', cursor: 'pointer', fontSize: 14, background: filter === f.id ? 'var(--ink)' : 'transparent', color: filter === f.id ? 'var(--bg)' : 'var(--ink)', border: `1px solid ${filter === f.id ? 'var(--ink)' : 'var(--border-strong)'}`, fontWeight: filter === f.id ? 600 : 400 }}>
                {f.label}
              </button>
            ))}
          </div>

          <div role="status" style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {scanning && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Loader2 size={14} className="animate-spin" />
                {history.scannedTo !== null && history.head !== null
                  ? `Reading history from block ${history.scannedTo} to ${history.head}`
                  : 'Starting to read history'}
              </span>
            )}
            {history.limited && <span>Showing recent activity only because the deployment block is not configured.</span>}
            {history.error && <span role="alert" style={{ color: 'var(--danger)' }}>Could not read history: {history.error}</span>}
          </div>

          {rows.length === 0 ? (
            scanning ? null : (
              <EmptyState icon={HistoryIcon}
                title={history.items.length === 0 ? 'No activity yet' : 'Nothing matches this filter'}
                description={history.items.length === 0
                  ? 'When funds are added or requests are made, they will appear here.'
                  : 'Try another filter to see the rest of the activity.'} />
            )
          ) : (
            <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map((item) => <ActivityCard key={item.key} item={item} onNavigate={onNavigate} />)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
