/**
 * RecurringPayments page — create, manage, and monitor recurring USDC schedules.
 *
 * Each execution is a manual wallet-signed USDC ERC-20 transfer.
 * Automatic execution requires a keeper service (not yet deployed).
 */

import { useState, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { Plus, Clock, Search, Filter, PlayCircle, PauseCircle, Info, ArrowRight } from 'lucide-react'
import Badge from '../components/ui/Badge'
import { WalletRequired } from '../components/WalletGate'
import CreateScheduleModal from '../components/recurring/CreateScheduleModal'
import ScheduleDetail from '../components/recurring/ScheduleDetail'
import {
  type RecurringSchedule,
  type ScheduleStatus,
  type Frequency,
  SCHEDULE_STATUS_LABELS,
  FREQUENCY_LABELS,
  scheduleStatusVariant,
  formatUsdcBigint,
  parseUsdcString,
  formatScheduleId,
  nextExecutionDate,
} from '../lib/recurring'
import {
  useRecurringSchedules,
  useRecurringStats,
  useUsdcBalance,
} from '../hooks/useRecurring'
import { ARC_MAINNET_CHAIN_ID as _ARC_MAINNET_CHAIN_ID } from '../config'
import { useNotifications } from '../context/NotificationContext'

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `1px solid ${accent ? 'var(--accent-border)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: '20px',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: accent ? 'var(--accent)' : 'var(--ink)',
          fontFamily: "'Space Grotesk', sans-serif",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ─── Schedule row ─────────────────────────────────────────────────────────────

function ScheduleRow({
  schedule,
  onClick,
  onPause,
  onResume,
}: {
  schedule: RecurringSchedule
  onClick: () => void
  onPause: () => void
  onResume: () => void
}) {
  const next = nextExecutionDate(schedule)
  let amountRaw = 0n
  try { amountRaw = parseUsdcString(schedule.amountUsdc) } catch { /* noop */ }

  const confirmedCount = schedule.executionHistory.filter(e => e.status === 'confirmed').length
  const totalPaidRaw = schedule.executionHistory
    .filter(e => e.status === 'confirmed')
    .reduce((acc, e) => {
      try { return acc + parseUsdcString(e.amountUsdc) } catch { return acc }
    }, 0n)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto auto',
        gap: 16,
        alignItems: 'center',
        padding: '14px 16px',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onClick={onClick}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-muted)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {/* Name + details */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{schedule.name}</span>
          <Badge variant={scheduleStatusVariant(schedule.status)}>
            {SCHEDULE_STATUS_LABELS[schedule.status]}
          </Badge>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {formatScheduleId(schedule.id)}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {FREQUENCY_LABELS[schedule.frequency]}
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--muted)',
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 140,
              display: 'block',
            }}
          >
            {schedule.recipientAddress.slice(0, 6)}…{schedule.recipientAddress.slice(-4)}
          </span>
          {next && (
            <span style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={10} />
              Next: {next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>
        {confirmedCount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 4 }}>
            {confirmedCount} payment{confirmedCount !== 1 ? 's' : ''} confirmed · {formatUsdcBigint(totalPaidRaw)} USDC total paid
          </div>
        )}
      </div>

      {/* Amount */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {formatUsdcBigint(amountRaw)} USDC
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>per payment</div>
      </div>

      {/* Pause/resume */}
      <div style={{ display: 'flex' }} onClick={e => e.stopPropagation()}>
        {schedule.status === 'active' && (
          <button
            title="Pause schedule"
            onClick={onPause}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--warning)',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
            }}
          >
            <PauseCircle size={16} />
          </button>
        )}
        {schedule.status === 'paused' && (
          <button
            title="Resume schedule"
            onClick={onResume}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--accent)',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
            }}
          >
            <PlayCircle size={16} />
          </button>
        )}
      </div>

      <ArrowRight size={14} style={{ color: 'var(--subtle)' }} />
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div
      style={{
        padding: '64px 32px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'var(--accent-dim)',
          border: '1px solid var(--accent-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Clock size={22} style={{ color: 'var(--accent)' }} />
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
          No recurring schedules yet
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 340, lineHeight: 1.6 }}>
          Create a recurring schedule to set up daily, weekly, or monthly USDC payments
          to a wallet address.
        </div>
      </div>
      <button
        onClick={onCreateClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 20px',
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 8,
          color: '#021a0e',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
          marginTop: 8,
        }}
      >
        <Plus size={15} />
        Create Schedule
      </button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const ALL_STATUSES: ScheduleStatus[] = ['active', 'paused', 'completed', 'cancelled', 'failed']

export default function RecurringPayments() {
  const { isConnected, address } = useAccount()
  const { emit } = useNotifications()
  const {
    schedules,
    saveSchedule,
    createSchedule,
    pauseSchedule,
    resumeSchedule,
    cancelSchedule,
  } = useRecurringSchedules({ onNotify: emit, actorAddress: address ?? undefined })
  const stats = useRecurringStats(schedules)
  const { formatted: balanceFormatted } = useUsdcBalance()

  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<RecurringSchedule | null>(null)
  const [statusFilter, setStatusFilter] = useState<ScheduleStatus | 'all'>('all')
  const [freqFilter, setFreqFilter] = useState<Frequency | 'all'>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let result = [...schedules]
    if (statusFilter !== 'all') result = result.filter(s => s.status === statusFilter)
    if (freqFilter !== 'all') result = result.filter(s => s.frequency === freqFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        s =>
          s.name.toLowerCase().includes(q) ||
          s.recipientAddress.toLowerCase().includes(q) ||
          formatScheduleId(s.id).toLowerCase().includes(q)
      )
    }
    return result.sort((a, b) => b.createdAt - a.createdAt)
  }, [schedules, statusFilter, freqFilter, search])

  // Keep selected in sync with latest state
  const liveSelected = selected
    ? (schedules.find(s => s.id === selected.id) ?? selected)
    : null

  function handleCreate(params: Parameters<typeof createSchedule>[0]) {
    const created = createSchedule(params)
    setSelected(created)
  }

  function handleUpdate(updated: RecurringSchedule) {
    saveSchedule(updated)
    if (selected?.id === updated.id) setSelected(updated)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: 'var(--ink)',
              margin: 0,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            Recurring Payments
          </h1>
          <p style={{ fontSize: 14, color: 'var(--muted)', margin: '6px 0 0' }}>
            Schedule and manage repeating USDC payments on Arc Mainnet.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {balanceFormatted && (
            <div
              style={{
                padding: '8px 14px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 13,
                color: 'var(--muted)',
              }}
            >
              Treasury: <strong style={{ color: 'var(--ink)' }}>{balanceFormatted} USDC</strong>
            </div>
          )}
          <button
            onClick={() => setShowCreate(true)}
            disabled={!isConnected}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              background: isConnected ? 'var(--accent)' : 'var(--surface-muted)',
              border: 'none',
              borderRadius: 8,
              color: isConnected ? '#021a0e' : 'var(--subtle)',
              fontSize: 13,
              fontWeight: 700,
              cursor: isConnected ? 'pointer' : 'not-allowed',
              transition: 'opacity 0.15s',
            }}
            title={!isConnected ? 'Connect wallet to create schedules' : undefined}
          >
            <Plus size={15} />
            Create Schedule
          </button>
        </div>
      </div>

      {!isConnected && (
        <WalletRequired message="Connect your wallet to manage recurring payments." />
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
        <StatCard label="Total Schedules" value={stats.total} />
        <StatCard label="Active" value={stats.active} accent />
        <StatCard label="Paused" value={stats.paused} />
        <StatCard label="Payments Confirmed" value={stats.confirmedExecs} sub="across all schedules" />
        <StatCard
          label="Total Paid (USDC)"
          value={stats.totalConfirmedFormatted}
          sub="confirmed on-chain"
          accent
        />
        <StatCard
          label="Awaiting Execution"
          value={stats.pendingExecs}
          sub="active schedules with upcoming payments"
        />
      </div>

      {/* Manual execution notice */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          padding: '12px 16px',
          background: 'rgba(232,184,76,0.06)',
          border: '1px solid rgba(232,184,76,0.15)',
          borderRadius: 10,
          fontSize: 13,
          color: 'var(--muted)',
          lineHeight: 1.6,
        }}
      >
        <Info size={14} style={{ flexShrink: 0, color: 'var(--warning)', marginTop: 1 }} />
        <div>
          <strong style={{ color: 'var(--warning)' }}>Schedules require manual execution.</strong>{' '}
          Each payment must be triggered from the schedule detail view by a connected wallet.
          Automatic execution (daily/weekly/monthly without user action) requires a keeper service
          with pre-approved USDC allowance, which is not yet deployed. Scheduled dates are used for
          display and planning only.
        </div>
      </div>

      {/* Schedule list */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--subtle)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, address, or ID…"
              style={{
                width: '100%',
                padding: '8px 12px 8px 32px',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--ink)',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={13} style={{ color: 'var(--subtle)' }} />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as ScheduleStatus | 'all')}
              style={{
                padding: '7px 10px',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--ink)',
                fontSize: 12,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="all">All Status</option>
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{SCHEDULE_STATUS_LABELS[s]}</option>
              ))}
            </select>

            <select
              value={freqFilter}
              onChange={e => setFreqFilter(e.target.value as Frequency | 'all')}
              style={{
                padding: '7px 10px',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--ink)',
                fontSize: 12,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="all">All Frequencies</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <span style={{ fontSize: 12, color: 'var(--subtle)', whiteSpace: 'nowrap' }}>
            {filtered.length} of {schedules.length}
          </span>
        </div>

        {/* Local storage notice */}
        <div
          style={{
            padding: '8px 16px',
            background: 'rgba(100,116,139,0.06)',
            borderBottom: '1px solid var(--border)',
            fontSize: 11,
            color: 'var(--subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Info size={11} />
          Schedule data is stored locally in your browser. It is not shared across devices or wallets.
        </div>

        {/* Rows */}
        {schedules.length === 0 ? (
          <EmptyState onCreateClick={() => setShowCreate(true)} />
        ) : filtered.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--subtle)', fontSize: 13 }}>
            No schedules match the current filters.
          </div>
        ) : (
          filtered.map(s => (
            <ScheduleRow
              key={s.id}
              schedule={s}
              onClick={() => setSelected(s)}
              onPause={() => pauseSchedule(s.id)}
              onResume={() => resumeSchedule(s.id)}
            />
          ))
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateScheduleModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {liveSelected && (
        <ScheduleDetail
          schedule={liveSelected}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          onPause={pauseSchedule}
          onResume={resumeSchedule}
          onCancel={id => { cancelSchedule(id); setSelected(null) }}
        />
      )}
    </div>
  )
}
