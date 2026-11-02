import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import SectionCard from '../ui/SectionCard'
import Spinner from '../ui/Spinner'
import { useLabels } from '../../chain/addressBook'
import { dateOnly, shortAddress, usdc } from '../../chain/format'
import type { RequestView, ScheduleView } from '../../chain/hooks'
import type { Navigate } from '../../nav'

export interface UpcomingItem {
  key: string
  when: bigint
  who: string
  amount: bigint
  note: string
  go: () => void
}

/** Approved or ready payroll (status 2 or 3) and registered schedules, soonest first. Read from the contract only. */
export function buildUpcoming(
  requests: RequestView[], schedules: ScheduleView[], nameOf: (a: string) => string | undefined, onNavigate: Navigate, balance?: bigint,
): UpcomingItem[] {
  const out: UpcomingItem[] = []
  for (const r of requests) {
    if (r.action !== 1 || (r.status !== 2 && r.status !== 3)) continue
    const n = r.payroll?.length
    out.push({
      key: `r${r.id}`,
      when: r.executableAt,
      who: n === undefined ? 'Payroll' : `${n} ${n === 1 ? 'employee' : 'employees'}`,
      amount: r.totalAmount,
      note: balance !== undefined && r.totalAmount > balance
        ? 'Approved, but the treasury balance is too low to pay it'
        : r.status === 3 ? 'Ready to pay' : `Approved, can be paid from ${dateOnly(r.executableAt)}`,
      go: () => onNavigate('approvals', { requestId: r.id }),
    })
  }
  for (const s of schedules) {
    if (s.status !== 1) continue
    out.push({
      key: `s${s.id}`,
      when: s.nextDue,
      who: nameOf(s.recipient) ?? shortAddress(s.recipient),
      amount: s.amount,
      note: `Registered schedule, next due ${dateOnly(s.nextDue)}`,
      go: () => onNavigate('recurring'),
    })
  }
  return out.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0))
}

export function useUpcoming(requests: RequestView[], schedules: ScheduleView[], onNavigate: Navigate, balance?: bigint) {
  const { nameOf } = useLabels()
  return buildUpcoming(requests, schedules, nameOf, onNavigate, balance)
}

export default function UpcomingList({ items, loading }: { items: UpcomingItem[]; loading: boolean }) {
  let body: ReactNode
  if (loading) body = <div role="status" style={{ padding: 20, display: 'flex', gap: 10, alignItems: 'center', color: 'var(--muted)' }}><Spinner size={16} /> Loading…</div>
  else if (items.length === 0) body = <p style={{ margin: 0, padding: 20, color: 'var(--muted)', fontSize: 14 }}>Nothing is coming up. Approved payroll and registered recurring payments will appear here.</p>
  else {
    body = (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.slice(0, 5).map((i) => (
          <li key={i.key} style={{ borderBottom: '1px solid var(--border)' }}>
            <button type="button" onClick={i.go}
                    style={{ width: '100%', minHeight: 64, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', padding: '10px 16px', background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ minWidth: 96, flexShrink: 0, fontSize: 13, color: 'var(--ink-2)' }}>{dateOnly(i.when)}</div>
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <div style={{ color: 'var(--ink)', fontWeight: 600, overflowWrap: 'anywhere' }}>{i.who}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{i.note}</div>
              </div>
              <div className="mono" style={{ color: 'var(--ink)', whiteSpace: 'nowrap' }}>{usdc(i.amount)} USDC</div>
              <ChevronRight size={14} style={{ color: 'var(--subtle)', flexShrink: 0 }} />
            </button>
          </li>
        ))}
      </ul>
    )
  }
  return <SectionCard label="Coming up" title="Upcoming payroll and recurring payments">{body}</SectionCard>
}
