/**
 * AuditLog — Treasury activity audit trail.
 *
 * DISCLOSURE:
 * This is a browser-local audit log stored in this browser's storage.
 * It is NOT tamper-proof, cryptographically signed, or independently verified.
 * On-chain confirmed events are identified by a recorded txHash from the
 * actual transaction receipt. All other events are local application records.
 */

import { Fragment, useState, useMemo, useCallback } from 'react'
import { Shield, Download, Filter, Search, ChevronDown, ChevronUp } from 'lucide-react'
import {
  loadAuditLog,
  downloadAuditCsv,
  logAuditEvent,
  CATEGORY_LABELS,
  ACTION_LABELS,
  OUTCOME_LABELS,
  outcomeVariant,
  formatAuditTs,
  formatAuditId,
  type AuditEntry,
  type AuditCategory,
  type AuditOutcome,
} from '../lib/audit'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'

type SortField = 'timestamp' | 'category' | 'outcome'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 25

export default function AuditLog() {
  const [entries] = useState<AuditEntry[]>(() => [...loadAuditLog()].reverse())
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<AuditCategory | 'all'>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<AuditOutcome | 'all'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortField, setSortField] = useState<SortField>('timestamp')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = [...entries]

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        e.description.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (e.actorAddress ?? '').toLowerCase().includes(q) ||
        (e.txHash ?? '').toLowerCase().includes(q) ||
        (e.entityId ?? '').toLowerCase().includes(q) ||
        (e.entityLabel ?? '').toLowerCase().includes(q)
      )
    }
    if (categoryFilter !== 'all') list = list.filter(e => e.category === categoryFilter)
    if (outcomeFilter !== 'all') list = list.filter(e => e.outcome === outcomeFilter)
    if (dateFrom) {
      const from = new Date(dateFrom).getTime()
      list = list.filter(e => e.timestamp >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59').getTime()
      list = list.filter(e => e.timestamp <= to)
    }

    list.sort((a, b) => {
      let diff = 0
      if (sortField === 'timestamp') diff = a.timestamp - b.timestamp
      else if (sortField === 'category') diff = a.category.localeCompare(b.category)
      else if (sortField === 'outcome') diff = a.outcome.localeCompare(b.outcome)
      return sortDir === 'asc' ? diff : -diff
    })

    return list
  }, [entries, search, categoryFilter, outcomeFilter, dateFrom, dateTo, sortField, sortDir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function resetPage() { setPage(0) }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const handleExport = useCallback(() => {
    downloadAuditCsv(filtered, `askirawa-finance-audit-${new Date().toISOString().slice(0, 10)}.csv`)
    logAuditEvent({
      category: 'analytics',
      action: 'audit_log_exported',
      actorAddress: null,
      description: `Audit log exported: ${filtered.length} entr${filtered.length !== 1 ? 'ies' : 'y'} (current filters).`,
      outcome: 'success',
    })
  }, [filtered])

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-muted)',
    border: '1px solid var(--border)',
    color: 'var(--ink-2)',
    fontSize: 12,
    padding: '6px 10px',
    minHeight: 44,
    maxWidth: '100%',
    cursor: 'pointer',
    outline: 'none',
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDir === 'asc'
      ? <ChevronUp size={12} style={{ display: 'inline' }} />
      : <ChevronDown size={12} style={{ display: 'inline' }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow="Records"
        title="Audit Log"
        subtitle={`A record of actions taken in this app. ${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'} saved in this browser.`}
        action={
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--accent)', border: 'none',
              color: 'var(--bg)', fontSize: 13, minHeight: 44,
              fontWeight: 700, cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
              padding: '8px 16px', opacity: filtered.length === 0 ? 0.4 : 1,
            }}
          >
            <Download size={14} />
            Export CSV ({filtered.length})
          </button>
        }
      />

      {/* Disclosure */}
      <div
        style={{
          padding: '10px 14px',
          background: 'var(--warning-dim)',
          border: '1px solid var(--warning-border)',
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--warning)',
        }}
      >
        This log is saved in this browser only. Anyone who uses this browser can change or delete it, and it is not independently verified.
        Entries with a transaction hash were recorded after the network confirmed the transaction. All other entries are notes made by this app.
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: 12 }}>
        {[
          { label: 'Total entries', value: entries.length },
          { label: 'Successful', value: entries.filter(e => e.outcome === 'success').length },
          { label: 'Failed', value: entries.filter(e => e.outcome === 'failure').length },
          { label: 'Pending', value: entries.filter(e => e.outcome === 'pending').length },
          { label: 'With transaction hash', value: entries.filter(e => !!e.txHash).length },
        ].map(s => (
          <Card key={s.label}>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filter bar */}
      <Card>
        <div style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <Filter size={14} style={{ color: 'var(--subtle)', flexShrink: 0 }} />

          {/* Search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 160px', minWidth: 0, maxWidth: 260 }}>
            <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--subtle)', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Search entries"
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage() }}
              style={{ ...inputStyle, paddingLeft: 28, width: '100%', cursor: 'text' }}
            />
          </div>

          <select
            value={categoryFilter}
            onChange={e => { setCategoryFilter(e.target.value as AuditCategory | 'all'); resetPage() }}
            style={inputStyle}
          >
            <option value="all">All categories</option>
            {(Object.keys(CATEGORY_LABELS) as AuditCategory[]).map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>

          <select
            value={outcomeFilter}
            onChange={e => { setOutcomeFilter(e.target.value as AuditOutcome | 'all'); resetPage() }}
            style={inputStyle}
          >
            <option value="all">All outcomes</option>
            {(['success', 'failure', 'pending', 'info'] as AuditOutcome[]).map(o => (
              <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
            ))}
          </select>

          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); resetPage() }} style={inputStyle} />
          <span style={{ fontSize: 12, color: 'var(--subtle)' }}>to</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); resetPage() }} style={inputStyle} />

          <span style={{ fontSize: 12, color: 'var(--subtle)', marginLeft: 'auto' }}>
            {filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}
          </span>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>Audit entries</span>
        </CardHeader>
        <CardBody style={{ padding: 0, overflowX: 'auto' }}>
          {paginated.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="No audit entries"
              description={entries.length === 0
                ? 'Entries will appear here as you use Askirawa Finance.'
                : 'Nothing matches these filters. Change a filter to see more.'}
            />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {[
                    { label: 'Timestamp', field: 'timestamp' as SortField },
                    { label: 'Category', field: 'category' as SortField },
                    { label: 'Action', field: null },
                    { label: 'Description', field: null },
                    { label: 'Actor', field: null },
                    { label: 'Outcome', field: 'outcome' as SortField },
                    { label: 'Reference', field: null },
                  ].map(col => (
                    <th
                      key={col.label}
                      onClick={col.field ? () => toggleSort(col.field) : undefined}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--subtle)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        cursor: col.field ? 'pointer' : 'default',
                        whiteSpace: 'nowrap',
                        userSelect: 'none',
                      }}
                    >
                      {col.label}
                      {col.field && <SortIcon field={col.field} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((e, idx) => {
                  const isExpanded = expandedId === e.id
                  return (
                    <Fragment key={e.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : e.id)}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                          transition: 'background 0.1s',
                        }}
                      >
                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>
                          {formatAuditTs(e.timestamp)}
                        </td>
                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                          <Badge variant="neutral">{CATEGORY_LABELS[e.category]}</Badge>
                        </td>
                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: 'var(--ink-2)', fontWeight: 500 }}>
                          {ACTION_LABELS[e.action]}
                        </td>
                        <td style={{ padding: '10px 16px', color: 'var(--muted)', maxWidth: 280 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.description}
                          </div>
                        </td>
                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: 'var(--muted)', fontFamily: 'monospace', fontSize: 12 }}>
                          {e.actorAddress
                            ? `${e.actorAddress.slice(0, 6)}…${e.actorAddress.slice(-4)}`
                            : <span style={{ color: 'var(--subtle)' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                          <Badge variant={outcomeVariant(e.outcome)}>{OUTCOME_LABELS[e.outcome]}</Badge>
                        </td>
                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>
                          {e.entityLabel
                            ? <span style={{ color: 'var(--subtle)' }}>{e.entityLabel}</span>
                            : e.entityId
                              ? <span style={{ color: 'var(--subtle)' }}>{formatAuditId(e.entityId)}</span>
                              : <span style={{ color: 'var(--subtle)' }}>—</span>}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${e.id}-expand`} style={{ background: 'var(--surface-muted)' }}>
                          <td colSpan={7} style={{ padding: '12px 16px 14px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
                              <Detail label="Entry ID" value={e.id} mono />
                              <Detail label="Timestamp" value={formatAuditTs(e.timestamp)} />
                              <Detail label="Category" value={CATEGORY_LABELS[e.category]} />
                              <Detail label="Action" value={ACTION_LABELS[e.action]} />
                              <Detail label="Outcome" value={OUTCOME_LABELS[e.outcome]} />
                              <Detail label="Actor" value={e.actorAddress ?? 'Unknown'} mono />
                              {e.entityId && <Detail label="Related item ID" value={e.entityId} mono />}
                              {e.entityLabel && <Detail label="Related item" value={e.entityLabel} />}
                              {e.txHash && (
                                <div>
                                  <div style={{ fontSize: 11, color: 'var(--subtle)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Transaction hash
                                  </div>
                                  <a
                                    href={`https://explorer.arc.io/tx/${e.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'monospace', wordBreak: 'break-all' }}
                                    onClick={ev => ev.stopPropagation()}
                                  >
                                    {e.txHash}
                                  </a>
                                </div>
                              )}
                              {e.orgId && <Detail label="Organization ID" value={e.orgId} mono />}
                              <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ fontSize: 11, color: 'var(--subtle)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</div>
                                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{e.description}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ ...inputStyle, opacity: page === 0 ? 0.4 : 1 }}
          >
            Previous
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{ ...inputStyle, opacity: page >= totalPages - 1 ? 0.4 : 1 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--subtle)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  )
}
