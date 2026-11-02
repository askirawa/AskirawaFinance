import { CalendarClock, Handshake, Lock, ShieldCheck, Hourglass, Scale } from 'lucide-react'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import type { Navigate } from '../nav'

type Kind = 'escrow' | 'vesting'

const CONTENT: Record<Kind, {
  title: string
  lead: string
  points: { icon: React.ReactNode; title: string; text: string }[]
}> = {
  escrow: {
    title: 'Escrow',
    lead: 'Hold USDC for a contractor or supplier and release it only when approvers agree the work is done.',
    points: [
      { icon: <Lock size={18} />, title: 'Funds set aside', text: 'Money for a specific job is locked away from day-to-day spending.' },
      { icon: <Handshake size={18} />, title: 'Release on approval', text: 'Approvers release a milestone to the agreed recipient. Nobody else can.' },
      { icon: <Scale size={18} />, title: 'Automatic return', text: 'If a deadline passes without a release, the funds go back to the treasury.' },
    ],
  },
  vesting: {
    title: 'Vesting',
    lead: 'Pay a team member or partner gradually over time, with an optional waiting period before the first payout.',
    points: [
      { icon: <Hourglass size={18} />, title: 'Gradual release', text: 'Funds become claimable little by little over the agreed period.' },
      { icon: <CalendarClock size={18} />, title: 'Cliff and schedule', text: 'An optional first waiting period, then steady release until the end date.' },
      { icon: <ShieldCheck size={18} />, title: 'Approver control', text: 'Approvers can stop a grant. Anything already earned stays claimable.' },
    ],
  },
}

/**
 * Honest placeholder. No contract for this feature has been written, tested or deployed, so there is
 * deliberately nothing to click that could look like it works.
 */
export default function ComingSoon({ kind, onNavigate }: { kind: Kind; onNavigate: Navigate }) {
  const c = CONTENT[kind]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Coming soon" title={c.title} subtitle={c.lead} />

      <div role="status" style={{ padding: 16, border: '1px solid var(--border-strong)', background: 'var(--surface-muted)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge variant="neutral">Not available yet</Badge>
        <span style={{ flex: 1, minWidth: 220, fontSize: 14, color: 'var(--ink-2)' }}>
          {c.title} is not part of this release. Its contract has not been built, tested or deployed, so nothing here can hold or move money.
          Your treasury, payroll and recurring payments do not depend on it.
        </span>
      </div>

      <SectionCard label="Planned" title={`What ${c.title} will do`}>
        <div style={{ display: 'grid', gap: 16, padding: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
          {c.points.map((p) => (
            <div key={p.title} style={{ padding: 16, border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <span className="feature-icon" style={{ display: 'inline-flex', marginBottom: 10 }}>{p.icon}</span>
              <div className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{p.title}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>{p.text}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ alignSelf: 'center', fontSize: 14, color: 'var(--muted)' }}>Available today:</span>
        <Button variant="secondary" arrow={false} className="min-h-[44px]" onClick={() => onNavigate('payroll')}>Payroll</Button>
        <Button variant="secondary" arrow={false} className="min-h-[44px]" onClick={() => onNavigate('recurring')}>Recurring Payments</Button>
      </div>
    </div>
  )
}
