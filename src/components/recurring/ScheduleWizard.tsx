/** Four-step recurring payment request: Recipient and amount, Timing, Review, Submit. */
import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import Button from '../ui/Button'
import { SetupNotice, Stepper } from '../flow/shared'
import { useMyPermissions } from '../../chain/hooks'
import { useTreasuryActions } from '../../chain/actions'
import { useLabels } from '../../chain/addressBook'
import { FREQUENCY_LABEL, usdc } from '../../chain/format'
import type { Navigate } from '../../nav'
import {
  DraftBar, Field, Notice, TAP, WizardNav, clearDraft, errorInputStyle, inputStyle, loadDraft, str, useDraftSaver,
} from '../payroll/formUi'
import { FREQUENCY_HELP, todayUtc, type FrequencyIndex } from './preview'
import ScheduleReview from './ScheduleReview'
import ScheduleSubmit from './ScheduleSubmit'
import { EMPTY_FORM, checkSchedule, useModuleBudget, type ScheduleForm } from './scheduleForm'

const DRAFT_KEY = 'askirawa_recurring_draft_v2'
const STEPS = ['Recipient and amount', 'Timing', 'Review', 'Submit']

function readDraft(): ScheduleForm {
  const raw = loadDraft(DRAFT_KEY) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') return EMPTY_FORM
  const f = raw.frequency
  return {
    recipientName: str(raw.recipientName, 80), address: str(raw.address, 100), amount: str(raw.amount, 40),
    scheduleName: str(raw.scheduleName, 80), startDate: str(raw.startDate, 10), endDate: str(raw.endDate, 10),
    frequency: f === 0 || f === 1 || f === 2 ? f : 1,
  }
}

