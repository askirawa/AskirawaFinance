import { useState } from 'react'
import { AlertTriangle, CalendarClock, Clock, Landmark, Send } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import StatCard from '../components/ui/StatCard'
import AddFunds from '../components/dashboard/AddFunds'
import UpcomingList, { useUpcoming } from '../components/dashboard/UpcomingList'
import RecentTransactions from '../components/dashboard/RecentTransactions'
import { ConnectPrompt, SetupNotice } from '../components/flow/shared'
import { NETWORK } from '../chain/config'
import { usdc } from '../chain/format'
import { useHistory } from '../chain/history'
import { useMyPermissions, useRequests, useSchedules } from '../chain/hooks'
import type { Navigate } from '../nav'

const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }
const btn = 'min-h-[44px]'

/** Company treasury at a glance. Every number is read from the treasury contract. */
export default function Dashboard({ onNavigate }: { onNavigate: Navigate }) {
  const { address, isApprover, overview } = useMyPermissions()
  const requests = useRequests(40)
  const schedules = useSchedules()
  const history = useHistory()
  const upcoming = useUpcoming(requests.items, schedules.items, onNavigate, overview.balance)
  const [adding, setAdding] = useState(false)

  const ready = overview.state === 'ready'
  const pending = requests.items.filter((r) => r.status === 1)
  const mine = pending.filter((r) => r.myVote === 0).length
  const loadingLists = requests.isLoading || schedules.isLoading

  let paidValue: string | null = '—'
  let paidNote: string | undefined
  if (ready) {
    if (history.error && !history.complete) paidValue = 'Unavailable'
    else if (!history.complete) paidValue = 'Counting…'
    else {
      paidValue = `${usdc(history.totalPaid)} USDC`
      if (history.limited) paidNote = 'Counted from recent activity only: deployment block not configured'
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <PageHeader eyebrow="Company treasury" title="Dashboard" subtitle="Your company's USDC balance, what needs approval, and what is coming up." />
      <SetupNotice overview={overview} />

      {overview.paused && (
        <div role="alert" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', background: 'var(--warning-dim)', border: '1px solid var(--warning-border)', color: 'var(--warning)' }}>
          <span className="feature-icon"><AlertTriangle size={18} /></span>
          <div><strong>The treasury is paused.</strong> <span style={{ color: 'var(--ink-2)' }}>Payments are blocked until it is resumed.</span></div>
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 'clamp(20px, 4vw, 32px)', clipPath: 'polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ ...MONO, color: 'var(--subtle)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="feature-icon"><Landmark size={14} /></span> Available Treasury Balance
          </span>
          <span style={{ ...MONO, color: 'var(--muted)', border: '1px solid var(--border-strong)', padding: '4px 8px' }}>{NETWORK.name}</span>
        </div>
        <div className="display" style={{ margin: '14px 0 22px', fontSize: 'clamp(34px, 8vw, 56px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.05, overflowWrap: 'anywhere' }}>
          {ready ? usdc(overview.balance) : '—'} <span style={{ fontSize: 'clamp(16px, 3vw, 22px)', color: 'var(--muted)', fontWeight: 500 }}>USDC</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button className={btn} icon={<span className="feature-icon"><Send size={14} /></span>} arrow onClick={() => onNavigate('payroll', { create: true })}>Create Payroll</Button>
          <Button className={btn} icon={<span className="feature-icon"><CalendarClock size={14} /></span>} arrow onClick={() => onNavigate('recurring', { create: true })}>New Recurring Payment</Button>
          <Button className={btn} variant="secondary" arrow={false} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>Add funds</Button>
        </div>
        {adding && <AddFunds onClose={() => setAdding(false)} />}
      </div>

      {!address && (
        <ConnectPrompt text="Connect your company wallet to create payments, approve requests and add funds. You can still see the treasury below." />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16 }}>
        <StatCard
          label="Pending approvals"
          icon={<span className="feature-icon"><Clock size={16} /></span>}
          value={!ready ? '—' : requests.isLoading ? null : pending.length}
          note={!ready || requests.isLoading ? undefined : !address ? 'Connect to see yours' : isApprover ? `${mine} need your approval` : 'Waiting for approvers'}
        />
        <StatCard
          label="Total payments made"
          icon={<span className="feature-icon"><Send size={16} /></span>}
          value={paidValue}
          note={paidNote}
        />
        <StatCard
          label="Upcoming payments"
          icon={<span className="feature-icon"><CalendarClock size={16} /></span>}
          value={!ready ? '—' : loadingLists ? null : upcoming.length}
          note={ready && !loadingLists ? 'Approved payroll and registered schedules' : undefined}
        />
      </div>

      {ready && pending.length > 0 && (
        <div>
          <Button className={btn} variant="secondary" arrow={false} onClick={() => onNavigate('approvals')}>
            {mine > 0 ? `Review ${mine} ${mine === 1 ? 'request' : 'requests'} waiting for you` : 'Open approvals'}
          </Button>
        </div>
      )}

      {ready && <UpcomingList items={upcoming} loading={loadingLists} />}
      {ready && <RecentTransactions history={history} onViewAll={() => onNavigate('activity')} />}
    </div>
  )
}
