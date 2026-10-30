/**
 * Analytics — Treasury Analytics & Reports
 *
 * Data sources:
 *   - Live USDC balance: read from Arc Mainnet USDC ERC-20 contract (on-chain).
 *   - Transaction records: aggregated from browser localStorage (payroll, recurring, approvals).
 *
 * Records are labeled by verification level:
 *   - "On-chain confirmed" = has a txHash confirmed via waitForTransactionReceipt on Arc Mainnet.
 *   - "Submitted" = has a txHash but confirmation is pending or failed.
 *   - "Local record" = no txHash (draft, scheduled-not-yet-run, or locally stored only).
 *
 * Historical incoming transfers are NOT available without an event indexer
 * (see src/lib/analytics.ts for the full note).
 */

import { useState, useMemo, useCallback } from 'react'
import { useAnalytics, buildDateRange } from '../hooks/useAnalytics'
import { useNotifications } from '../context/NotificationContext'
import { useAccount } from 'wagmi'
import type { TxFilter, DateRangePreset, AnalyticsTx, TxCategory, TxDirection, TxVerification } from '../lib/analytics'
import { DATE_RANGE_LABELS, formatUsdcBigint, parseUsdcSafe } from '../lib/analytics'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import CashFlowChart from '../components/charts/CashFlowChart'
import DonutChart from '../components/charts/DonutChart'
import {
  BarChart2,
  Download,
  ExternalLink,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Minus,
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  Info,
  Wallet,
} from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESETS: DateRangePreset[] = ['last7', 'last30', 'last90', 'thisMonth', 'prevMonth', 'custom']

const CATEGORY_LABELS: Record<TxCategory | 'all', string> = {
  all: 'All Categories',
  payroll: 'Payroll',
  recurring: 'Recurring Payments',
  approval_transfer: 'Treasury Transfers',
  automation: 'Automations',
}

const STATUS_LABELS: Record<TxVerification | 'all', string> = {
  all: 'All Statuses',
  on_chain_confirmed: 'On-chain Confirmed',
  submitted_unconfirmed: 'Submitted',
  local_only: 'Local Record',
}

const PAGE_SIZE = 20

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  loading,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  color?: string
  loading?: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={15} style={{ color: color ?? 'var(--subtle)' }} strokeWidth={1.5} />
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
      </div>
      {loading ? (
        <div style={{ height: 28, display: 'flex', alignItems: 'center' }}>
          <Spinner size={16} />
        </div>
      ) : (
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif", fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
      )}
      {sub && <span style={{ fontSize: 11, color: 'var(--subtle)' }}>{sub}</span>}
    </div>
  )
}

function VerificationBadge({ status }: { status: TxVerification }) {
  if (status === 'on_chain_confirmed') return <Badge variant="success">Confirmed</Badge>
  if (status === 'submitted_unconfirmed') return <Badge variant="warning">Submitted</Badge>
  return <Badge variant="neutral">Local</Badge>
}

function DirectionChip({ direction }: { direction: TxDirection }) {
  if (direction === 'outgoing') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--danger)' }}>
      <TrendingDown size={12} strokeWidth={2} /> Out
    </span>
  )
  if (direction === 'incoming') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--accent)' }}>
      <TrendingUp size={12} strokeWidth={2} /> In
    </span>
  )
  return <span style={{ fontSize: 12, color: 'var(--subtle)' }}>—</span>
}

