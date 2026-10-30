/**
 * PolicySettings — modal for editing the approval threshold and approver list.
 *
 * Changes are saved in this browser only. The rules are checked by this page, not by a contract.
 */

import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Info, AlertCircle } from 'lucide-react'
import { type ApprovalPolicy } from '../../lib/approvals'

interface Props {
  policy: ApprovalPolicy
  onSave: (updates: Partial<ApprovalPolicy>) => void
  onClose: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-muted)',
  border: '1px solid var(--border)',
  minHeight: 44,
  padding: '10px 12px',
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
      {children}
    </label>
  )
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return (
    <div className="flex items-center gap-1.5 mt-1.5" style={{ color: 'var(--danger)', fontSize: 12 }}>
      <AlertCircle size={12} /> {msg}
    </div>
  )
}

export default function PolicySettings({ policy, onSave, onClose }: Props) {
  const [threshold, setThreshold] = useState(policy.thresholdUsdc)
  const [required, setRequired] = useState(String(policy.requiredApprovals))
  const [approvers, setApprovers] = useState<string[]>(policy.approverAddresses)
  const [newApprover, setNewApprover] = useState('')
  const [errors, setErrors] = useState<{ threshold?: string; required?: string; approver?: string }>({})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function validate(): boolean {
    const e: typeof errors = {}
    if (!/^\d+(\.\d+)?$/.test(threshold.trim()) || Number(threshold) <= 0) {
      e.threshold = 'Enter an amount greater than zero, for example 1000.00.'
    }
    const req = parseInt(required, 10)
    if (isNaN(req) || req < 1) {
      e.required = 'Enter at least 1 approval.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function addApprover() {
    const addr = newApprover.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setErrors(e => ({ ...e, approver: 'This is not a valid wallet address. It should start with 0x and be 42 characters long.' }))
      return
    }
    if (approvers.some(a => a.toLowerCase() === addr.toLowerCase())) {
      setErrors(e => ({ ...e, approver: 'This wallet address is already on the list.' }))
      return
    }
    setApprovers(a => [...a, addr])
    setNewApprover('')
    setErrors(e => ({ ...e, approver: undefined }))
  }

  function removeApprover(addr: string) {
    setApprovers(a => a.filter(x => x.toLowerCase() !== addr.toLowerCase()))
  }

  function handleSave() {
    if (!validate()) return
    onSave({
      thresholdUsdc: threshold.trim(),
      requiredApprovals: parseInt(required, 10),
      approverAddresses: approvers,
    })
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}
      role="dialog"
      aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: 'min(560px, 100%)', maxHeight: '90dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Approval rules</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Saved in this browser only — not enforced by a contract</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Warning */}
          <div className="flex items-start gap-3 p-4" style={{ background: 'var(--warning-dim)', border: '1px solid var(--warning-border)' }}>
            <Info size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--warning)', lineHeight: 1.5 }}>
              These rules are saved in this browser and checked by this page only. They do not stop anyone from sending payments directly from a wallet. A treasury contract is needed to enforce them.
            </span>
          </div>

          {/* Threshold */}
          <div>
            <Label>Approval limit (USDC)</Label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 60 }}
                placeholder="1000.00"
                value={threshold}
                onChange={e => { setThreshold(e.target.value); setErrors(er => ({ ...er, threshold: undefined })) }}
              />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 12, fontWeight: 600, pointerEvents: 'none' }}>USDC</span>
            </div>
            <FieldError msg={errors.threshold} />
            <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 6 }}>
              Transfers of this amount or more need approval before they are sent.
            </div>
          </div>

          {/* Required approvals */}
          <div>
            <Label>Approvals needed</Label>
            <input
              type="number"
              min={1}
              max={10}
              style={{ ...inputStyle, maxWidth: 'min(120px, 100%)' }}
              value={required}
              onChange={e => { setRequired(e.target.value); setErrors(er => ({ ...er, required: undefined })) }}
            />
            <FieldError msg={errors.required} />
            <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 6 }}>
              How many different people must approve before a payment can be sent.
            </div>
          </div>

          {/* Authorized approvers */}
          <div>
            <Label>Allowed approvers</Label>
            <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 10 }}>
              Leave empty to let any connected wallet approve. Add wallet addresses to limit who can approve.
            </div>
            {approvers.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {approvers.map(addr => (
                  <div key={addr} className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--ink)', fontFamily: 'monospace', minWidth: 0, overflowWrap: 'anywhere' }}>
                      {addr.slice(0, 10)}…{addr.slice(-8)}
                    </span>
                    <button
                      onClick={() => removeApprover(addr)}
                      aria-label="Remove approver"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--subtle)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                style={{ ...inputStyle, flex: '1 1 200px', minWidth: 0 }}
                placeholder="0x..."
                value={newApprover}
                onChange={e => { setNewApprover(e.target.value); setErrors(er => ({ ...er, approver: undefined })) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addApprover() } }}
                spellCheck={false}
              />
              <button
                onClick={addApprover}
                style={{ flexShrink: 0, minHeight: 44, padding: '0 14px', border: '1px solid var(--border)', background: 'var(--surface-strong)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600 }}
              >
                <Plus size={14} /> Add
              </button>
            </div>
            <FieldError msg={errors.approver} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', minHeight: 44, padding: '0 20px', fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{ minHeight: 44, padding: '0 24px', fontSize: 13, fontWeight: 700, background: 'var(--accent)', border: 'none', color: 'var(--bg)', cursor: 'pointer' }}
          >
            Save rules
          </button>
        </div>
      </div>
    </div>
  )
}
