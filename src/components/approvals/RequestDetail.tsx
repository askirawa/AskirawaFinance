import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { ExternalLink, X } from 'lucide-react'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import { useTreasuryActions } from '../../chain/actions'
import { useLabels } from '../../chain/addressBook'
import { TREASURY_ADDRESS, addressUrl } from '../../chain/config'
import { ACTION_LABEL, dateTime, statusViewFor, usdc } from '../../chain/format'
import type { RequestView } from '../../chain/hooks'
import { ConnectPrompt, RequestStatus, TxPanel, Who } from '../flow/shared'
import {
  OPEN_ELSEWHERE, amountParts, requestKind, resumeLabel, thresholdText, viewState,
} from './requestHelpers'
import { PayrollTable, PaymentReceipt, Row, ScheduleTermsView, Section, Timeline } from './RequestDetailParts'

type Step = 'approve' | 'reject' | 'pay' | 'cancel'

const CONFIRM: Record<Step, { text: string; button: string; danger: boolean; done: string }> = {
  approve: { text: 'You are about to approve this request. Your approval is recorded on-chain and cannot be changed afterwards.', button: 'Confirm approval', danger: false, done: 'Approval recorded.' },
  reject: { text: 'You are about to reject this request. Your rejection is recorded on-chain and cannot be changed afterwards.', button: 'Confirm rejection', danger: true, done: 'Rejection recorded.' },
  pay: { text: 'This sends the approved amounts from the treasury to exactly the approved recipients. It cannot be changed or undone.', button: 'Confirm payment', danger: false, done: 'The payment was executed.' },
  cancel: { text: 'Cancelling closes this request. Nothing will be paid and you would need to submit it again.', button: 'Cancel this request', danger: true, done: 'The request was cancelled.' },
}

interface Props {
  request: RequestView
  approverCount: number
  isApprover: boolean
  paused: boolean
  onClose: () => void
}

const btn = 'min-h-[44px]'

/** Only payroll ends in a payment. Starting or restarting a schedule pays nobody. */
function confirmFor(step: Step, kind: string) {
  if (step !== 'pay' || kind === 'payroll') return CONFIRM[step]
  const restart = kind === 'resume'
  return {
    text: restart
      ? 'This restarts the paused schedule. It does not pay anyone by itself. Later payments still happen only when each one is due and triggered.'
      : 'This registers the recurring payment on the treasury. It does not pay anyone yet. Payments happen later, when each one is due and triggered.',
    button: restart ? 'Confirm restart' : 'Confirm start',
    danger: false,
    done: restart ? 'The schedule was restarted. No payment was made by this step.' : 'The schedule is registered. No payment has been made yet.',
  }
}