function TxRow({ tx }: { tx: AnalyticsTx }) {
  const dt = new Date(tx.timestamp)
  const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  const catColors: Record<TxCategory, string> = {
    payroll: 'var(--accent)',
    recurring: '#6366f1',
    approval_transfer: '#f59e0b',
    automation: '#8b5cf6',
  }

  const catLabels: Record<TxCategory, string> = {
    payroll: 'Payroll',
    recurring: 'Recurring',
    approval_transfer: 'Transfer',
    automation: 'Automation',
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Date */}
      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        <div style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{dateStr}</div>
        <div style={{ color: 'var(--subtle)' }}>{timeStr}</div>
      </td>

      {/* Category */}
      <td style={{ padding: '10px 12px' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: catColors[tx.category] ?? 'var(--muted)',
            background: `${catColors[tx.category] ?? 'var(--border)'}18`,
            borderRadius: 6,
            padding: '2px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {catLabels[tx.category] ?? tx.category}
        </span>
      </td>

      {/* Description */}
      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span title={tx.label}>{tx.label}</span>
      </td>

      {/* To */}
      <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
        {tx.toAddress ? `${tx.toAddress.slice(0, 6)}…${tx.toAddress.slice(-4)}` : '—'}
      </td>

      {/* Direction + Amount */}
      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div><DirectionChip direction={tx.direction} /></div>
        <div style={{ fontSize: 13, fontWeight: 700, color: tx.direction === 'outgoing' ? 'var(--ink-2)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
          {tx.direction === 'outgoing' ? '-' : '+'}{formatUsdcBigint(parseUsdcSafe(tx.amountUsdc))} USDC
        </div>
      </td>

      {/* Verification */}
      <td style={{ padding: '10px 12px' }}>
        <VerificationBadge status={tx.status} />
      </td>

      {/* Tx Hash */}
      <td style={{ padding: '10px 12px' }}>
        {tx.txHash ? (
          <a
            href={tx.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent)', fontFamily: 'monospace', textDecoration: 'none' }}
          >
            {tx.txHash.slice(0, 8)}…
            <ExternalLink size={10} />
          </a>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--subtle)' }}>No hash</span>
        )}
      </td>
    </tr>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Analytics() {
  const { address: walletAddress } = useAccount()
  const { logAudit } = useNotifications()

  // Date range state
  const [preset, setPreset] = useState<DateRangePreset>('last30')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const dateRange = useMemo(
    () => buildDateRange(preset, customFrom || undefined, customTo || undefined),
    [preset, customFrom, customTo]
  )

  // Filter state
  const [category, setCategory] = useState<TxCategory | 'all'>('all')
  const [direction, setDirection] = useState<TxDirection | 'all'>('all')
  const [verStatus, setVerStatus] = useState<TxVerification | 'all'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const filter: TxFilter = useMemo(() => ({
    dateRange,
    category,
    direction,
    status: verStatus,
    search,
  }), [dateRange, category, direction, verStatus, search])

  const {
    address,
    isConnected,
    isCorrectChain,
    usdcBalanceFormatted,
    balanceLoading,
    refetchBalance,
    summary,
    dailyBuckets,
    categoryBreakdown,
    sortedRecords,
    allTxCount,
    exportCsv,
  } = useAnalytics(filter)

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE))
  const pagedRecords = sortedRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handlePresetChange = useCallback((p: DateRangePreset) => {
    setPreset(p)
    setPage(1)
  }, [])

  const handleFilterChange = useCallback(() => setPage(1), [])

  const handleExportCsv = useCallback(() => {
    if (sortedRecords.length === 0) return
    exportCsv()
    logAudit({
      category: 'analytics',
      action: 'csv_exported',
      actorAddress: walletAddress ?? null,
      description: `Treasury analytics CSV exported. ${sortedRecords.length} records, period: ${preset}.`,
      outcome: 'success',
      meta: { recordCount: sortedRecords.length, period: preset },
    })
  }, [exportCsv, logAudit, sortedRecords.length, walletAddress, preset])

  // Net flow formatting
  const netFlowPos = summary.netFlowRaw >= 0n
  const netFlowStr = (netFlowPos ? '+' : '-') + formatUsdcBigint(netFlowPos ? summary.netFlowRaw : -summary.netFlowRaw)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif", margin: 0 }}>
            Treasury Analytics
          </h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Arc Mainnet · USDC · {isConnected ? (address?.slice(0, 6) + '…' + address?.slice(-4)) : 'Wallet not connected'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => void refetchBalance()}
            title="Refresh balance"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleExportCsv}
            disabled={sortedRecords.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: sortedRecords.length > 0 ? 'var(--accent)' : 'var(--surface)',
              color: sortedRecords.length > 0 ? '#021a0e' : 'var(--subtle)',
              border: 'none', borderRadius: 10, padding: '8px 16px',
              fontSize: 13, fontWeight: 600, cursor: sortedRecords.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            <Download size={14} strokeWidth={2} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Data source notice */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
          background: 'rgba(100,149,237,0.07)', border: '1px solid rgba(100,149,237,0.2)',
          borderRadius: 12, fontSize: 12, color: 'var(--muted)',
        }}
      >
        <Info size={14} style={{ color: '#6495ed', flexShrink: 0, marginTop: 1 }} strokeWidth={1.5} />
        <span>
          <strong style={{ color: 'var(--ink-2)' }}>Data sources:</strong>{' '}
          USDC balance is read live from Arc Mainnet. Transaction records are aggregated from browser localStorage
          (payroll, recurring payments, approvals). Records labeled <strong>"On-chain confirmed"</strong> have a verified
          transaction hash. Records labeled <strong>"Local"</strong> exist only in this browser.
          Historical incoming transfers require an event indexer not yet deployed.
        </span>
      </div>

      {/* Date range selector */}
      <Card>
        <CardBody>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginRight: 4 }}>Period:</span>
            {PRESETS.map(p => (
              <button
                key={p}
                onClick={() => handlePresetChange(p)}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  background: preset === p ? 'var(--accent)' : 'var(--surface-muted)',
                  color: preset === p ? '#021a0e' : 'var(--muted)',
                  border: preset === p ? 'none' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                {DATE_RANGE_LABELS[p]}
              </button>
            ))}
            {preset === 'custom' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 4 }}>
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); handleFilterChange() }}
                  style={{ padding: '4px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--ink)', fontSize: 12 }}
                />
                <span style={{ color: 'var(--subtle)', fontSize: 12 }}>to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => { setCustomTo(e.target.value); handleFilterChange() }}
                  style={{ padding: '4px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--ink)', fontSize: 12 }}
                />
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Summary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <MetricCard
          label="Wallet USDC Balance"
          value={usdcBalanceFormatted ? `$${usdcBalanceFormatted}` : isConnected && isCorrectChain ? '—' : 'Connect wallet'}
          sub={isCorrectChain ? 'Live · Arc Mainnet' : 'Wrong network'}
          icon={Wallet}
          color="var(--accent)"
          loading={balanceLoading}
        />
        <MetricCard
          label="Total Outgoing"
          value={`$${formatUsdcBigint(summary.totalOutgoingRaw)}`}
          sub="App records · period"
          icon={TrendingDown}
          color="var(--danger)"
        />
        <MetricCard
          label="Total Incoming"
          value={`$${formatUsdcBigint(summary.totalIncomingRaw)}`}
          sub="App records · period"
          icon={TrendingUp}
          color="var(--accent)"
        />
        <MetricCard
          label="Net Cash Flow"
          value={netFlowStr}
          sub="App records · period"
          icon={Minus}
          color={netFlowPos ? 'var(--accent)' : 'var(--danger)'}
        />
        <MetricCard
          label="Payroll Sent"
          value={`$${formatUsdcBigint(summary.payrollOutgoingRaw)}`}
          sub="Period"
          icon={Activity}
          color="#6366f1"
        />
        <MetricCard
          label="Confirmed Txs"
          value={String(summary.confirmedCount)}
          sub="On-chain verified"
          icon={CheckCircle}
          color="var(--accent)"
        />
        <MetricCard
          label="Pending / Submitted"
          value={String(summary.pendingCount)}
          sub="Awaiting confirmation"
          icon={Clock}
          color="var(--warning)"
        />
        <MetricCard
          label="Local Records"
          value={String(summary.totalCount - summary.confirmedCount - summary.pendingCount)}
          sub="No tx hash"
          icon={XCircle}
          color="var(--subtle)"
        />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 16 }}>
        <Card>
          <CardHeader>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>Cash Flow</span>
            <span style={{ fontSize: 11, color: 'var(--subtle)' }}>Daily outgoing vs incoming USDC · app records</span>
          </CardHeader>
          <CardBody>
            <CashFlowChart buckets={dailyBuckets} height={160} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>By Category</span>
          </CardHeader>
          <CardBody style={{ display: 'flex', justifyContent: 'center' }}>
            <DonutChart slices={categoryBreakdown} size={160} />
          </CardBody>
        </Card>
      </div>

      {/* Transaction table */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChart2 size={16} style={{ color: 'var(--accent)' }} strokeWidth={1.5} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>
              Transaction History
            </span>
            <span style={{ fontSize: 12, color: 'var(--subtle)' }}>
              {sortedRecords.length} records · {allTxCount} total
            </span>
          </div>
          <button
            onClick={handleExportCsv}
            disabled={sortedRecords.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface-muted)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500,
              color: sortedRecords.length > 0 ? 'var(--ink-2)' : 'var(--subtle)',
              cursor: sortedRecords.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            <Download size={12} strokeWidth={2} />
            CSV
          </button>
        </CardHeader>

        {/* Filters */}
        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
          }}
        >
          <input
            placeholder="Search hash, address, description…"
            value={search}
            onChange={e => { setSearch(e.target.value); handleFilterChange() }}
            style={{
              flex: '1 1 200px', padding: '6px 12px', background: 'var(--surface-muted)',
              border: '1px solid var(--border)', borderRadius: 8, color: 'var(--ink)', fontSize: 12,
            }}
          />
          <select
            value={category}
            onChange={e => { setCategory(e.target.value as TxCategory | 'all'); handleFilterChange() }}
            style={{ padding: '6px 10px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--ink)', fontSize: 12 }}
          >
            {(Object.keys(CATEGORY_LABELS) as (TxCategory | 'all')[]).map(k => (
              <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
            ))}
          </select>
          <select
            value={direction}
            onChange={e => { setDirection(e.target.value as TxDirection | 'all'); handleFilterChange() }}
            style={{ padding: '6px 10px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--ink)', fontSize: 12 }}
          >
            <option value="all">All Directions</option>
            <option value="outgoing">Outgoing</option>
            <option value="incoming">Incoming</option>
          </select>
          <select
            value={verStatus}
            onChange={e => { setVerStatus(e.target.value as TxVerification | 'all'); handleFilterChange() }}
            style={{ padding: '6px 10px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--ink)', fontSize: 12 }}
          >
            {(Object.keys(STATUS_LABELS) as (TxVerification | 'all')[]).map(k => (
              <option key={k} value={k}>{STATUS_LABELS[k]}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        {sortedRecords.length === 0 ? (
          <EmptyState
            icon={BarChart2}
            title="No transactions in this period"
            description="Execute payroll batches, recurring payments, or treasury transfers to see records here."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface-muted)' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--subtle)', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--subtle)', fontWeight: 600 }}>Category</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--subtle)', fontWeight: 600 }}>Description</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--subtle)', fontWeight: 600 }}>To</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: 'var(--subtle)', fontWeight: 600 }}>Amount</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--subtle)', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--subtle)', fontWeight: 600 }}>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {pagedRecords.map(tx => <TxRow key={tx.key} tx={tx} />)}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Page {page} of {totalPages} · {sortedRecords.length} records
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    style={{ padding: '5px 12px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: page === 1 ? 'var(--subtle)' : 'var(--ink)', cursor: page === 1 ? 'not-allowed' : 'pointer' }}
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    style={{ padding: '5px 12px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: page === totalPages ? 'var(--subtle)' : 'var(--ink)', cursor: page === totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Missing infrastructure note */}
      <Card>
        <CardBody>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Info size={16} style={{ color: 'var(--subtle)', flexShrink: 0, marginTop: 2 }} strokeWidth={1.5} />
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              <strong style={{ color: 'var(--ink-2)' }}>For complete on-chain analytics:</strong>{' '}
              Historical incoming USDC transfers require an event indexer (Envio, The Graph, or a custom
              eth_getLogs scanner) that queries Transfer events on the Arc Mainnet USDC contract for the treasury wallet.
              Until deployed, only outgoing records from this application are available.
              Contact your technical team to set up the indexer, or use the{' '}
              <a
                href="https://explorer.arc.io"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
              >
                Arc Explorer <ExternalLink size={10} />
              </a>{' '}
              to view the full transaction history for your wallet address.
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
