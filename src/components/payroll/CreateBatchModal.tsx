/**
 * CreateBatchModal — multi-step form to build and submit a payroll batch.
 * Step 1: Batch details (name, schedule, note)
 * Step 2: Employee rows (add/edit/remove)
 * Step 3: Review & confirm
 */

import { useState, useCallback, useEffect } from 'react'
import { X, Plus, Trash2, AlertCircle, ChevronRight, ChevronLeft, Info } from 'lucide-react'
import Card, { CardBody } from '../ui/Card'
import {
  type EmployeeEntry,
  type ScheduleType,
  type ValidationResult,
  validateBatchEntries,
  sumBatchAmounts,
  formatUsdcBigint,
  generateId,
} from '../../lib/payroll'

// ─── Form sub-step 1 ──────────────────────────────────────────────────────────

interface BatchDetailsForm {
  name: string
  scheduleType: ScheduleType
  scheduledDate: string
  scheduledTime: string
  note: string
}

const EMPTY_DETAILS: BatchDetailsForm = {
  name: '',
  scheduleType: 'immediate',
  scheduledDate: '',
  scheduledTime: '',
  note: '',
}

// ─── Shared input styles ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-muted)',
  border: '1px solid var(--border)',
  borderRadius: 0,
  color: 'var(--ink)',
  fontSize: 14,
  minHeight: 44,
  padding: '9px 12px',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-2)',
  marginBottom: 5,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--danger)',
  marginTop: 4,
}

// ─── Employee row component ───────────────────────────────────────────────────

interface EmployeeRowProps {
  entry: EmployeeEntry
  index: number
  onChange: (id: string, field: keyof EmployeeEntry, value: string) => void
  onRemove: (id: string) => void
  errors?: Array<{ field: string; message: string }>
  canRemove: boolean
}

function EmployeeRow({ entry, index, onChange, onRemove, errors = [], canRemove }: EmployeeRowProps) {
  const fieldError = (f: string) => errors.find(e => e.field === f)?.message

  return (
    <div
      className="p-4 mb-3"
      style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Employee {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(entry.id)}
            className="flex items-center justify-center transition-colors"
            style={{
              width: 44,
              height: 44,
              background: 'rgba(232,109,122,0.08)',
              border: '1px solid rgba(232,109,122,0.18)',
              color: 'var(--danger)',
              cursor: 'pointer',
            }}
            aria-label="Remove employee"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
        {/* Name */}
        <div>
          <label style={labelStyle}>Name</label>
          <input
            type="text"
            value={entry.name}
            onChange={e => onChange(entry.id, 'name', e.target.value)}
            placeholder="Alice Chen"
            style={{ ...inputStyle, borderColor: fieldError('name') ? 'var(--danger)' : 'var(--border)' }}
          />
          {fieldError('name') && <div style={errorStyle}>{fieldError('name')}</div>}
        </div>

        {/* Address */}
        <div>
          <label style={labelStyle}>Wallet address</label>
          <input
            type="text"
            value={entry.walletAddress}
            onChange={e => onChange(entry.id, 'walletAddress', e.target.value)}
            placeholder="0x..."
            className="mono"
            style={{
              ...inputStyle,
              fontSize: 12,
              borderColor: fieldError('walletAddress') ? 'var(--danger)' : 'var(--border)',
            }}
          />
          {fieldError('walletAddress') && <div style={errorStyle}>{fieldError('walletAddress')}</div>}
        </div>

        {/* Amount */}
        <div>
          <label style={labelStyle}>Amount (USDC)</label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              inputMode="decimal"
              value={entry.amountUsdc}
              onChange={e => onChange(entry.id, 'amountUsdc', e.target.value)}
              placeholder="500.00"
              className="mono"
              style={{
                ...inputStyle,
                paddingRight: 44,
                borderColor: fieldError('amountUsdc') ? 'var(--danger)' : 'var(--border)',
              }}
            />
            <span
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--muted)',
              }}
            >
              USDC
            </span>
          </div>
          {fieldError('amountUsdc') && <div style={errorStyle}>{fieldError('amountUsdc')}</div>}
        </div>
      </div>

      {/* Optional description */}
      <div className="mt-3">
        <label style={labelStyle}>Description (optional)</label>
        <input
          type="text"
          value={entry.description}
          onChange={e => onChange(entry.id, 'description', e.target.value)}
          placeholder="Salary, bonus, contractor payment…"
          style={inputStyle}
        />
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface CreateBatchModalProps {
  onClose: () => void
  onSubmit: (params: {
    name: string
    entries: EmployeeEntry[]
    scheduleType: ScheduleType
    scheduledDate?: string
    note: string
  }) => void
}

