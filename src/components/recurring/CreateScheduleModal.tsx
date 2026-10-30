/**
 * CreateScheduleModal — 3-step form to create a recurring payment schedule.
 * Step 1: Basic details (name, recipient, amount)
 * Step 2: Schedule settings (frequency, dates, limits)
 * Step 3: Review and confirm
 */

import { useState, useCallback, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, Info, AlertCircle } from 'lucide-react'
import {
  type Frequency,
  type ScheduleValidationResult,
  validateScheduleForm,
  parseUsdcString,
  formatUsdcBigint,
  computeNthExecution,
  FREQUENCY_LABELS,
} from '../../lib/recurring'

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  name: string
  recipientAddress: string
  amountUsdc: string
  frequency: Frequency
  startDate: string
  startTime: string
  endDate: string
  maxExecutions: string
  description: string
}

const DEFAULT_FORM: FormState = {
  name: '',
  recipientAddress: '',
  amountUsdc: '',
  frequency: 'monthly',
  startDate: '',
  startTime: '09:00',
  endDate: '',
  maxExecutions: '',
  description: '',
}

// ─── Field component ──────────────────────────────────────────────────────────

function Field({
  label,
  error,
  required,
  children,
  hint,
}: {
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {label}
        {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </label>
      {children}
      {hint && !error && <span style={{ fontSize: 12, color: 'var(--subtle)' }}>{hint}</span>}
      {error && (
        <span style={{ fontSize: 12, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertCircle size={12} />
          {error}
        </span>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 0,
  minHeight: 44,
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}

const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  border: '1px solid var(--danger)',
}

function FieldInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  hasError,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  hasError?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={hasError ? inputErrorStyle : inputStyle}
    />
  )
}

// ─── Step 1: Details ──────────────────────────────────────────────────────────

function StepDetails({
  form,
  errors,
  update,
}: {
  form: FormState
  errors: ScheduleValidationResult['errors']
  update: (k: keyof FormState, v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Field label="Schedule name" error={errors.name} required>
        <FieldInput
          value={form.name}
          onChange={v => update('name', v)}
          placeholder="For example: Contractor retainer"
          hasError={!!errors.name}
        />
      </Field>

      <Field label="Recipient wallet address" error={errors.recipientAddress} required>
        <FieldInput
          value={form.recipientAddress}
          onChange={v => update('recipientAddress', v)}
          placeholder="0x..."
          hasError={!!errors.recipientAddress}
        />
      </Field>

      <Field
        label="Amount per payment (USDC)"
        error={errors.amountUsdc}
        required
        hint="The amount sent each time, for example 500.00"
      >
        <div style={{ position: 'relative' }}>
          <FieldInput
            value={form.amountUsdc}
            onChange={v => update('amountUsdc', v)}
            placeholder="500.00"
            hasError={!!errors.amountUsdc}
          />
          <span
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--muted)',
              pointerEvents: 'none',
            }}
          >
            USDC
          </span>
        </div>
      </Field>

      <Field label="Description" hint="Optional. Shown on each payment record.">
        <textarea
          value={form.description}
          onChange={e => update('description', e.target.value)}
          placeholder="For example: Monthly design work"
          rows={2}
          style={{
            ...inputStyle,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      </Field>
    </div>
  )
}

// ─── Step 2: Schedule ─────────────────────────────────────────────────────────

function StepSchedule({
  form,
  errors,
  update,
}: {
  form: FormState
  errors: ScheduleValidationResult['errors']
  update: (k: keyof FormState, v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Field label="How often" error={errors.frequency} required>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(90px, 100%), 1fr))', gap: 8 }}>
          {(['daily', 'weekly', 'monthly'] as Frequency[]).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => update('frequency', f)}
              style={{
                padding: '10px 0',
                minHeight: 44,
                borderRadius: 0,
                border: form.frequency === f ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: form.frequency === f ? 'var(--accent-dim)' : 'var(--surface)',
                color: form.frequency === f ? 'var(--accent)' : 'var(--muted)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {FREQUENCY_LABELS[f]}
            </button>
          ))}
        </div>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 16 }}>
        <Field label="Start date" error={errors.startDate} required>
          <FieldInput
            type="date"
            value={form.startDate}
            onChange={v => update('startDate', v)}
            hasError={!!errors.startDate}
          />
        </Field>
        <Field
          label="Start time"
          error={errors.startTime}
          required
          hint="Your local time"
        >
          <FieldInput
            type="time"
            value={form.startTime}
            onChange={v => update('startTime', v)}
            hasError={!!errors.startTime}
          />
        </Field>
      </div>

      <Field
        label="End date"
        error={errors.endDate}
        hint="Optional. Leave blank to keep going until you cancel."
      >
        <FieldInput
          type="date"
          value={form.endDate}
          onChange={v => update('endDate', v)}
          hasError={!!errors.endDate}
        />
      </Field>

      <Field
        label="Number of payments"
        error={errors.maxExecutions}
        hint="Optional. The schedule ends after this many payments."
      >
        <FieldInput
          type="number"
          value={form.maxExecutions}
          onChange={v => update('maxExecutions', v)}
          placeholder="e.g. 12"
          hasError={!!errors.maxExecutions}
        />
      </Field>

      {/* Preview of first execution */}
      {form.startDate && form.startTime && (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent-border)',
            borderRadius: 0,
            fontSize: 13,
            color: 'var(--ink)',
          }}
        >
          <span style={{ color: 'var(--muted)', marginRight: 8 }}>First payment due:</span>
          <strong>
            {computeNthExecution(
              form.startDate,
              form.startTime,
              form.frequency,
              0
            ).toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </strong>
          {form.maxExecutions && !isNaN(parseInt(form.maxExecutions)) && (
            <span style={{ color: 'var(--muted)', marginLeft: 12 }}>
              · {form.maxExecutions} payments in total
            </span>
          )}
        </div>
      )}

      {/* Automation notice */}
      <div
        style={{
          padding: '12px 16px',
          background: 'rgba(232,184,76,0.08)',
          border: '1px solid rgba(232,184,76,0.2)',
          borderRadius: 0,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <Info size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--warning)' }}>Payments are not sent automatically.</strong>{' '}
          This schedule is saved in this browser only. You send each payment yourself from the
          schedule page. The automation service that could do this for you is not available yet.
        </div>
      </div>
    </div>
  )
}

