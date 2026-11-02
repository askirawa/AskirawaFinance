import { useMemo, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import { ApprovalMeter, ConnectPrompt, RequestStatus, SetupNotice, TxPanel, Who } from '../components/flow/shared'
import ScheduleWizard from '../components/recurring/ScheduleWizard'
import ScheduleCard, { type ScheduleAction } from '../components/recurring/ScheduleCard'
import { utcLabel } from '../components/recurring/preview'
import { Notice, TAP } from '../components/payroll/formUi'
import { useTreasuryActions } from '../chain/actions'
import { useLabels } from '../chain/addressBook'
import { isModuleConfigured } from '../chain/config'
import { FREQUENCY_LABEL, STATUS_VIEW, dateTime, usdc } from '../chain/format'
import { useMyPermissions, useRequests, useSchedules, type RequestView } from '../chain/hooks'
import type { Navigate } from '../nav'

const BANNER = 'A registered schedule does not pay by itself. A payment happens only when the due payment is triggered on-chain. Automatic triggering needs an executor service, which is not connected yet.'

const ACTION_TEXT: Record<ScheduleAction | 'resume', string> = { execute: 'Run due payment', pause: 'Pause', cancel: 'Cancel', resume: 'Request restart' }

function PendingCard({ item, onNavigate }: { item: RequestView; onNavigate: Navigate }) {
  const { titleOf } = useLabels()
  const terms = item.moduleAction?.schedule
  if (!terms) return null
  const name = titleOf(terms.memoRef) ?? titleOf(item.memoRef) ?? `Recurring payment request #${item.id}`
  const view = STATUS_VIEW[item.status] ?? STATUS_VIEW[0]
  return (
    <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="display" style={{ fontSize: 17, fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--subtle)' }}>Request #{item.id} · submitted {dateTime(item.createdAt)}</div>
        </div>
        <RequestStatus status={item.status} action={item.action} />
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', fontSize: 14 }}>
        <div><div style={{ fontSize: 11, color: 'var(--subtle)' }}>Who</div><Who address={terms.recipient} /></div>
        <div><div style={{ fontSize: 11, color: 'var(--subtle)' }}>Amount</div>{usdc(terms.amount)} USDC, {FREQUENCY_LABEL[terms.frequency]?.toLowerCase()}</div>
        <div><div style={{ fontSize: 11, color: 'var(--subtle)' }}>Requested start</div><span className="mono" style={{ fontSize: 13 }}>{utcLabel(terms.startTime)}</span></div>
        <div><div style={{ fontSize: 11, color: 'var(--subtle)' }}>Ends</div>{terms.endTime > 0n ? <span className="mono" style={{ fontSize: 13 }}>{utcLabel(terms.endTime)}</span> : 'No end date'}</div>
      </div>
      <ApprovalMeter approvals={item.approvals} quorum={item.quorum} open={item.status === 1} />
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>{view.hint} The schedule appears below only after the approved request has been run.</div>
      <div><Button variant="secondary" className={TAP} onClick={() => onNavigate('approvals', { requestId: item.id })}>Open in Approvals</Button></div>
    </div>
  )
}

export default function RecurringPayments({ onNavigate, startCreating }: { onNavigate: Navigate; startCreating: boolean }) {
  const { address, isApprover, canCreate, overview } = useMyPermissions()
  const requests = useRequests(60)
  const schedules = useSchedules()
  const { tx, moduleCall, proposeResume } = useTreasuryActions()
  const [creating, setCreating] = useState(startCreating)
  const [last, setLast] = useState<{ id: number; kind: ScheduleAction | 'resume'; before: number; failuresBefore: number } | null>(null)

  // Opening the page straight into the creation flow (for example from the dashboard).
  const [seenStart, setSeenStart] = useState(startCreating)
  if (startCreating !== seenStart) {
    setSeenStart(startCreating)
    if (startCreating) setCreating(true)
  }

  const pending = useMemo(
    () => requests.items.filter((r) => r.action === 4 && !!r.moduleAction?.schedule && r.status >= 1 && r.status <= 3),
    [requests.items],
  )
  const ready = overview.state === 'ready'
  const blocked = !!address && ready && !canCreate
  const canStart = ready && isModuleConfigured && !blocked
  const anyDue = schedules.items.some((s) => s.status === 1 && s.dueNow)

  const run = (kind: ScheduleAction, s: { id: number; executedCount: number; failures: number }) => {
    setLast({ id: s.id, kind, before: s.executedCount, failuresBefore: s.failures })
    void moduleCall(kind, s.id, kind === 'pause' ? 2 : kind === 'cancel' ? 3 : undefined)
  }

  const requestResume = (s: { id: number; executedCount: number; failures: number }, skipMissed: boolean) => {
    setLast({ id: s.id, kind: 'resume', before: s.executedCount, failuresBefore: s.failures })
    void proposeResume(s.id, skipMissed, overview.payrollDelay)
  }

  // A confirmed "run" transaction is not the same as a payment: only the contract's own counters say so.
  const doneText = (() => {
    if (!last) return undefined
    const s = schedules.items.find((x) => x.id === last.id)
    if (last.kind === 'resume') return `Restart requested for schedule #${last.id}. It stays paused until approvers approve the request in Approvals.`
    if (last.kind === 'pause') return `Schedule #${last.id} is paused.`
    if (last.kind === 'cancel') return `Schedule #${last.id} is cancelled.`
    if (!s) return 'Reading the schedule from the contract…'
    if (s.executedCount > last.before) return `Payment made. The contract now shows ${s.executedCount} payment${s.executedCount === 1 ? '' : 's'}, ${usdc(s.totalPaid)} USDC in total.`
    return 'The transaction went through, but the contract did not record a payment. A failed attempt is recorded and can be retried after the retry delay. Check the schedule below.'
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Treasury" title="Recurring Payments"
                  subtitle="Pay the same amount to the same wallet on a regular schedule, once approvers have approved it."
                  action={!creating && <Button className={TAP} disabled={!canStart} onClick={() => setCreating(true)}>New Recurring Payment</Button>} />

      <Notice tone="warning" title="Payments are not automatic yet">{BANNER}</Notice>
      <SetupNotice overview={overview} />

      {!isModuleConfigured ? (
        <Notice title="Recurring payments are not enabled for this treasury yet">
          No recurring payments contract is connected to this app, so there are no schedules to show and none can be requested. Once the recurring payments contract is connected and approved in the treasury, schedules will appear here. Nothing on this screen is simulated.
        </Notice>
      ) : (
        <>
          {blocked && (
            <Notice tone="warning" title="This wallet cannot create requests">
              Only approvers and proposers of this treasury can request a recurring payment. You can still follow schedules below.
            </Notice>
          )}
          {creating && <ScheduleWizard onClose={() => setCreating(false)} onNavigate={onNavigate} />}

          {ready && (
            <SectionCard label="Waiting for approval" title="Requests that are not registered yet">
              {requests.isLoading ? (
                <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 24, color: 'var(--muted)' }}><Spinner size={18} /> Reading requests from the network…</div>
              ) : requests.isError ? (
                <div style={{ padding: 16 }}><Notice tone="danger" title="Could not load requests">The network did not answer. <Button variant="secondary" size="sm" className={TAP} arrow={false} onClick={requests.refetch}>Try again</Button></Notice></div>
              ) : pending.length === 0 ? (
                <div style={{ padding: 20, color: 'var(--muted)', fontSize: 14 }}>No recurring payment requests are waiting for approval.</div>
              ) : pending.map((item) => <PendingCard key={item.id} item={item} onNavigate={onNavigate} />)}
            </SectionCard>
          )}

          {ready && (
            <SectionCard label="Registered schedules" title="Schedules registered on the contract">
              {!address && anyDue && <div style={{ padding: 16 }}><ConnectPrompt text="A payment is due. Connect a wallet to run it." /></div>}
              {last && (tx.state.phase !== 'idle' || tx.state.message) ? (
                <div style={{ padding: '0 16px' }}>
                  {last && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>{ACTION_TEXT[last.kind]}, schedule #{last.id}</div>}
                  <TxPanel state={tx.state} onDismiss={tx.reset} doneText={doneText} />
                </div>
              ) : null}
              {schedules.isLoading ? (
                <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 24, color: 'var(--muted)' }}><Spinner size={18} /> Reading schedules from the network…</div>
              ) : schedules.items.length === 0 ? (
                <EmptyState icon={CalendarClock} title="No recurring payments registered"
                            description="Request one and, once approvers approve it and it has been run, it will be listed here."
                            action={<Button className={TAP} disabled={!canStart || creating} onClick={() => setCreating(true)}>New Recurring Payment</Button>} />
              ) : schedules.items.map((s) => (
                <ScheduleCard key={s.id} schedule={s} isApprover={isApprover} account={address} busy={tx.busy && last?.id === s.id} locked={tx.busy} onAction={run} onRequestResume={requestResume} />
              ))}
            </SectionCard>
          )}
        </>
      )}
    </div>
  )
}
