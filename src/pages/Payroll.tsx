import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import { ApprovalMeter, ExplorerLink, RequestStatus, SetupNotice } from '../components/flow/shared'
import PayrollWizard from '../components/payroll/PayrollWizard'
import { Notice, TAP } from '../components/payroll/formUi'
import { useLabels } from '../chain/addressBook'
import { useHistory } from '../chain/history'
import { useMyPermissions, useRequests, type RequestView } from '../chain/hooks'
import { STATUS_VIEW, dateTime, usdc } from '../chain/format'
import type { Navigate } from '../nav'

const LIST_LIMIT = 60

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--subtle)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{children}</div>
    </div>
  )
}

function PayrollCard({ item, receipt, historyComplete, onNavigate }: {
  item: RequestView
  receipt: string | undefined
  historyComplete: boolean
  onNavigate: Navigate
}) {
  const { titleOf } = useLabels()
  const name = titleOf(item.memoRef) ?? `Payroll #${item.id}`
  const view = STATUS_VIEW[item.status] ?? STATUS_VIEW[0]
  return (
    <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="display" style={{ fontSize: 17, fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--subtle)' }}>Request #{item.id}</div>
        </div>
        <RequestStatus status={item.status} />
      </div>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))' }}>
        <Meta label="Employees">{item.payroll ? item.payroll.length : '…'}</Meta>
        <Meta label="Total">{usdc(item.totalAmount)} USDC</Meta>
        <Meta label="Submitted">{dateTime(item.createdAt)}</Meta>
        <div style={{ minWidth: 0 }}><ApprovalMeter approvals={item.approvals} quorum={item.quorum} open={item.status === 1} /></div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>{view.hint}</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="secondary" className={TAP} onClick={() => onNavigate('approvals', { requestId: item.id })}>Open in Approvals</Button>
        {item.status === 4 && (receipt
          ? <ExplorerLink hash={receipt} />
          : <span style={{ fontSize: 13, color: 'var(--muted)' }}>{historyComplete ? 'Receipt not found in the history that was scanned' : 'Receipt loading'}</span>)}
      </div>
    </div>
  )
}

export default function Payroll({ onNavigate, startCreating }: { onNavigate: Navigate; startCreating: boolean }) {
  const { address, canCreate, overview } = useMyPermissions()
  const { items, isLoading, isError, refetch } = useRequests(LIST_LIMIT)
  const history = useHistory()
  const [creating, setCreating] = useState(startCreating)

  // Opening the page straight into the creation flow (for example from the dashboard).
  const [seenStart, setSeenStart] = useState(startCreating)
  if (startCreating !== seenStart) {
    setSeenStart(startCreating)
    if (startCreating) setCreating(true)
  }

  const payrolls = useMemo(() => items.filter((r) => r.action === 1), [items])
  const receipts = useMemo(() => {
    const map = new Map<number, string>()
    for (const h of history.items) {
      if (h.kind === 'payment' && h.requestId !== undefined && !map.has(h.requestId)) map.set(h.requestId, h.txHash)
    }
    return map
  }, [history.items])

  const ready = overview.state === 'ready'
  const blocked = !!address && ready && !canCreate
  const canStart = ready && !blocked

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Treasury" title="Payroll"
                  subtitle="Pay many people in one request. Approvers approve it first, and the whole payroll is paid together or not at all."
                  action={!creating && <Button className={TAP} disabled={!canStart} onClick={() => setCreating(true)}>Create Payroll</Button>} />
      <SetupNotice overview={overview} />
      {blocked && (
        <Notice tone="warning" title="This wallet cannot create payroll">
          Only approvers and proposers of this treasury can create payment requests. You can still follow the requests below. Switch to an authorised wallet to create one.
        </Notice>
      )}

      {creating && <PayrollWizard onClose={() => setCreating(false)} onNavigate={onNavigate} />}

      {ready && (
        <SectionCard label="Payroll requests" title="Every payroll request, read from the treasury"
                     subtitle={overview.requestCount > LIST_LIMIT ? `Showing payroll within the latest ${LIST_LIMIT} requests.` : undefined}>
          {isLoading ? (
            <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 24, color: 'var(--muted)' }}><Spinner size={18} /> Reading payroll requests from the network…</div>
          ) : isError ? (
            <div style={{ padding: 16 }}>
              <Notice tone="danger" title="Could not load payroll requests">The network did not answer. Nothing was changed.
                <div style={{ marginTop: 8 }}><Button variant="secondary" size="sm" className={TAP} arrow={false} onClick={refetch}>Try again</Button></div>
              </Notice>
            </div>
          ) : payrolls.length === 0 ? (
            <EmptyState icon={Users} title="No payroll requests yet"
                        description="Create a payroll to pay several people at once. Approvers will review it before any money moves."
                        action={<Button className={TAP} disabled={!canStart || creating} onClick={() => setCreating(true)}>Create Payroll</Button>} />
          ) : (
            <div>
              {payrolls.map((item) => (
                <PayrollCard key={item.id} item={item} receipt={receipts.get(item.id)} historyComplete={history.complete} onNavigate={onNavigate} />
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
}
