/**
 * ApprovalRequestModal — create a new treasury approval request.
 * Two-step: (1) fill details, (2) review and confirm.
 */

import { useState, useCallback } from 'react'
import { X, AlertCircle, Info, ChevronRight, ChevronLeft, CheckCircle2 } from 'lucide-react'
import { useAccount } from 'wagmi'
import {
  type RequestType,
  validateApprovalRequest,
  formatUsdcBigint,
  parseUsdcString,
  requiresApproval,
  type ApprovalPolicy,
  REQUEST_TYPE_LABELS,
} from '../../lib/approvals'

interface Props {
  policy: ApprovalPolicy
  onSubmit: (fields: {
    title: string
    type: RequestType
    recipientAddress: string
    amountUsdc: string
    description: string
    requiredApprovals: number
    requesterAddress: string
  }) => void
  onClose: () => void
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
      {children}
      {required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
    </label>
  )
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return (
    <div className="flex items-center gap-1.5 mt-1.5" style={{ color: 'var(--danger)', fontSize: 12 }}>
      <AlertCircle size={12} />
      {msg}
    </div>
  )
}

function Field({ label, error, required, children }: { label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
      <FieldError msg={error} />
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-muted)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '10px 12px', color: 'var(--ink)', fontSize: 14,
  outline: 'none', boxSizing: 'border-box',
}

// ─── Step 1: Request details ──────────────────────────────────────────────────

interface FormState {
  title: string
  type: RequestType
  recipientAddress: string
  amountUsdc: string
  description: string
}

const EMPTY: FormState = {
  title: '',
  type: 'transfer',
  recipientAddress: '',
  amountUsdc: '',
  description: '',
}

function StepDetails({
  form,
  errors,
  policy,
  onUpdate,
}: {
  form: FormState
  errors: ReturnType<typeof validateApprovalRequest>['errors']
  policy: ApprovalPolicy
  onUpdate: (k: keyof FormState, v: string) => void
}) {
  let amountRaw = 0n
  try { amountRaw = parseUsdcString(form.amountUsdc) } catch { /* noop */ }
  const needsApproval = requiresApproval(form.amountUsdc, policy)
  const showThresholdNote = form.amountUsdc.trim() && !isNaN(Number(form.amountUsdc))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Field label="Request Title" error={errors.title} required>
        <input
          style={inputStyle}
          placeholder="e.g. Q4 Vendor Payment — Acme Corp"
          value={form.title}
          onChange={e => onUpdate('title', e.target.value)}
          maxLength={120}
        />
      </Field>

      <Field label="Request Type" required>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(['transfer', 'payroll_batch', 'recurring_schedule', 'other'] as RequestType[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onUpdate('type', t)}
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: form.type === t ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                background: form.type === t ? 'var(--accent-dim)' : 'var(--surface-muted)',
                color: form.type === t ? 'var(--accent)' : 'var(--muted)',
                textAlign: 'left',
              }}
            >
              {REQUEST_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Recipient Address" error={errors.recipientAddress} required>
        <input
          style={inputStyle}
          placeholder="0x..."
          value={form.recipientAddress}
          onChange={e => onUpdate('recipientAddress', e.target.value)}
          spellCheck={false}
        />
      </Field>

      <Field label="USDC Amount" error={errors.amountUsdc} required>
        <div style={{ position: 'relative' }}>
          <input
            style={{ ...inputStyle, paddingRight: 60 }}
            placeholder="0.00"
            value={form.amountUsdc}
            onChange={e => onUpdate('amountUsdc', e.target.value)}
          />
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 12, fontWeight: 600, pointerEvents: 'none' }}>
            USDC
          </span>
        </div>
        {showThresholdNote && amountRaw > 0n && (
          <div className="flex items-center gap-1.5 mt-1.5" style={{ fontSize: 12, color: needsApproval ? 'var(--warning)' : 'var(--accent)' }}>
            <Info size={12} />
            {needsApproval
              ? `Amount ≥ ${policy.thresholdUsdc} USDC — approval required (${policy.requiredApprovals} approver${policy.requiredApprovals !== 1 ? 's' : ''})`
              : `Amount below ${policy.thresholdUsdc} USDC threshold`
            }
          </div>
        )}
      </Field>

      <Field label="Business Justification" error={errors.description} required>
        <textarea
          style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
          placeholder="Describe the purpose and business context for this payment…"
          value={form.description}
          onChange={e => onUpdate('description', e.target.value)}
          maxLength={600}
          rows={3}
        />
        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--subtle)', marginTop: 4 }}>
          {form.description.length}/600
        </div>
      </Field>
    </div>
  )
}