export default function ScheduleWizard({ onClose, onNavigate }: { onClose: () => void; onNavigate: Navigate }) {
  const { address } = useAccount()
  const { overview, canCreate } = useMyPermissions()
  const { tx, proposeSchedule } = useTreasuryActions()
  const { saveName, saveTitle } = useLabels()
  const budget = useModuleBudget()

  const [initial] = useState(readDraft)
  const [form, setForm] = useState<ScheduleForm>(initial)
  const [step, setStep] = useState(0)
  const [restored] = useState(() => JSON.stringify(initial) !== JSON.stringify(EMPTY_FORM))
  const set = <K extends keyof ScheduleForm>(key: K, value: ScheduleForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const hasContent = JSON.stringify({ ...form, frequency: 1 }) !== JSON.stringify({ ...EMPTY_FORM, frequency: 1 })
  const done = tx.state.phase === 'confirmed'
  useDraftSaver(DRAFT_KEY, form, hasContent && !done)

  const checks = useMemo(() => checkSchedule(form, budget), [form, budget])
  const ready = overview.state === 'ready'
  const stepValid = [checks.step1, checks.step1 && checks.step2, checks.step1 && checks.step2 && ready, checks.step1 && checks.step2 && ready && canCreate][step]

  const reset = () => {
    clearDraft(DRAFT_KEY)
    setForm(EMPTY_FORM); setStep(0); tx.reset()
  }

  const submit = async () => {
    if (!checks.step1 || !checks.step2 || !address) return
    if (form.recipientName.trim()) saveName(checks.recipient!, form.recipientName)
    const memoRef = saveTitle(form.scheduleName)
    const res = await proposeSchedule({
      recipient: checks.recipient!, amount: checks.amountRaw!, frequency: form.frequency,
      startTime: BigInt(checks.startTime!), endTime: BigInt(checks.endTime), memoRef,
    }, overview.payrollDelay)
    if (res.phase === 'confirmed') clearDraft(DRAFT_KEY)
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 'clamp(16px, 4vw, 28px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>{done ? 'Recurring payment requested' : 'New Recurring Payment'}</h2>
        <Button variant="ghost" className={TAP} arrow={false} disabled={tx.busy} onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>
      </div>
      <SetupNotice overview={overview} />
      {!done && <DraftBar visible={hasContent} onDiscard={reset} />}
      {restored && step === 0 && !done && hasContent && <Notice style={{ marginBottom: 16 }}>We restored the unsent form you were working on.</Notice>}
      {!done && <Stepper steps={STEPS} current={step} />}

      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Who is paid, and how much</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 14 }}>The same amount is paid to the same wallet each time.</p>
          </div>
          {checks.budgetError && <Notice tone="danger" title="Not available yet">{checks.budgetError}</Notice>}
          <Field label="Schedule name (optional)" htmlFor="sch-name" error={checks.nameError}
                 hint="A private label kept on this device, for example 'Office rent'.">
            <input id="sch-name" value={form.scheduleName} maxLength={80} autoComplete="off" style={inputStyle} onChange={(e) => set('scheduleName', e.target.value)} />
          </Field>
          <Field label="Recipient name (optional)" htmlFor="sch-rname" hint="A private label kept on this device.">
            <input id="sch-rname" value={form.recipientName} maxLength={80} autoComplete="off" style={inputStyle} onChange={(e) => set('recipientName', e.target.value)} />
          </Field>
          <Field label="Recipient wallet address" htmlFor="sch-addr" error={form.address ? checks.addressError : null}>
            <input id="sch-addr" value={form.address} autoComplete="off" spellCheck={false} placeholder="0x…" className="mono"
                   style={form.address && checks.addressError ? errorInputStyle : inputStyle} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Amount per payment (USDC)" htmlFor="sch-amt" error={form.amount ? checks.amountError : null}
                 hint={budget.perTxMax !== null ? `Treasury limit: up to ${usdc(budget.perTxMax)} USDC per payment.` : undefined}>
            <input id="sch-amt" value={form.amount} inputMode="decimal" autoComplete="off" placeholder="500.00" className="mono"
                   style={form.amount && checks.amountError ? errorInputStyle : inputStyle} onChange={(e) => set('amount', e.target.value)} />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>How often</h2>
          </div>
          <div role="radiogroup" aria-label="How often" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))' }}>
            {([0, 1, 2] as FrequencyIndex[]).map((i) => {
              const on = form.frequency === i
              return (
                <button key={i} type="button" role="radio" aria-checked={on} onClick={() => set('frequency', i)}
                        style={{ textAlign: 'left', padding: 14, minHeight: 88, cursor: 'pointer', background: on ? 'var(--surface-strong)' : 'var(--surface-muted)', color: 'var(--ink)',
                                 border: `1px solid ${on ? 'var(--ink)' : 'var(--border-strong)'}`, borderRadius: 0 }}>
                  <strong style={{ display: 'block', fontSize: 15 }}>{FREQUENCY_LABEL[i]}</strong>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.45 }}>{FREQUENCY_HELP[i]}</span>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
            <Field label="Start date (UTC)" htmlFor="sch-start" error={checks.startError ?? null} hint="The first payment is due at 00:00 UTC on this date, or when the request is registered if that is later.">
              <input id="sch-start" type="date" min={todayUtc()} value={form.startDate} style={checks.startError ? errorInputStyle : inputStyle} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label="End date, optional (UTC)" htmlFor="sch-end" error={checks.endError ?? null} hint="Leave empty to continue until approvers cancel it. A payment due on the end date is still included.">
              <input id="sch-end" type="date" min={form.startDate || todayUtc()} value={form.endDate} style={checks.endError ? errorInputStyle : inputStyle} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {step === 2 && <ScheduleReview form={form} checks={checks} overview={overview} budget={budget} />}
      {step === 3 && (
        <ScheduleSubmit summary={{ amount: checks.amountRaw ?? 0n, frequency: form.frequency }} quorum={overview.quorum}
                        canCreate={canCreate} canSubmit={stepValid && !done} state={tx.state} busy={tx.busy}
                        onSubmit={() => void submit()} onDismiss={tx.reset} onNavigate={onNavigate} onAnother={reset} />
      )}

      {!done && (
        <WizardNav hideBack={step === 0} onBack={() => setStep((s) => Math.max(0, s - 1))}
                   onNext={step < 3 ? () => { if (stepValid) setStep((s) => s + 1) } : undefined}
                   nextLabel={step === 2 ? 'Continue to submit' : 'Next'} nextDisabled={!stepValid} />
      )}
    </div>
  )
}