// ─── Step 3: Review ───────────────────────────────────────────────────────────

function StepReview({ form }: { form: FormState }) {
  let rawAmount = 0n
  let amountValid = false
  try {
    rawAmount = parseUsdcString(form.amountUsdc)
    amountValid = rawAmount > 0n
  } catch { /* noop */ }

  const rows: [string, React.ReactNode][] = [
    ['Schedule name', form.name],
    ['Recipient', <span style={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>{form.recipientAddress}</span>],
    ['Amount per payment', amountValid ? `${formatUsdcBigint(rawAmount)} USDC` : form.amountUsdc],
    ['How often', FREQUENCY_LABELS[form.frequency]],
    [
      'First payment due',
      form.startDate && form.startTime
        ? computeNthExecution(form.startDate, form.startTime, form.frequency, 0).toLocaleString(
            'en-US',
            { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
          )
        : '—',
    ],
    ['End date', form.endDate || 'None (keeps going until cancelled)'],
    ['Number of payments', form.maxExecutions || 'No limit'],
    ['Description', form.description || '—'],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 0,
          overflow: 'hidden',
        }}
      >
        {rows.map(([label, value], i) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 16px',
              borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              gap: 16,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
            <span
              style={{
                fontSize: 13,
                color: 'var(--ink)',
                fontWeight: 500,
                textAlign: 'right',
                wordBreak: 'break-all',
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: '12px 16px',
          background: 'rgba(232,184,76,0.08)',
          border: '1px solid rgba(232,184,76,0.2)',
          borderRadius: 0,
          fontSize: 12,
          color: 'var(--muted)',
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: 'var(--warning)' }}>Saved in this browser only.</strong>{' '}
        Saving does not move any money. You send each payment yourself from the schedule page.
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface CreateScheduleModalProps {
  onClose: () => void
  onCreate: (params: {
    name: string
    recipientAddress: string
    amountUsdc: string
    frequency: Frequency
    startDate: string
    startTime: string
    endDate?: string
    maxExecutions?: number
    description: string
  }) => void
}

const STEPS = ['Details', 'Schedule', 'Review']

export default function CreateScheduleModal({ onClose, onCreate }: CreateScheduleModalProps) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [errors, setErrors] = useState<ScheduleValidationResult['errors']>({})

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const update = useCallback((k: keyof FormState, v: string) => {
    setForm(prev => ({ ...prev, [k]: v }))
    setErrors(prev => ({ ...prev, [k]: undefined }))
  }, [])

  function validateStep(s: number): boolean {
    const result = validateScheduleForm(form)
    if (s === 0) {
      const stepFields: Array<keyof ScheduleValidationResult['errors']> = [
        'name', 'recipientAddress', 'amountUsdc',
      ]
      const stepErrors: ScheduleValidationResult['errors'] = {}
      stepFields.forEach(f => {
        if (result.errors[f]) stepErrors[f] = result.errors[f]
      })
      if (Object.keys(stepErrors).length > 0) { setErrors(stepErrors); return false }
    }
    if (s === 1) {
      const stepFields: Array<keyof ScheduleValidationResult['errors']> = [
        'frequency', 'startDate', 'startTime', 'endDate', 'maxExecutions',
      ]
      const stepErrors: ScheduleValidationResult['errors'] = {}
      stepFields.forEach(f => {
        if (result.errors[f]) stepErrors[f] = result.errors[f]
      })
      if (Object.keys(stepErrors).length > 0) { setErrors(stepErrors); return false }
    }
    return true
  }

  function next() {
    if (!validateStep(step)) return
    setErrors({})
    setStep(s => s + 1)
  }

  function back() {
    setErrors({})
    setStep(s => s - 1)
  }

  function submit() {
    const result = validateScheduleForm(form)
    if (!result.valid) { setErrors(result.errors); return }

    onCreate({
      name: form.name.trim(),
      recipientAddress: form.recipientAddress.trim(),
      amountUsdc: form.amountUsdc.trim(),
      frequency: form.frequency,
      startDate: form.startDate,
      startTime: form.startTime,
      endDate: form.endDate || undefined,
      maxExecutions: form.maxExecutions ? parseInt(form.maxExecutions, 10) : undefined,
      description: form.description.trim(),
    })
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '90dvh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              Create recurring payment
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Step {step + 1} of {STEPS.length}: {STEPS[step]}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--muted)',
              width: 44,
              height: 44,
              flexShrink: 0,
              alignItems: 'center',
              justifyContent: 'center',
              display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Step indicators */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            padding: '0 24px',
            paddingTop: 16,
            overflowX: 'auto',
          }}
        >
          {STEPS.map((label, i) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: i > step ? 0.4 : 1,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    background: i < step ? 'var(--accent)' : i === step ? 'var(--accent-dim)' : 'var(--surface-muted)',
                    border: i === step ? '1px solid var(--accent)' : '1px solid transparent',
                    color: i < step ? 'var(--bg)' : i === step ? 'var(--accent)' : 'var(--muted)',
                  }}
                >
                  {i < step ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: 12, fontWeight: 500, color: i === step ? 'var(--ink)' : 'var(--muted)' }}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    margin: '0 10px',
                    background: i < step ? 'var(--accent-border)' : 'var(--border)',
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '20px 24px' }}>
          {step === 0 && <StepDetails form={form} errors={errors} update={update} />}
          {step === 1 && <StepSchedule form={form} errors={errors} update={update} />}
          {step === 2 && <StepReview form={form} />}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderTop: '1px solid var(--border)',
            gap: 12,
          }}
        >
          {step > 0 ? (
            <button
              onClick={back}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 16px',
                minHeight: 44,
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 0,
                color: 'var(--muted)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <ChevronLeft size={14} />
              Back
            </button>
          ) : (
            <button
              onClick={onClose}
              style={{
                padding: '9px 16px',
                minHeight: 44,
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 0,
                color: 'var(--muted)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}

          {step < STEPS.length - 1 ? (
            <button
              onClick={next}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 16px',
                minHeight: 44,
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 0,
                color: 'var(--bg)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Continue
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={submit}
              style={{
                padding: '9px 20px',
                minHeight: 44,
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 0,
                color: 'var(--bg)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Save schedule
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
