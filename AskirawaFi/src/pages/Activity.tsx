import { useState } from 'react'
import { Search, Activity as ActivityIcon } from 'lucide-react'
import SectionCard from '../components/ui/SectionCard'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'

// Demo activity data — clearly labeled
const ALL_ACTIVITY = [
  { id: 1, type: 'Payroll', description: 'August Payroll', amount: '18,450', network: 'Arc', date: 'Oct 18, 2026', status: 'completed' as const },
  { id: 2, type: 'Vendor Settlement', description: 'Arc Project Services', amount: '7,250', network: 'Arc', date: 'Oct 18, 2026', status: 'completed' as const },
  { id: 3, type: 'Operations', description: 'Recurring Payment', amount: '3,800', network: 'Arc', date: 'Oct 17, 2026', status: 'completed' as const },
  { id: 4, type: 'Treasury Deposit', description: 'USDC Deposit', amount: '50,000', network: 'Arc', date: 'Oct 17, 2026', status: 'pending' as const },
  { id: 5, type: 'Payroll', description: 'July Payroll', amount: '18,450', network: 'Arc', date: 'Sep 30, 2026', status: 'completed' as const },
  { id: 6, type: 'Vendor Settlement', description: 'Software Subscriptions', amount: '2,100', network: 'Arc', date: 'Sep 28, 2026', status: 'completed' as const },
]

type FilterType = 'all' | 'payments' | 'deposits' | 'withdrawals'

const FILTERS: { id: FilterType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'payments', label: 'Payments' },
  { id: 'deposits', label: 'Deposits' },
  { id: 'withdrawals', label: 'Withdrawals' },
]

function matchesFilter(row: typeof ALL_ACTIVITY[0], filter: FilterType) {
  if (filter === 'all') return true
  if (filter === 'deposits') return row.type.toLowerCase().includes('deposit')
  if (filter === 'payments') return !row.type.toLowerCase().includes('deposit')
  return false
}

export default function Activity() {
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')

  const filtered = ALL_ACTIVITY.filter((row) => {
    const matchFilter = matchesFilter(row, filter)
    const matchSearch =
      !search ||
      [row.type, row.description, row.amount, row.network, row.date]
        .some((v) => v.toLowerCase().includes(search.toLowerCase()))
    return matchFilter && matchSearch
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Treasury Activity"
        title="Activity"
        subtitle="Track everything happening across your treasury."
      />

      {/* Demo notice */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          borderRadius: 10, padding: '10px 14px', fontSize: 12,
          background: 'var(--warning-dim)', border: '1px solid var(--warning-border)', color: 'var(--warning)',
        }}
      >
        <ActivityIcon size={13} />
        <span>
          Activity shown is demo data. Live on-chain transaction history requires an event indexer.
        </span>
      </div>

      {/* Filter + search toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => {
            const isActive = filter === f.id
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
                style={{
                  background: isActive ? 'var(--accent-dim)' : 'var(--surface-muted)',
                  border: isActive ? '1px solid var(--accent-border)' : '1px solid var(--border)',
                  color: isActive ? 'var(--accent)' : 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            )
          })}
        </div>

        <div
          className="flex items-center gap-2 rounded-lg px-3 flex-1 min-w-[200px] max-w-sm"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <Search size={14} style={{ color: 'var(--subtle)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity…"
            className="flex-1 bg-transparent text-sm outline-none py-2"
            style={{ color: 'var(--ink)', fontFamily: 'inherit' }}
          />
        </div>
      </div>

      {/* Table */}
      <SectionCard
        title="Recent Activity"
        actions={<span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={ActivityIcon}
            title="No results"
            description="Try adjusting your filters or search term."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Network</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{row.type}</td>
                    <td>{row.description}</td>
                    <td className="mono" style={{ color: 'var(--ink)', fontWeight: 600 }}>{row.amount} USDC</td>
                    <td>{row.network}</td>
                    <td>{row.date}</td>
                    <td>
                      <Badge variant={row.status === 'completed' ? 'success' : 'warning'}>
                        {row.status === 'completed' ? 'Completed' : 'Pending'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
