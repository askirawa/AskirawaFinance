/** Shared helpers for showing treasury requests. Everything shown is derived from RequestView (contract data). */
import { RECURRING_MODULE_ADDRESS } from '../../chain/config'
import { FREQUENCY_LABEL, usdc } from '../../chain/format'
import type { RequestView } from '../../chain/hooks'
import { Who } from '../flow/shared'

export type RequestKind = 'payroll' | 'schedule' | 'resume' | 'other'
/** ready = shown in full, can be voted on; loading = payload still being read; readonly = managed outside this app. */
export type ViewState = 'ready' | 'loading' | 'readonly'

export function requestKind(r: RequestView): RequestKind {
  if (r.action === 1) return 'payroll'
  const m = r.moduleAction
  if (
    r.action === 4 && m?.schedule && RECURRING_MODULE_ADDRESS &&
    m.module.toLowerCase() === RECURRING_MODULE_ADDRESS.toLowerCase()
  ) return 'schedule'
  if (
    r.action === 4 && m?.resume && RECURRING_MODULE_ADDRESS &&
    m.module.toLowerCase() === RECURRING_MODULE_ADDRESS.toLowerCase()
  ) return 'resume'
  return 'other'
}

/** The payroll lines shown must add up to the total the approvers are voting on. */
export function payrollVerified(r: RequestView): boolean {
  if (!r.payroll || r.payroll.length === 0) return false
  return r.payroll.reduce((sum, l) => sum + l.amount, 0n) === r.totalAmount
}

export function viewState(r: RequestView): ViewState {
  if (r.action === 1) {
    if (!r.payroll) return 'loading'
    return payrollVerified(r) ? 'ready' : 'readonly'
  }
  if (r.action === 4) {
    if (r.moduleAction === undefined) return 'loading'
    return requestKind(r) === 'schedule' || requestKind(r) === 'resume' ? 'ready' : 'readonly'
  }
  return 'readonly'
}

export const OPEN_ELSEWHERE = 'This kind of request is managed outside this app. Review it on the explorer.'

export function utc(seconds: bigint | number): string {
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function frequencyText(f: number): string {
  return FREQUENCY_LABEL[f] ?? 'Unknown'
}

export function RecipientCell({ r }: { r: RequestView }) {
  const kind = requestKind(r)
  if (kind === 'payroll') {
    if (!r.payroll) return <span style={{ color: 'var(--subtle)' }}>Loading…</span>
    const n = r.payroll.length
    return <span>{n} {n === 1 ? 'employee' : 'employees'}</span>
  }
  if (kind === 'schedule' && r.moduleAction?.schedule) return <Who address={r.moduleAction.schedule.recipient} />
  if (kind === 'resume' && r.moduleAction?.resume) return <span>Schedule #{r.moduleAction.resume.scheduleId.toString()}</span>
  return <span style={{ color: 'var(--subtle)' }}>Not a payment</span>
}

export function amountParts(r: RequestView): { main: string; sub?: string } {
  const s = requestKind(r) === 'schedule' ? r.moduleAction?.schedule : undefined
  if (s) return { main: `${usdc(s.amount)} USDC`, sub: `per payment, ${frequencyText(s.frequency).toLowerCase()}` }
  if (requestKind(r) === 'resume') return { main: 'No payment', sub: 'restarts a paused schedule' }
  if (r.totalAmount > 0n) return { main: `${usdc(r.totalAmount)} USDC` }
  return { main: '—' }
}

export function thresholdText(r: RequestView, approverCount: number): string {
  return approverCount > 0 ? `${r.quorum} of ${approverCount} approvers` : `${r.quorum} approvers`
}

export function resumeLabel(r: RequestView): string | null {
  const x = r.moduleAction?.resume
  if (!x) return null
  return `Restart recurring payment #${x.scheduleId.toString()}`
}