export default function RequestDetail({ request: r, approverCount, isApprover, paused, onClose }: Props) {
  const { address } = useAccount()
  const { titleOf } = useLabels()
  const actions = useTreasuryActions()
  const { state, reset, busy } = actions.tx
  const [confirm, setConfirm] = useState<Step | null>(null)
  const [last, setLast] = useState<Step | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const kind = requestKind(r)
  const view = viewState(r)
  const title = titleOf(r.memoRef)
  const label = resumeLabel(r) ?? ACTION_LABEL[r.action] ?? 'Request'
  const amt = amountParts(r)
  const isProposer = !!address && address.toLowerCase() === r.proposer.toLowerCase()
  const canVote = view === 'ready' && r.status === 1 && r.myVote === 0 && isApprover
  const canPay = view === 'ready' && r.status === 3
  const canCancel = view === 'ready' && r.status === 1 && isProposer
  const wantsWallet = !address && view === 'ready' && (r.status === 1 || r.status === 3)

  const run = async (step: Step) => {
    setLast(step)
    setConfirm(null)
    if (step === 'approve') await actions.vote(r.id, true)
    else if (step === 'reject') await actions.vote(r.id, false)
    else if (step === 'pay') await actions.execute(r.id)
    else await actions.cancel(r.id)
  }

  const ask = (step: Step) => { reset(); setConfirm(step) }
  const payHash = last === 'pay' && state.phase === 'confirmed' ? state.hash : undefined

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} aria-hidden style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)' }} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="request-detail-title" tabIndex={-1}
           style={{ position: 'relative', width: 'min(580px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--bg-2)', borderLeft: '1px solid var(--border-strong)', padding: '20px 20px calc(40px + env(safe-area-inset-bottom))', outline: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--subtle)', marginBottom: 6 }}>{r.action === 1 ? 'Payment request' : 'Request'}</div>
            <h2 id="request-detail-title" className="display" style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{title || label}</h2>
            {title && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{label}</div>}
            <div style={{ marginTop: 10 }}><RequestStatus status={r.status} action={r.action} /></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close request details"
                  style={{ minWidth: 44, minHeight: 44, background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ margin: '14px 0 0', color: 'var(--muted)', fontSize: 14 }}>{statusViewFor(r.status, r.action).hint}</p>

        <Section label="Summary">
          <Row label="Payment type">{label}</Row>
          <Row label={kind === 'schedule' ? 'Amount each time' : 'Total'}>
            <strong>{amt.main}</strong>{amt.sub ? ` (${amt.sub})` : ''}
          </Row>
          <Row label="Submitted by"><Who address={r.proposer} /></Row>
          <Row label="Submitted">{dateTime(r.createdAt)}</Row>
          <Row label="Approvals needed">{thresholdText(r, approverCount)}</Row>
          <Row label="Approvals received">{r.approvals} of {r.quorum}{r.status === 1 && r.approvals < r.quorum ? ` (${r.quorum - r.approvals} more needed)` : ''}</Row>
          <Row label="Your vote">
            {!address ? 'Connect your wallet to see' : r.myVote === 1 ? 'You approved' : r.myVote === 2 ? 'You rejected' : isApprover ? 'Not voted yet' : 'You are not an approver'}
          </Row>
        </Section>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--subtle)' }}>Individual votes are not listed here. Only the counts are shown.</p>

        {view === 'loading' && (
          <Section label="Request contents"><div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--muted)', fontSize: 14 }}><Spinner size={16} /> Loading what this request contains…</div></Section>
        )}
        {view === 'ready' && kind === 'payroll' && r.payroll && (
          <Section label="Who gets paid"><PayrollTable lines={r.payroll} total={r.totalAmount} /></Section>
        )}
        {view === 'ready' && kind === 'resume' && r.moduleAction?.resume && (
          <Section label="What this changes">
            <Row label="Schedule">#{r.moduleAction.resume.scheduleId.toString()}</Row>
            <Row label="Missed periods">{r.moduleAction.resume.skipMissed ? 'Skipped. Only the next future payment is made.' : 'Paid one by one, as allowed by the contract limits.'}</Row>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--subtle)' }}>Approving restarts a paused recurring payment. It does not pay anyone by itself.</p>
          </Section>
        )}
        {view === 'ready' && kind === 'schedule' && r.moduleAction?.schedule && (
          <Section label="Recurring payment terms"><ScheduleTermsView s={r.moduleAction.schedule} funding={r.moduleAction.fundingAmount} /></Section>
        )}
        {view === 'readonly' && (
          <Section label="Review">
            <div style={{ padding: 14, background: 'var(--surface-muted)', border: '1px solid var(--border)', fontSize: 14, color: 'var(--ink-2)' }}>
              <p style={{ margin: '0 0 10px' }}>{r.action === 1 ? 'The recipients of this request could not be fully checked in this app. Review it on the explorer.' : OPEN_ELSEWHERE}</p>
              {TREASURY_ADDRESS && (
                <a href={addressUrl(TREASURY_ADDRESS)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, textDecoration: 'underline' }}>
                  View treasury on the explorer <ExternalLink size={14} />
                </a>
              )}
            </div>
          </Section>
        )}

        <Section label="Timeline"><Timeline r={r} /></Section>

        {(view === 'ready' || r.status === 4) && (
          <Section label="What you can do">
            {paused && (r.status === 3 || r.status === 1) && (
              <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--warning)' }}>The treasury is paused right now. Payments are blocked until it is resumed.</p>
            )}
            {wantsWallet && <ConnectPrompt text={r.status === 3 ? (kind === 'payroll' ? 'Connect a wallet to pay this request.' : 'Connect a wallet to start this schedule.') : 'Connect your company wallet to approve or reject.'} />}
            {address && r.status === 1 && !isApprover && !canCancel && <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Only approvers can approve or reject this request.</p>}
            {address && r.status === 1 && isApprover && r.myVote !== 0 && <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Your {r.myVote === 1 ? 'approval' : 'rejection'} is recorded on-chain. Waiting for the other approvers.</p>}
            {canPay && (
              <p style={{ margin: '0 0 12px', color: 'var(--ink-2)', fontSize: 14 }}>
                {kind === 'payroll'
                  ? 'This request is fully approved. Paying it sends exactly the approved recipients and amounts. Nobody can change them.'
                  : 'This request is fully approved. Starting it only records the schedule. It does not pay anyone.'}
              </p>
            )}
            {!confirm && address && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {canVote && <Button className={btn} disabled={busy} onClick={() => ask('approve')}>Approve</Button>}
                {canVote && <Button className={btn} variant="secondary" arrow={false} disabled={busy} onClick={() => ask('reject')}>Reject</Button>}
                {canPay && <Button className={btn} disabled={busy} onClick={() => ask('pay')}>{kind === 'payroll' ? 'Pay now' : kind === 'resume' ? 'Restart schedule' : 'Start schedule'}</Button>}
                {canCancel && <Button className={btn} variant="danger" arrow={false} disabled={busy} onClick={() => ask('cancel')}>Cancel request</Button>}
              </div>
            )}
            {confirm && (
              <div style={{ padding: 16, border: '1px solid var(--border-strong)', background: 'var(--surface-muted)' }}>
                <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--ink-2)' }}>
                  {confirmFor(confirm, kind).text}
                  {confirm === 'pay' && kind === 'payroll' && <> Total: <strong>{usdc(r.totalAmount)} USDC</strong>.</>}
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Button className={btn} variant={confirmFor(confirm, kind).danger ? 'danger' : 'primary'} arrow={false} disabled={busy} onClick={() => void run(confirm)}>{confirmFor(confirm, kind).button}</Button>
                  <Button className={btn} variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>Go back</Button>
                </div>
              </div>
            )}
            <TxPanel state={state} onDismiss={reset} doneText={last ? confirmFor(last, kind).done : undefined} />
          </Section>
        )}

        {r.status === 4 && r.action === 1 && <PaymentReceipt requestId={r.id} hash={payHash} />}

        <details style={{ marginTop: 28, borderTop: '1px solid var(--border)' }}>
          <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 14 }}>Details</summary>
          <Row label="Request number">#{r.id}</Row>
          <Row label="Submitted by (address)"><span className="mono" style={{ fontSize: 12 }}>{r.proposer}</span></Row>
          {TREASURY_ADDRESS && <Row label="Treasury contract"><a href={addressUrl(TREASURY_ADDRESS)} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 12, color: 'inherit' }}>{TREASURY_ADDRESS}</a></Row>}
          <Row label="Approval deadline">{dateTime(r.expiresAt)}</Row>
        </details>
      </div>
    </div>
  )
}
