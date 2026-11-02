/** Four-step payroll request: Details, Recipients, Review, Submit. Creates a request that approvers must approve. */
import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import Button from '../ui/Button'
import { SetupNotice, Stepper } from '../flow/shared'
import { useMyPermissions } from '../../chain/hooks'
import { useTreasuryActions } from '../../chain/actions'
import { useLabels } from '../../chain/addressBook'
import { TREASURY_ADDRESS } from '../../chain/config'
import type { Navigate } from '../../nav'
import {
  DraftBar, Field, Notice, TAP, WizardNav, clearDraft, errorInputStyle, inputStyle, loadDraft, str, useDraftSaver,
} from './formUi'
import PayrollReview from './PayrollReview'
import PayrollSubmit from './PayrollSubmit'
import RecipientsStep from './RecipientsStep'
import { MAX_RECIPIENTS, checkRows, isBlankRow, newRow, type RecipientRow } from './payrollRows'

const DRAFT_KEY = 'askirawa_payroll_draft_v2'
const STEPS = ['Details', 'Recipients', 'Review', 'Submit']
const NAME_MAX = 60

interface Draft { name: string; rows: RecipientRow[] }

function readDraft(): Draft {
  const raw = loadDraft(DRAFT_KEY) as { name?: unknown; rows?: unknown } | null
  const rows = Array.isArray(raw?.rows)
    ? (raw.rows as Record<string, unknown>[]).slice(0, MAX_RECIPIENTS).map((r) =>
        newRow({ name: str(r?.name, 80), address: str(r?.address, 100), amount: str(r?.amount, 40) }))
    : []
  return { name: str(raw?.name, NAME_MAX), rows: rows.length > 0 ? rows : [newRow()] }
}

export default function PayrollWizard({ onClose, onNavigate }: { onClose: () => void; onNavigate: Navigate }) {
  const { address } = useAccount()
  const { overview, canCreate } = useMyPermissions()
  const { tx, proposePayroll } = useTreasuryActions()
  const { saveName, saveTitle } = useLabels()

  const [initial] = useState(readDraft)
  const [name, setName] = useState(initial.name)
  const [rows, setRows] = useState<RecipientRow[]>(initial.rows)
  const [step, setStep] = useState(0)
  const [restored] = useState(() => initial.name.length > 0 || initial.rows.some((r) => !isBlankRow(r)))

  const hasContent = name.trim().length > 0 || rows.some((r) => !isBlankRow(r))
  const done = tx.state.phase === 'confirmed'
  const draft = useMemo(() => ({ name, rows }), [name, rows])
  useDraftSaver(DRAFT_KEY, draft, hasContent && !done)

  const result = useMemo(() => checkRows(rows, TREASURY_ADDRESS), [rows])
  const nameOk = name.trim().length > 0 && name.trim().length <= NAME_MAX
  const ready = overview.state === 'ready'
  const stepValid = [nameOk, result.allValid, result.allValid && ready, result.allValid && ready && canCreate][step]

  const reset = () => {
    clearDraft(DRAFT_KEY)
    setName(''); setRows([newRow()]); setStep(0); tx.reset()
  }

  const submit = async () => {
    if (!result.allValid || !address) return
    result.checks.forEach((c, i) => { if (c.to && rows[i].name.trim()) saveName(c.to, rows[i].name) })
    const memoRef = saveTitle(name)
    const payments = result.checks.map((c) => ({ to: c.to!, amount: c.raw! }))
    const res = await proposePayroll(payments, overview.payrollDelay, memoRef)
    if (res.phase === 'confirmed') clearDraft(DRAFT_KEY)
  }

  const next = () => {
    if (stepValid) setStep((s) => Math.min(3, s + 1))
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 'clamp(16px, 4vw, 28px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>{done ? 'Payroll requested' : 'Create Payroll'}</h2>
        <Button variant="ghost" className={TAP} arrow={false} disabled={tx.busy} onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>
      </div>
      <SetupNotice overview={overview} />
      {!done && <DraftBar visible={hasContent} onDiscard={reset} />}
      {restored && step === 0 && !done && hasContent && <Notice style={{ marginBottom: 16 }}>We restored the unsent form you were working on.</Notice>}
      {!done && <Stepper steps={STEPS} current={step} />}

      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Name this payroll</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 14 }}>For example "March salaries".</p>
          </div>
          <Field label="Payroll name" htmlFor="payroll-name"
                 error={name.length > 0 && !nameOk ? 'Enter a name of up to 60 characters.' : null}
                 hint="This is a private label. It is kept on this device so you can recognise the request. The contract only stores a fingerprint of it, so other approvers on other devices will see the request number unless they set the same name.">
            <input id="payroll-name" value={name} maxLength={NAME_MAX} autoComplete="off" placeholder="March salaries"
                   style={name.length > 0 && !nameOk ? errorInputStyle : inputStyle} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
      )}
      {step === 1 && <RecipientsStep rows={rows} onChange={setRows} result={result} />}
      {step === 2 && <PayrollReview name={name} rows={rows} result={result} overview={overview} />}
      {step === 3 && (
        <PayrollSubmit name={name} count={rows.length} total={result.total} quorum={overview.quorum}
                       canCreate={canCreate} canSubmit={stepValid && !done} state={tx.state} busy={tx.busy}
                       onSubmit={() => void submit()} onDismiss={tx.reset} onNavigate={onNavigate} onAnother={reset} />
      )}

      {!done && (
        <WizardNav hideBack={step === 0} onBack={() => setStep((s) => Math.max(0, s - 1))}
                   onNext={step < 3 ? next : undefined} nextLabel={step === 2 ? 'Continue to submit' : 'Next'}
                   nextDisabled={!stepValid} />
      )}
    </div>
  )
}
