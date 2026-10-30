/**
 * Payroll Management page.
 *
 * What works (real on-chain):
 *   - USDC balance reads from Arc Mainnet ERC-20 contract
 *   - Each payment execution sends a real USDC `transfer()` on Arc Mainnet
 *   - Transaction hashes and confirmation status are verified on-chain
 *
 * What is local-only (not on-chain):
 *   - Batch records are stored in localStorage (not a contract or database)
 *   - Batch status is derived from individual payment confirmation state
 *   - Scheduling is UI-only — no keeper exists to auto-execute scheduled batches
 *
 * What requires future infrastructure:
 *   - Atomic batch execution (needs a dedicated PayrollBatch contract)
 *   - Automatic recurring payroll (needs a keeper/executor service)
 *   - Role-based access control (needs org roles contract or backend auth)
 */

import { useState, useMemo } from 'react'
import { useAccount } from 'wagmi'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import {
  Users,
  Plus,
  Search,
  Filter,
  AlertCircle,
  Info,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
} from 'lucide-react'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import CreateBatchModal from '../components/payroll/CreateBatchModal'
import BatchDetail from '../components/payroll/BatchDetail'
import {
  type PayrollBatch,
  type BatchStatus,
  BATCH_STATUS_LABELS,
  batchStatusVariant,
  getBatchStats,
  formatTs,
  formatBatchId,
} from '../lib/payroll'
import { usePayrollBatches, useUsdcBalance, usePayrollStats } from '../hooks/usePayroll'
import { WalletRequired } from '../components/WalletGate'
import { useNotifications } from '../context/NotificationContext'

// ─── Status filter options ────────────────────────────────────────────────────

const STATUS_FILTERS: Array<{ id: BatchStatus | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'processing', label: 'Processing' },
  { id: 'completed', label: 'Completed' },
  { id: 'partial', label: 'Partial' },
  { id: 'failed', label: 'Failed' },
  { id: 'draft', label: 'Draft' },
]

// ─── Batch row ────────────────────────────────────────────────────────────────

