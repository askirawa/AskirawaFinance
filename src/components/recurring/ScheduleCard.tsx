/** One registered schedule, exactly as the recurring payments contract reports it. */
import { useState } from 'react'
import { zeroAddress } from 'viem'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import { ScheduleStatusBadge, Who } from '../flow/shared'
import { useLabels } from '../../chain/addressBook'
import { FREQUENCY_LABEL, dateTime, timeLeft, usdc } from '../../chain/format'
import type { ScheduleView } from '../../chain/hooks'
import { addressUrl } from '../../chain/config'
import { Details, Notice, TAP } from '../payroll/formUi'
import { utcLabel } from './preview'
import { useNowSeconds } from './useNow'

export type ScheduleAction = 'execute' | 'pause' | 'cancel'
export type ResumeRequest = (s: ScheduleView, skipMissed: boolean) => void

interface Props {
  schedule: ScheduleView
  isApprover: boolean
  account: string | undefined
  busy: boolean
  /** Another action is in flight: disable everything. */
  locked: boolean
  onAction: (kind: ScheduleAction, schedule: ScheduleView) => void
  /** Paused schedules can be restarted only through an approval request. */
  onRequestResume?: ResumeRequest
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--subtle)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--ink)' }}>{children}</div>
    </div>
  )
}

function nextPayment(s: ScheduleView, now: number): React.ReactNode {
  if (s.status === 2) return 'Paused. No payments until approvers approve a restart.'
  if (s.status === 3) return 'Cancelled. No further payments.'
  if (s.status === 4) return 'Finished. No further payments.'
  if (s.status !== 1) return 'Not available'
  return (
    <>
      <strong>{dateTime(s.nextDue)}</strong>
      <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{utcLabel(s.nextDue)}</div>
      {Number(s.nextDue) > now && <div style={{ fontSize: 12, color: 'var(--muted)' }}>in {timeLeft(s.nextDue, now)}</div>}
    </>
  )
}

export default function ScheduleCard({ schedule: s, isApprover, account, busy, locked, onAction, onRequestResume }: Props) {
  const { titleOf } = useLabels()
  const [confirming, setConfirming] = useState<'pause' | 'cancel' | 'resume' | null>(null)
  const now = useNowSeconds()
  const name = titleOf(s.memoRef) ?? `Recurring payment #${s.id}`
  const active = s.status === 1
  const due = active && s.dueNow
  const restricted = s.executor !== zeroAddress && !isApprover && account?.toLowerCase() !== s.executor.toLowerCase()
  const waitingRetry = active && Number(s.nextDue) <= now && Number(s.nextRetryAt) > now

  return (
    <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="display" style={{ fontSize: 17, fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--subtle)' }}>Schedule #{s.id}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {due && <Badge variant="warning">Due now</Badge>}
          <ScheduleStatusBadge status={s.status} />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))' }}>
        <Meta label="Who"><Who address={s.recipient} /></Meta>
        <Meta label="Amount">{usdc(s.amount)} USDC, {FREQUENCY_LABEL[s.frequency]?.toLowerCase() ?? 'unknown frequency'}</Meta>
        <Meta label="Next payment">{nextPayment(s, now)}</Meta>
        <Meta label="Payments made">
          {s.executedCount === 0 ? 'None yet' : `${s.executedCount} payment${s.executedCount === 1 ? '' : 's'}`}
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{usdc(s.totalPaid)} USDC paid in total</div>
        </Meta>
      </div>

      {s.endTime > 0n && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No payments due after {utcLabel(s.endTime)}.</div>}
      {s.failures > 0 && (
        <Notice tone="warning" title="Last attempt failed">
          {s.failures === 1 ? 'The most recent payment attempt failed.' : `${s.failures} attempts in a row failed.`}{' '}
          {active ? (Number(s.nextRetryAt) > now ? `Retry after ${dateTime(s.nextRetryAt)}.` : 'A retry is allowed now.') : 'The schedule is not active.'}
        </Notice>
      )}
      {waitingRetry && s.failures === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Waiting until {dateTime(s.nextRetryAt)} before the next attempt.</div>}

      {confirming === 'resume' ? (
        <Notice tone="warning" title={`Ask approvers to restart ${name}?`}>
          Restarting needs the same approvals as a new payment. Choose what happens to payments that were missed while it was paused.
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <Button className={TAP} arrow={false} loading={busy} disabled={locked} onClick={() => { onRequestResume?.(s, false); setConfirming(null) }}>Request restart, pay missed periods</Button>
            <Button variant="secondary" className={TAP} arrow={false} loading={busy} disabled={locked} onClick={() => { onRequestResume?.(s, true); setConfirming(null) }}>Request restart, skip missed periods</Button>
            <Button variant="secondary" className={TAP} arrow={false} onClick={() => setConfirming(null)}>Keep it paused</Button>
          </div>
        </Notice>
      ) : confirming ? (
        <Notice tone="warning" title={confirming === 'pause' ? `Pause ${name}?` : `Cancel ${name}?`}>
          {confirming === 'pause'
            ? 'No further payments can be made until approvers approve a restart.'
            : 'This stops the schedule for good. Payments already made are not reversed.'}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <Button variant={confirming === 'cancel' ? 'danger' : 'warning'} className={TAP} arrow={false} loading={busy} disabled={locked}
                    onClick={() => { onAction(confirming, s); setConfirming(null) }}>
              {confirming === 'pause' ? 'Yes, pause it' : 'Yes, cancel it'}
            </Button>
            <Button variant="secondary" className={TAP} arrow={false} onClick={() => setConfirming(null)}>Keep it running</Button>
          </div>
        </Notice>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {due && <Button className={TAP} loading={busy} disabled={locked || !account || restricted} onClick={() => onAction('execute', s)}>Run due payment</Button>}
          {isApprover && active && <Button variant="secondary" className={TAP} arrow={false} disabled={locked} onClick={() => setConfirming('pause')}>Pause</Button>}
          {isApprover && s.status === 2 && onRequestResume && <Button variant="secondary" className={TAP} arrow={false} disabled={locked} onClick={() => setConfirming('resume')}>Request restart</Button>}
          {isApprover && (s.status === 1 || s.status === 2) && <Button variant="danger" className={TAP} arrow={false} disabled={locked} onClick={() => setConfirming('cancel')}>Cancel</Button>}
        </div>
      )}
      {due && restricted && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Only the schedule's designated runner or an approver can run this payment.</div>}

      <Details>
        <div>Created by request #{s.createdByProposal.toString()}</div>
        <div>Recipient wallet: <a href={addressUrl(s.recipient)} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{s.recipient}</a></div>
        <div>First payment was due: {utcLabel(s.startTime)}</div>
        <div>Runner: {s.executor === zeroAddress ? 'anyone' : s.executor}</div>
      </Details>
    </div>
  )
}