function emptyEntry(): EmployeeEntry {
  return { id: generateId(), name: '', walletAddress: '', amountUsdc: '', description: '' }
}

export default function CreateBatchModal({ onClose, onSubmit }: CreateBatchModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [details, setDetails] = useState<BatchDetailsForm>(EMPTY_DETAILS)
  const [entries, setEntries] = useState<EmployeeEntry[]>([emptyEntry()])
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [detailsErrors, setDetailsErrors] = useState<Partial<Record<keyof BatchDetailsForm, string>>>({})

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Step 1 helpers ──

  function validateDetails(): boolean {
    const errors: Partial<Record<keyof BatchDetailsForm, string>> = {}
    if (!details.name.trim()) errors.name = 'Enter a batch name.'
    if (details.scheduleType === 'scheduled') {
      if (!details.scheduledDate) errors.scheduledDate = 'Choose a payment date.'
      else {
        const d = new Date(`${details.scheduledDate}T${details.scheduledTime || '09:00'}`)
        if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
          errors.scheduledDate = 'Choose a date and time in the future.'
        }
      }
    }
    setDetailsErrors(errors)
    return Object.keys(errors).length === 0
  }

  function toStep2() {
    if (validateDetails()) setStep(2)
  }

  // ── Step 2 helpers ──

  const updateEntry = useCallback((id: string, field: keyof EmployeeEntry, value: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
    // Clear validation on edit
    setValidation(null)
  }, [])

  function addEntry() {
    setEntries(prev => [...prev, emptyEntry()])
  }

  function removeEntry(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  function toStep3() {
    const result = validateBatchEntries(entries)
    setValidation(result)
    if (result.valid) setStep(3)
  }

  // ── Step 3 helpers ──

  const totalRaw = sumBatchAmounts(entries)
  const totalFormatted = formatUsdcBigint(totalRaw)

  const scheduledIso = details.scheduleType === 'scheduled' && details.scheduledDate
    ? `${details.scheduledDate}T${details.scheduledTime || '09:00'}:00`
    : undefined

  function handleSubmit() {
    onSubmit({
      name: details.name.trim(),
      entries,
      scheduleType: details.scheduleType,
      scheduledDate: scheduledIso,
      note: details.note.trim(),
    })
    onClose()
  }

  // ── Render ──

  const STEP_LABELS = ['Details', 'Employees', 'Review']

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(5,12,18,0.85)', backdropFilter: 'blur(6px)', padding: 12 }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(768px, 100%)',
          maxHeight: '90dvh',
          overflowY: 'auto',
          background: 'var(--bg-2)',
          border: '1px solid var(--border-strong)',
        }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Create payroll"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>
              New payroll batch
            </div>
            <h2 className="display font-bold text-lg" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
              Create payroll
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center transition-colors"
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-6 py-3" style={{ borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {STEP_LABELS.map((label, i) => {
            const stepNum = (i + 1) as 1 | 2 | 3
            const done = step > stepNum
            const active = step === stepNum
            return (
              <div key={label} className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center justify-center text-xs font-bold"
                    style={{
                      width: 24,
                      height: 24,
                      background: done || active ? 'var(--accent)' : 'var(--surface-muted)',
                      color: done || active ? 'var(--bg)' : 'var(--subtle)',
                      border: done || active ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {done ? '✓' : stepNum}
                  </div>
                  <span
                    className="text-xs font-medium"
                    style={{ color: active ? 'var(--ink)' : done ? 'var(--accent)' : 'var(--subtle)' }}
                  >
                    {label}
                  </span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <ChevronRight size={14} className="mx-1" style={{ color: 'var(--subtle)' }} />
                )}
              </div>
            )
          })}
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* ── Step 1: Batch Details ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label style={labelStyle}>Batch name *</label>
                <input
                  type="text"
                  value={details.name}
                  onChange={e => setDetails(d => ({ ...d, name: e.target.value }))}
                  placeholder="October Payroll"
                  style={{ ...inputStyle, borderColor: detailsErrors.name ? 'var(--danger)' : 'var(--border)' }}
                />
                {detailsErrors.name && <div style={errorStyle}>{detailsErrors.name}</div>}
              </div>

              <div>
                <label style={labelStyle}>When to pay</label>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
                  {(['immediate', 'scheduled'] as ScheduleType[]).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setDetails(d => ({ ...d, scheduleType: type }))}
                      className="p-4 text-left transition-colors"
                      style={{
                        background: details.scheduleType === type ? 'var(--accent-dim)' : 'var(--surface-muted)',
                        border: `1px solid ${details.scheduleType === type ? 'var(--accent-border)' : 'var(--border)'}`,
                        cursor: 'pointer',
                      }}
                    >
                      <div className="text-sm font-semibold mb-0.5" style={{ color: details.scheduleType === type ? 'var(--accent)' : 'var(--ink-2)' }}>
                        {type === 'immediate' ? 'Pay now' : 'Pay on a date'}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--muted)' }}>
                        {type === 'immediate'
                          ? 'Send payments as soon as you are ready.'
                          : 'Pick a date. You send the payments yourself.'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {details.scheduleType === 'scheduled' && (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
                  <div>
                    <label style={labelStyle}>Payment date *</label>
                    <input
                      type="date"
                      value={details.scheduledDate}
                      onChange={e => setDetails(d => ({ ...d, scheduledDate: e.target.value }))}
                      style={{ ...inputStyle, borderColor: detailsErrors.scheduledDate ? 'var(--danger)' : 'var(--border)' }}
                    />
                    {detailsErrors.scheduledDate && <div style={errorStyle}>{detailsErrors.scheduledDate}</div>}
                  </div>
                  <div>
                    <label style={labelStyle}>Time</label>
                    <input
                      type="time"
                      value={details.scheduledTime}
                      onChange={e => setDetails(d => ({ ...d, scheduledTime: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}

              {details.scheduleType === 'scheduled' && (
                <div
                  className="flex items-start gap-2 p-3 text-xs"
                  style={{ background: 'rgba(232,184,76,0.06)', border: '1px solid rgba(232,184,76,0.15)', color: 'var(--warning)' }}
                >
                  <Info size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Scheduled batches are saved in this browser only and are <strong>not sent automatically</strong>. You need to open the batch and send the payments yourself on the day.
                  </span>
                </div>
              )}

              <div>
                <label style={labelStyle}>Note (optional)</label>
                <textarea
                  value={details.note}
                  onChange={e => setDetails(d => ({ ...d, note: e.target.value }))}
                  placeholder="For example: October salaries"
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical', paddingTop: 9, paddingBottom: 9 }}
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Employees ── */}
          {step === 2 && (
            <div>
              {validation && !validation.valid && (
                <div
                  className="flex items-start gap-2 p-3 mb-4 text-xs"
                  style={{ background: 'rgba(232,109,122,0.07)', border: '1px solid rgba(232,109,122,0.18)', color: 'var(--danger)' }}
                >
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold mb-0.5">Fix the errors below to continue.</div>
                    {validation.globalErrors.map(e => <div key={e}>{e}</div>)}
                  </div>
                </div>
              )}

              <div style={{ maxHeight: '50dvh', overflowY: 'auto', paddingRight: 2 }}>
                {entries.map((entry, i) => (
                  <EmployeeRow
                    key={entry.id}
                    entry={entry}
                    index={i}
                    onChange={updateEntry}
                    onRemove={removeEntry}
                    errors={validation?.entryErrors.get(entry.id)}
                    canRemove={entries.length > 1}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={addEntry}
                className="flex items-center justify-center gap-2 mt-2 px-4 py-2.5 text-sm font-medium transition-colors"
                style={{
                  background: 'var(--surface-muted)',
                  border: '1px dashed var(--border-strong)',
                  color: 'var(--ink-2)',
                  cursor: 'pointer',
                  width: '100%',
                  minHeight: 44,
                }}
              >
                <Plus size={15} />
                Add employee
              </button>

              {/* Running total */}
              <div
                className="flex items-center justify-between mt-4 px-5 py-3"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
              >
                <div className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
                  {entries.length} employee{entries.length !== 1 ? 's' : ''}
                </div>
                <div className="display font-bold text-base" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsdcBigint(sumBatchAmounts(entries))} USDC
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Review ── */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Summary card */}
              <Card>
                <CardBody>
                  <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>
                    Batch summary
                  </div>
                  <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))' }}>
                    {[
                      { label: 'Batch name', value: details.name },
                      { label: 'Employees', value: String(entries.length) },
                      { label: 'Total', value: `${totalFormatted} USDC` },
                      { label: 'Timing', value: details.scheduleType === 'immediate' ? 'Pay now' : 'On a date' },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)', fontSize: 10 }}>{label}</div>
                        <div className="text-sm font-semibold mono" style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {details.scheduleType === 'scheduled' && scheduledIso && (
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      Payment date: <span style={{ color: 'var(--ink-2)' }}>{new Date(scheduledIso).toLocaleString()}</span>
                      <span className="ml-2 font-semibold" style={{ color: 'var(--warning)' }}>(not sent automatically)</span>
                    </div>
                  )}
                  {details.note && (
                    <div className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                      Note: {details.note}
                    </div>
                  )}
                </CardBody>
              </Card>

              {/* Employee list */}
              <div className="overflow-x-auto" style={{ border: '1px solid var(--border)' }}>
                <table className="w-full" style={{ minWidth: 560 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-muted)' }}>
                      {['Name', 'Wallet', 'Amount', 'Description'].map(h => (
                        <th key={h} className="text-left text-xs uppercase tracking-wider px-4 py-3" style={{ color: 'var(--subtle)', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: '0.07em' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e, i) => (
                      <tr key={e.id} style={{ borderBottom: i < entries.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>{e.name || '—'}</td>
                        <td className="px-4 py-3 text-xs mono" style={{ color: 'var(--muted)', wordBreak: 'break-all' }}>
                          {e.walletAddress ? `${e.walletAddress.slice(0, 6)}…${e.walletAddress.slice(-4)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm mono font-semibold" style={{ color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                          {e.amountUsdc} USDC
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{e.description || '—'}</td>
                      </tr>
                    ))}
                    <tr style={{ background: 'var(--accent-dim)' }}>
                      <td className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }} colSpan={2}>
                        Total
                      </td>
                      <td className="px-4 py-3 text-base font-bold display mono" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                        {totalFormatted} USDC
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Real payment notice */}
              <div
                className="flex items-start gap-2 p-3 text-xs"
                style={{ background: 'rgba(232,184,76,0.06)', border: '1px solid rgba(232,184,76,0.15)', color: 'var(--warning)' }}
              >
                <Info size={13} className="mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">These are real USDC payments. </span>
                  Saving creates the batch only. When you run it, each employee is paid separately on Arc Mainnet
                  and each payment needs its own wallet confirmation. Some payments may succeed while others fail,
                  so make sure your wallet holds enough USDC.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center justify-between gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--ink-2)',
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              <ChevronLeft size={14} />
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--muted)',
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              Cancel
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={step === 1 ? toStep2 : toStep3}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold transition-colors"
              style={{
                background: 'var(--accent)',
                border: 'none',
                color: 'var(--bg)',
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              Continue
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold"
              style={{
                background: 'var(--accent)',
                border: 'none',
                color: 'var(--bg)',
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              Save batch
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