function BatchRow({
  batch,
  onClick,
}: {
  batch: PayrollBatch
  onClick: () => void
}) {
  const stats = getBatchStats(batch)

  const statusIcon = {
    draft: <Clock size={13} style={{ color: 'var(--subtle)' }} />,
    ready: <Clock size={13} style={{ color: 'var(--accent)' }} />,
    processing: <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent)' }} />,
    completed: <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />,
    partial: <AlertCircle size={13} style={{ color: 'var(--warning)' }} />,
    failed: <XCircle size={13} style={{ color: 'var(--danger)' }} />,
  }[batch.status]

  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors"
      style={{ borderBottom: '1px solid var(--border)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <td className="px-6 py-4">
        <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{batch.name}</div>
        <div className="text-xs mono mt-0.5" style={{ color: 'var(--subtle)' }}>{formatBatchId(batch.id)}</div>
      </td>
      <td className="px-6 py-4 text-sm" style={{ color: 'var(--muted)' }}>
        {formatTs(batch.createdAt)}
      </td>
      <td className="px-6 py-4 text-sm" style={{ color: 'var(--muted)' }}>
        {batch.scheduleType === 'scheduled' && batch.scheduledDate
          ? <span style={{ color: 'var(--warning)' }}>{new Date(batch.scheduledDate).toLocaleDateString()}</span>
          : batch.status === 'completed' && batch.completedAt
          ? formatTs(batch.completedAt)
          : <span style={{ color: 'var(--subtle)' }}>—</span>}
      </td>
      <td className="px-6 py-4 text-sm" style={{ color: 'var(--ink-2)' }}>
        {stats.employeeCount} emp.
      </td>
      <td className="px-6 py-4 text-sm font-semibold mono" style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
        {stats.totalFormatted} USDC
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-1.5">
          {statusIcon}
          <Badge variant={batchStatusVariant(batch.status)}>
            {BATCH_STATUS_LABELS[batch.status]}
          </Badge>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
          <span style={{ color: 'var(--accent)' }}>{stats.confirmedCount}</span>/{stats.employeeCount}
          {stats.failedCount > 0 && (
            <span className="ml-1" style={{ color: 'var(--danger)' }}>
              ({stats.failedCount} failed)
            </span>
          )}
        </div>
      </td>
      <td className="px-6 py-4">
        <ArrowUpRight size={14} style={{ color: 'var(--subtle)' }} />
      </td>
    </tr>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Payroll() {
  const { isConnected, address } = useAccount()
  const { emit } = useNotifications()
  const { batches, saveBatch, createDraft } = usePayrollBatches({ onNotify: emit })
  const { formatted: balanceFormatted, isLoading: balanceLoading } = useUsdcBalance()
  const stats = usePayrollStats(batches)

  const [showCreate, setShowCreate] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState<PayrollBatch | null>(null)
  const [statusFilter, setStatusFilter] = useState<BatchStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Filtered + searched batches
  const filteredBatches = useMemo(() => {
    let result = batches
    if (statusFilter !== 'all') result = result.filter(b => b.status === statusFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(b =>
        b.name.toLowerCase().includes(q) ||
        formatBatchId(b.id).toLowerCase().includes(q) ||
        b.payments.some(p =>
          p.name.toLowerCase().includes(q) ||
          p.walletAddress.toLowerCase().includes(q)
        )
      )
    }
    // Sort newest first
    return [...result].sort((a, b) => b.createdAt - a.createdAt)
  }, [batches, statusFilter, searchQuery])

  function handleCreateSubmit(params: {
    name: string
    entries: import('../lib/payroll').EmployeeEntry[]
    scheduleType: import('../lib/payroll').ScheduleType
    scheduledDate?: string
    note: string
  }) {
    const batch = createDraft({
      ...params,
      createdBy: address,
    })
    // Open the batch detail immediately after creation
    setSelectedBatch(batch)
  }

  function handleBatchUpdate(updated: PayrollBatch) {
    saveBatch(updated)
    // Keep selected batch in sync
    if (selectedBatch?.id === updated.id) {
      setSelectedBatch(updated)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Treasury Operations"
        title="Payroll"
        subtitle="Create and manage USDC payroll batches on Arc Mainnet."
        action={isConnected && (
          <Button icon={<Plus size={15} />} onClick={() => setShowCreate(true)}>
            Create Payroll
          </Button>
        )}
      />

      {/* Infrastructure notice */}
      <Card style={{ border: '1px solid rgba(232,184,76,0.18)', background: 'rgba(232,184,76,0.04)' }}>
        <CardBody className="flex items-start gap-3 py-3">
          <Info size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
          <div className="text-xs" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
            <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>How payroll works today: </span>
            Batch records are stored locally in your browser. Executing a batch sends individual USDC{' '}
            <code>transfer()</code> calls on Arc Mainnet — each requires a separate wallet confirmation and
            is not atomic. A future dedicated PayrollBatch contract will enable atomic batch execution
            and automatic scheduling.
          </div>
        </CardBody>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          {
            label: 'USDC Balance',
            value: !isConnected ? '—' : balanceLoading ? null : `$${balanceFormatted ?? '0.00'}`,
            note: 'Connected wallet',
            accent: true,
          },
          {
            label: 'Total Employees',
            value: String(stats.uniqueRecipients),
            note: 'Unique recipients',
          },
          {
            label: 'Payroll Batches',
            value: String(stats.totalBatches),
            note: `${stats.completedBatches} completed · ${stats.draftBatches} pending`,
          },
          {
            label: 'Confirmed Payments',
            value: String(stats.confirmedPayments),
            note: `${stats.pendingPayments} pending · ${stats.failedPayments} failed`,
          },
        ].map(({ label, value, note, accent }) => (
          <Card key={label} style={{ minHeight: 110 }}>
            <CardBody className="flex flex-col justify-between" style={{ minHeight: 110 }}>
              <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
                {label}
              </div>
              {value === null ? (
                <Spinner size={16} />
              ) : (
                <div
                  className="display text-2xl font-bold"
                  style={{ color: accent ? 'var(--accent)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {value}
                </div>
              )}
              <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{note}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Batch list */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            Payroll Batches
            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--muted)' }}>
              ({filteredBatches.length})
            </span>
          </h2>
          <div className="text-xs font-medium px-2 py-1 rounded-md" style={{ background: 'rgba(232,184,76,0.1)', color: 'var(--warning)' }}>
            Local records
          </div>
        </CardHeader>

        {/* Toolbar */}
        <div
          className="flex flex-wrap items-center gap-3 px-6 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--subtle)' }} />
            <input
              type="search"
              placeholder="Search batches or employees…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--ink)',
                fontSize: 13,
                padding: '7px 10px 7px 30px',
                outline: 'none',
              }}
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Filter size={13} style={{ color: 'var(--subtle)' }} />
            {STATUS_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  background: statusFilter === f.id ? 'var(--accent-dim)' : 'var(--surface-muted)',
                  border: `1px solid ${statusFilter === f.id ? 'var(--accent-border)' : 'var(--border)'}`,
                  color: statusFilter === f.id ? 'var(--accent)' : 'var(--muted)',
                  cursor: 'pointer',
                  minHeight: 28,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table or empty state */}
        {!isConnected ? (
          <CardBody>
            <WalletRequired message="Connect your wallet to create and manage payroll batches." />
          </CardBody>
        ) : filteredBatches.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={Users}
              title={batches.length === 0 ? 'No payroll batches yet' : 'No results match your filters'}
              description={
                batches.length === 0
                  ? 'Create your first payroll batch to send USDC to multiple employees in one operation.'
                  : 'Try adjusting your search or filter to find what you need.'
              }
              action={
                batches.length === 0 ? (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
                    style={{ background: 'var(--accent)', border: 'none', color: '#021a0e', cursor: 'pointer', minHeight: 38 }}
                  >
                    <Plus size={14} />
                    Create Payroll
                  </button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 800 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  {['Batch', 'Created', 'Pay Date', 'Employees', 'Amount', 'Status', 'Payments', ''].map(h => (
                    <th
                      key={h}
                      className="text-left text-xs uppercase tracking-wider px-6 py-3"
                      style={{ color: 'var(--subtle)', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: '0.07em' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map(batch => (
                  <BatchRow
                    key={batch.id}
                    batch={batch}
                    onClick={() => setSelectedBatch(batch)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modals */}
      {showCreate && (
        <CreateBatchModal
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreateSubmit}
        />
      )}
      {selectedBatch && (
        <BatchDetail
          batch={selectedBatch}
          onClose={() => setSelectedBatch(null)}
          onUpdate={handleBatchUpdate}
        />
      )}
    </div>
  )
}
