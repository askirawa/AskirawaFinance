import { useEffect, useState } from 'react'
import { CheckSquare } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import RequestList from '../components/approvals/RequestList'
import RequestDetail from '../components/approvals/RequestDetail'
import { ConnectPrompt, SetupNotice } from '../components/flow/shared'
import { useMyPermissions, useRequests, type RequestView } from '../chain/hooks'

type Filter = 'mine' | 'waiting' | 'ready' | 'done' | 'all'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'mine', label: 'Needs my approval' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'ready', label: 'Ready to pay' },
  { id: 'done', label: 'Completed' },
  { id: 'all', label: 'All' },
]

const EMPTY: Record<Filter, string> = {
  mine: 'Nothing is waiting for your approval right now.',
  waiting: 'No requests are waiting for approvals or for the safety wait to finish.',
  ready: 'No requests are ready to pay.',
  done: 'No payments have been completed yet.',
  all: 'No payment requests have been submitted yet. Create a payroll or a recurring payment to start one.',
}

/** Every request is read from the treasury contract. Approving, paying and cancelling are real transactions. */
export default function Approvals({ focusRequestId }: { focusRequestId?: number }) {
  const { address, isApprover, overview } = useMyPermissions()
  const { items, isLoading, isError, refetch } = useRequests(60)
  const [filter, setFilter] = useState<Filter | null>(null)
  const [openId, setOpenId] = useState<number | null>(focusRequestId ?? null)
  const [seenFocus, setSeenFocus] = useState(focusRequestId)
  if (focusRequestId !== seenFocus) {
    setSeenFocus(focusRequestId)
    if (focusRequestId !== undefined) setOpenId(focusRequestId)
  }

  const matches = (f: Filter, r: RequestView) => {
    if (f === 'mine') return isApprover && r.status === 1 && r.myVote === 0
    if (f === 'waiting') return r.status === 1 || r.status === 2
    if (f === 'ready') return r.status === 3
    if (f === 'done') return r.status === 4
    return true
  }
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, items.filter((r) => matches(f.id, r)).length])) as Record<Filter, number>
  const active: Filter = filter ?? (focusRequestId !== undefined ? 'all' : counts.mine > 0 ? 'mine' : 'all')
  const shown = items.filter((r) => matches(active, r))
  const selected = items.find((r) => r.id === openId) ?? null

  const selectedId = selected?.id
  useEffect(() => {
    if (focusRequestId === undefined || selectedId !== focusRequestId) return
    const el = [`request-row-${focusRequestId}`, `request-card-${focusRequestId}`]
      .map((id) => document.getElementById(id))
      .find((n) => n && n.offsetParent !== null)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusRequestId, selectedId])

  const ready = overview.state === 'ready'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Approvals"
        title="Approvals"
        subtitle="Review payment requests, approve them, and pay once they are ready. Every status here is read from the treasury."
      />
      <SetupNotice overview={overview} />

      {ready && (
        <>
          {!address && (
            <ConnectPrompt text="You can browse every request without a wallet. Connect your company wallet to approve, reject or pay." />
          )}
          {address && !isApprover && (
            <div role="status" style={{ padding: '12px 16px', background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 14 }}>
              This wallet is not an approver, so you can view requests and pay approved ones, but not approve or reject.
            </div>
          )}

          <div role="group" aria-label="Filter requests" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={active === f.id}
                      style={{ minHeight: 44, padding: '0 14px', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
                               background: active === f.id ? 'var(--ink)' : 'transparent', color: active === f.id ? 'var(--bg)' : 'var(--muted)', border: '1px solid var(--border-strong)', borderRadius: 0 }}>
                {f.label}{items.length > 0 ? ` (${counts[f.id]})` : ''}
              </button>
            ))}
          </div>

          {isLoading && (
            <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', color: 'var(--muted)', padding: '24px 0' }}><Spinner size={18} /> Loading requests…</div>
          )}
          {isError && !isLoading && (
            <div role="alert" style={{ padding: 16, background: 'var(--danger-dim)', border: '1px solid var(--danger-border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200, fontSize: 14 }}>Could not read the requests from the network. Nothing was changed.</span>
              <Button variant="secondary" arrow={false} className="min-h-[44px]" onClick={refetch}>Try again</Button>
            </div>
          )}

          {!isLoading && !isError && active === 'mine' && !address && (
            <EmptyState icon={CheckSquare} title="Connect your wallet" description="Connect your company wallet to see which requests need your approval." />
          )}
          {!isLoading && !isError && shown.length === 0 && !(active === 'mine' && !address) && (
            <EmptyState icon={CheckSquare} title="Nothing here" description={active === 'mine' && address && !isApprover ? 'Only approvers have requests waiting for their approval.' : EMPTY[active]} />
          )}
          {shown.length > 0 && (
            <RequestList requests={shown} approverCount={overview.approvers.length} selectedId={openId} onOpen={setOpenId} />
          )}

          {openId !== null && !selected && !isLoading && (
            <div role="status" style={{ padding: '12px 16px', background: 'var(--surface-muted)', border: '1px solid var(--border)', fontSize: 14, color: 'var(--muted)' }}>
              Request #{openId} is not among the most recent requests loaded here.{' '}
              <button type="button" onClick={() => setOpenId(null)} style={{ background: 'none', border: 0, color: 'var(--ink)', textDecoration: 'underline', cursor: 'pointer', minHeight: 44 }}>Dismiss</button>
            </div>
          )}
        </>
      )}

      {selected && (
        <RequestDetail
          key={selected.id}
          request={selected}
          approverCount={overview.approvers.length}
          isApprover={isApprover}
          paused={overview.paused}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
