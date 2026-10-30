/**
 * InviteMemberModal — add/invite a new member to the organization.
 *
 * NOTE: This creates a local invitation record only. No email or push
 * notification is sent — there is no notification service in this app.
 * The invited person sees the invitation when they connect the invited wallet.
 */

import { useState } from 'react'
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
import { parseOnchainError } from '../../lib/utils'

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

  // Only show roles the current user can assign
  const eligibleRoles = ASSIGNABLE_ROLES.filter(r =>
    myRole ? canAssignRole(myRole, r) : false
  )

  function validate(): string | null {
    if (!walletAddress.trim()) return 'Wallet address is required.'
    if (!isValidAddress(walletAddress.trim())) return 'Invalid Ethereum address (must be 0x…, 42 chars).'
    if (!role) return 'Select a role.'
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
      setError(parseOnchainError(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--surface-muted)',
    border: '1px solid var(--border)',
    borderRadius: 10,
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
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          width: '100%',
          maxWidth: 480,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 28,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'rgba(53,217,139,0.1)', border: '1px solid var(--accent-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
            }}>
              <UserPlus size={16} />
            </div>
            <div>
              <p style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 16 }}>Invite Team Member</p>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>Add a wallet address to the organization</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {success ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', padding: '16px 0' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
            }}>
              <UserPlus size={20} />
            </div>
            <p style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 15 }}>Invitation Created</p>
            <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', maxWidth: 320 }}>
              A local invitation record has been created. The invited wallet will see it when they connect.
              No email notification has been sent.
            </p>
            {/* Invitation notice */}
            <div style={{
              background: 'rgba(232,184,76,0.08)', border: '1px solid rgba(232,184,76,0.2)',
              borderRadius: 10, padding: '10px 14px', width: '100%',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <Info size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: 'var(--warning)' }}>
                To notify the invitee, share the organization app URL with them. There is no automated delivery in this version.
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'var(--accent)', color: '#021a0e', border: 'none',
                borderRadius: 10, padding: '10px 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Local storage notice */}
            <div style={{
              background: 'rgba(232,184,76,0.08)', border: '1px solid rgba(232,184,76,0.2)',
              borderRadius: 10, padding: '10px 14px',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <Info size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: 'var(--warning)' }}>
                Invitations are stored locally in this browser. The invited address will see their invitation when they connect this wallet to the app.
              </p>
            </div>

            {/* Wallet address */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
                Wallet Address <span style={{ color: 'var(--danger)' }}>*</span>
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
                Display Name <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Jane Doe"
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
                      borderRadius: 10,
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
                Invitation Note <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                placeholder="e.g. Welcome to AskirawaFi — you'll manage payroll approvals."
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* Error */}
            {error && (
              <p style={{ fontSize: 13, color: 'var(--danger)', background: 'rgba(232,109,122,0.08)', borderRadius: 8, padding: '8px 12px' }}>
                {error}
              </p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1, background: 'var(--surface-muted)', border: '1px solid var(--border)',
                  color: 'var(--ink-2)', borderRadius: 10, padding: '10px 0',
                  fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                style={{
                  flex: 2, background: 'var(--accent)', color: '#021a0e', border: 'none',
                  borderRadius: 10, padding: '10px 0', fontWeight: 700, fontSize: 14,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1,
                }}
              >
                {isSubmitting ? 'Creating…' : 'Send Invitation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
