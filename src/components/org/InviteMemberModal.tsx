/**
 * InviteMemberModal — add/invite a new member to the organization.
 *
 * NOTE: This creates an invitation saved in this browser only. No email or push
 * notification is sent — there is no notification service in this app.
 * The invited person sees the invitation when they connect the invited wallet.
 */

import { useState, useEffect } from 'react'
import { X, UserPlus, Info } from 'lucide-react'
import { useOrgContext } from '../../context/OrgContext'
import {
  type OrgRole,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_ORDER,
  isValidAddress,
  canAssignRole,
} from '../../lib/org'

interface InviteMemberModalProps {
  onClose: () => void
}

const ASSIGNABLE_ROLES: OrgRole[] = ['viewer', 'approver', 'finance_manager', 'admin', 'owner']

export default function InviteMemberModal({ onClose }: InviteMemberModalProps) {
  const { myRole, inviteMember } = useOrgContext()
  const [walletAddress, setWalletAddress] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<OrgRole>('viewer')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Only show roles the current user can assign
  const eligibleRoles = ASSIGNABLE_ROLES.filter(r =>
    myRole ? canAssignRole(myRole, r) : false
  )

  function validate(): string | null {
    if (!walletAddress.trim()) return 'Enter the wallet address of the person you want to invite.'
    if (!isValidAddress(walletAddress.trim())) return 'This is not a valid wallet address. It should start with 0x and be 42 characters long.'
    if (!role) return 'Choose a role for this person.'
    return null
  }

  function handleSubmit() {
    const err = validate()
    if (err) { setError(err); return }
    setIsSubmitting(true)
    setError(null)
    try {
      inviteMember(walletAddress.trim(), role, displayName.trim() || undefined, note.trim() || undefined)
      setSuccess(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The invitation was not saved. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--surface-muted)',
    border: '1px solid var(--border)',
    minHeight: 44,
    color: 'var(--ink)',
    fontSize: 14,
    padding: '10px 14px',
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12,
      }}
      role="dialog"
      aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          width: 'min(560px, 100%)',
          maxHeight: '90dvh',
          overflowY: 'auto',
          padding: 24,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, flexShrink: 0,
              background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
            }}>
              <UserPlus size={16} />
            </div>
            <div>
              <p style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 16 }}>Invite a team member</p>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>Add someone by wallet address</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {success ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', padding: '16px 0' }}>
            <div style={{
              width: 48, height: 48,
              background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
            }}>
              <UserPlus size={20} />
            </div>
            <p style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 15 }}>Invitation saved</p>
            <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', maxWidth: 320 }}>
              The invitation is saved in this browser only. No email or message was sent.
            </p>
            {/* Invitation notice */}
            <div style={{
              background: 'var(--warning-dim)', border: '1px solid var(--warning-border)',
              padding: '10px 14px', width: '100%',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <Info size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: 'var(--warning)' }}>
                Let the person know yourself, for example by sending them the link to this app. Invitations are not delivered automatically.
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'var(--accent)', color: 'var(--bg)', border: 'none',
                minHeight: 44, padding: '0 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* This-browser-only notice */}
            <div style={{
              background: 'var(--warning-dim)', border: '1px solid var(--warning-border)',
              padding: '10px 14px',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <Info size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: 'var(--warning)' }}>
                Invitations are saved in this browser only. Other people will not see them from their own devices.
              </p>
            </div>

            {/* Wallet address */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
                Wallet address <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="text"
                placeholder="0x…"
                value={walletAddress}
                onChange={e => { setWalletAddress(e.target.value); setError(null) }}
                style={inputStyle}
              />
            </div>

            {/* Display name */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
                Name <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="text"
                placeholder="For example: Jane Doe"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Role */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 8 }}>
                Role <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {eligibleRoles.sort((a, b) => ROLE_ORDER.indexOf(b) - ROLE_ORDER.indexOf(a)).map(r => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    style={{
                      textAlign: 'left',
                      background: role === r ? 'var(--accent-dim)' : 'var(--surface-muted)',
                      border: role === r ? '1px solid var(--accent-border)' : '1px solid var(--border)',
                      minHeight: 44,
                      padding: '10px 14px',
                      cursor: 'pointer',
                    }}
                  >
                    <p style={{ fontWeight: 600, fontSize: 13, color: role === r ? 'var(--accent)' : 'var(--ink)' }}>
                      {ROLE_LABELS[r]}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{ROLE_DESCRIPTIONS[r]}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Note */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
                Note <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                placeholder="For example: Welcome to Askirawa Finance. You will approve payroll."
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* Error */}
            {error && (
              <p style={{ fontSize: 13, color: 'var(--danger)', background: 'var(--danger-dim)', padding: '8px 12px' }}>
                {error}
              </p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, paddingTop: 4, flexWrap: 'wrap' }}>
              <button
                onClick={onClose}
                style={{
                  flex: '1 1 100px', background: 'var(--surface-muted)', border: '1px solid var(--border)',
                  color: 'var(--ink-2)', minHeight: 44,
                  fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                style={{
                  flex: '2 1 160px', background: 'var(--accent)', color: 'var(--bg)', border: 'none',
                  minHeight: 44, fontWeight: 700, fontSize: 14,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1,
                }}
              >
                {isSubmitting ? 'Saving…' : 'Save invitation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