// ─── Step 2: Review ───────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-all' }}>{children}</span>
    </div>
  )
}

function StepReview({ form, policy, requesterAddress }: {
  form: FormState
  policy: ApprovalPolicy
  requesterAddress: string
}) {
  let amountRaw = 0n
  try { amountRaw = parseUsdcString(form.amountUsdc) } catch { /* noop */ }
  const needsApproval = requiresApproval(form.amountUsdc, policy)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header notice */}
      <div className="flex items-start gap-3 rounded-xl p-4" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <Info size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--ink)' }}>Locally recorded approval</strong>
          <br />
          Decisions are stored in your browser and are not cryptographically enforced on-chain. Production enforcement requires a treasury contract.
        </div>
      </div>

      {/* Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        <Row label="Title">{form.title}</Row>
        <Row label="Type">{REQUEST_TYPE_LABELS[form.type]}</Row>
        <Row label="Requester">{requesterAddress.slice(0, 6)}…{requesterAddress.slice(-4)}</Row>
        <Row label="Recipient">{form.recipientAddress.slice(0, 10)}…{form.recipientAddress.slice(-6)}</Row>
        <Row label="Amount">
          <span style={{ color: amountRaw > 0n ? 'var(--ink)' : 'var(--muted)' }}>
            {amountRaw > 0n ? formatUsdcBigint(amountRaw) : '—'} USDC
          </span>
        </Row>
        <Row label="Approval">
          {needsApproval
            ? `${policy.requiredApprovals} of ${policy.requiredApprovals} approver${policy.requiredApprovals !== 1 ? 's' : ''} required`
            : 'Below threshold — approval not required'
          }
        </Row>
        <div style={{ paddingBottom: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 4 }}>Justification</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>{form.description}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

export default function ApprovalRequestModal({ policy, onSubmit, onClose }: Props) {
  const { address } = useAccount()
  const [step, setStep] = useState<1 | 2>(1)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<ReturnType<typeof validateApprovalRequest>['errors']>({})
  const [submitted, setSubmitted] = useState(false)

  const update = useCallback((k: keyof FormState, v: string) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: undefined }))
  }, [])

  function handleNext() {
    const result = validateApprovalRequest({
      title: form.title,
      recipientAddress: form.recipientAddress,
      amountUsdc: form.amountUsdc,
      description: form.description,
    })
    if (!result.valid) { setErrors(result.errors); return }
    setErrors({})
    setStep(2)
  }

  function handleSubmit() {
    if (!address) return
    const needsApproval = requiresApproval(form.amountUsdc, policy)
    onSubmit({
      title: form.title,
      type: form.type,
      recipientAddress: form.recipientAddress,
      amountUsdc: form.amountUsdc,
      description: form.description,
      requiredApprovals: needsApproval ? policy.requiredApprovals : 0,
      requesterAddress: address,
    })
    setSubmitted(true)
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 20, width: '100%', maxWidth: 520,
          maxHeight: '90dvh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              {submitted ? 'Request Submitted' : step === 1 ? 'New Approval Request' : 'Review Request'}
            </div>
            {!submitted && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                Step {step} of 2
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '24px 24px 0' }}>
          {submitted ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-4">
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle2 size={24} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Request submitted</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                  The approval request has been saved locally. Share it with your authorized approvers.
                </div>
              </div>
            </div>
          ) : step === 1 ? (
            <StepDetails form={form} errors={errors} policy={policy} onUpdate={update} />
          ) : (
            <StepReview form={form} policy={policy} requesterAddress={address ?? ''} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-5" style={{ borderTop: '1px solid var(--border)' }}>
          {submitted ? (
            <button
              onClick={onClose}
              className="w-full rounded-xl py-3 text-sm font-semibold"
              style={{ background: 'var(--accent)', color: '#021a0e', border: 'none', cursor: 'pointer' }}
            >
              Done
            </button>
          ) : step === 1 ? (
            <>
              <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 20px', fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleNext}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
                style={{ background: 'var(--accent)', color: '#021a0e', border: 'none', cursor: 'pointer' }}
              >
                Review <ChevronRight size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-2"
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 20px', fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}
              >
                <ChevronLeft size={16} /> Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={!address}
                className="rounded-xl px-6 py-2.5 text-sm font-semibold transition-opacity"
                style={{ background: 'var(--accent)', color: '#021a0e', border: 'none', cursor: 'pointer', opacity: address ? 1 : 0.5 }}
              >
                Submit Request
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
