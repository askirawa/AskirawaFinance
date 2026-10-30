import { useState } from 'react'
import { CheckSquare } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import V2Gate from '../components/v2/V2Gate'
import ProposalCard from '../components/v2/ProposalCard'
import { Notice, mono } from '../components/v2/shared'
import { useProposals, useTreasurySnapshot, useViewer } from '../hooks/v2/useTreasuryV2'
import { PSTATUS } from '../lib/v2/status'

type Filter = 'open' | 'executable' | 'closed' | 'all'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Needs action' }, { id: 'executable', label: 'Executable' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' },
]
const CLOSED: number[] = [PSTATUS.Executed, PSTATUS.Cancelled, PSTATUS.Rejected, PSTATUS.Expired, PSTATUS.Fenced]

/** Every proposal, read from the treasury contract. Votes, execution and cancellation are real transactions. */
export default function Approvals() {
  const { data: snap, error } = useTreasurySnapshot()
  const viewer = useViewer(snap)
  const { data: proposals, isLoading } = useProposals(snap)
  const [filter, setFilter] = useState<Filter>('open')

  const shown = (proposals ?? []).filter((p) =>
    filter === 'all' ? true
      : filter === 'closed' ? CLOSED.includes(p.derived)
        : filter === 'executable' ? p.derived === PSTATUS.Executable
          : [PSTATUS.Pending, PSTATUS.Approved, PSTATUS.Executable].includes(p.derived as never))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Treasury governance" title="Approvals" subtitle="Approvers vote onchain. A proposal runs only after quorum and the timelock, and anyone can then execute it." />
      <V2Gate>
        {error && <Notice tone="danger">Could not read the treasury: {error instanceof Error ? error.message : 'RPC error'}</Notice>}
        {snap && (
          <Notice>
            You are {viewer.isApprover ? 'an approver' : viewer.isProposer ? 'a proposer (cannot vote)' : viewer.isGuardian ? 'the guardian (can pause or cancel, cannot vote)' : 'not a participant'} in governance epoch {snap.epoch.toString()}.
            Quorum is {snap.quorum} of {snap.approvers.length}.
          </Notice>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} style={{
              ...mono, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '6px 12px', cursor: 'pointer',
              background: filter === f.id ? 'var(--ink)' : 'transparent', color: filter === f.id ? 'var(--bg)' : 'var(--muted)',
              border: '1px solid var(--border-strong)', borderRadius: 0,
            }}>{f.label}</button>
          ))}
        </div>
        {isLoading && <Spinner />}
        {snap && !isLoading && shown.length === 0 && (
          <EmptyState icon={CheckSquare} title="No proposals here" description="Proposals appear as soon as they are created onchain." />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {snap && shown.map((p) => <ProposalCard key={p.id.toString()} p={p} snapshot={snap} viewer={viewer} />)}
        </div>
      </V2Gate>
    </div>
  )
}
