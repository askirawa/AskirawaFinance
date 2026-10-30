/**
 * MemberDetail — side drawer showing a member's details,
 * with controls to change role or remove the member.
 */

import { useState } from 'react'
import { X, AlertTriangle, Shield } from 'lucide-react'
import { useOrgContext } from '../../context/OrgContext'
import Badge from '../ui/Badge'
import {
  type OrgMember,
  type OrgRole,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_ORDER,
  MEMBER_STATUS_LABELS,
  roleVariant,
  memberStatusVariant,
  canAssignRole,
  formatAddr,
  formatTs,
} from '../../lib/org'
import { parseOnchainError } from '../../lib/utils'

interface MemberDetailProps {
  member: OrgMember
  onClose: () => void
}

export default function MemberDetail({ member, onClose }: MemberDetailProps) {
  const { org, myRole, myAddress, can, changeMemberRole, removeMember, ownerCount } = useOrgContext()

  const [editingRole, setEditingRole] = useState(false)
  const [selectedRole, setSelectedRole] = useState<OrgRole>(member.role)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [roleSuccess, setRoleSuccess] = useState(false)

  const isSelf = myAddress === member.walletAddress
  const isLastOwner = member.role === 'owner' && ownerCount <= 1

  const canManage = can('manage_members') && !isSelf
  const eligibleRoles: OrgRole[] = myRole
    ? ROLE_ORDER.filter(r => canAssignRole(myRole, r))
    : []

  function handleRoleChange() {
    if (selectedRole === member.role) { setEditingRole(false); return }
    try {
      changeMemberRole(member.id, selectedRole)
      setRoleSuccess(true)
      setEditingRole(false)
    } catch (e) {
      setActionError(parseOnchainError(e))
    }
  }

  function handleRemove() {
    try {
      removeMember(member.id)
      onClose()
    } catch (e) {
      setActionError(parseOnchainError(e))
      setConfirmRemove(false)
    }
  }

  // Find inviter display
  const inviterMember = org?.members.find(m => m.walletAddress === member.invitedBy)
  const inviterLabel = inviterMember?.displayName || (member.invitedBy ? formatAddr(member.invitedBy) : '—')

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{value}</span>
    </div>
  )

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 60,
          width: '100%', maxWidth: 440,
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>
              {member.displayName || formatAddr(member.walletAddress, 8)}
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Team member details</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          {/* Badges */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <Badge variant={roleVariant(member.role)}>{ROLE_LABELS[member.role]}</Badge>
            <Badge variant={memberStatusVariant(member.status)}>{MEMBER_STATUS_LABELS[member.status]}</Badge>
            {isSelf && <Badge variant="neutral">You</Badge>}
          </div>

          {/* Details */}
          <div style={{ marginBottom: 24 }}>
            {row('Wallet', <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{member.walletAddress}</span>)}
            {member.displayName && row('Display name', member.displayName)}
            {row('Status', MEMBER_STATUS_LABELS[member.status])}
            {row('Invited by', inviterLabel)}
            {row('Invited', formatTs(member.invitedAt))}
            {member.joinedAt && row('Joined', formatTs(member.joinedAt))}
            {member.note && row('Note', <span style={{ fontStyle: 'italic', color: 'var(--muted)' }}>{member.note}</span>)}
          </div>

          {/* Action error */}
          {actionError && (
            <div style={{ background: 'rgba(232,109,122,0.1)', border: '1px solid rgba(232,109,122,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: 'var(--danger)' }}>{actionError}</p>
            </div>
          )}

          {roleSuccess && (
            <div style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: 'var(--accent)' }}>Role updated successfully.</p>
            </div>
          )}

          {/* Role editor */}
          {canManage && can('assign_roles') && member.status === 'active' && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Role</p>
                {!editingRole && (
                  <button
                    onClick={() => { setEditingRole(true); setRoleSuccess(false) }}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 12px', fontSize: 12, color: 'var(--accent)', cursor: 'pointer' }}
                  >
                    Change Role
                  </button>
                )}
              </div>

              {editingRole ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {eligibleRoles.sort((a, b) => ROLE_ORDER.indexOf(b) - ROLE_ORDER.indexOf(a)).map(r => (
                    <button
                      key={r}
                      onClick={() => setSelectedRole(r)}
                      style={{
                        textAlign: 'left',
                        background: selectedRole === r ? 'var(--accent-dim)' : 'var(--surface-muted)',
                        border: selectedRole === r ? '1px solid var(--accent-border)' : '1px solid var(--border)',
                        borderRadius: 10, padding: '9px 13px', cursor: 'pointer',
                      }}
                    >
                      <p style={{ fontWeight: 600, fontSize: 13, color: selectedRole === r ? 'var(--accent)' : 'var(--ink)' }}>
                        {ROLE_LABELS[r]}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{ROLE_DESCRIPTIONS[r]}</p>
                    </button>
                  ))}
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button
                      onClick={() => { setEditingRole(false); setSelectedRole(member.role) }}
                      style={{ flex: 1, background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)', borderRadius: 10, padding: '8px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleRoleChange}
                      style={{ flex: 2, background: 'var(--accent)', color: '#021a0e', border: 'none', borderRadius: 10, padding: '8px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                    >
                      Confirm Change
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
                  <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{ROLE_LABELS[member.role]}</p>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{ROLE_DESCRIPTIONS[member.role]}</p>
                </div>
              )}
            </div>
          )}

          {/* Remove section */}
          {canManage && member.status !== 'removed' && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              {isLastOwner && (
                <div style={{ background: 'rgba(232,184,76,0.08)', border: '1px solid rgba(232,184,76,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: 12, color: 'var(--warning)' }}>
                    This is the last owner. Promote another member to owner before removing this person.
                  </p>
                </div>
              )}

              {!confirmRemove ? (
                <button
                  onClick={() => setConfirmRemove(true)}
                  disabled={isLastOwner}
                  style={{
                    width: '100%', background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.25)',
                    color: 'var(--danger)', borderRadius: 10, padding: '10px', fontWeight: 600, fontSize: 13,
                    cursor: isLastOwner ? 'not-allowed' : 'pointer', opacity: isLastOwner ? 0.5 : 1,
                  }}
                >
                  Remove from Organization
                </button>
              ) : (
                <div style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.25)', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
                    <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 13, color: 'var(--ink)' }}>
                      Remove <strong>{member.displayName || formatAddr(member.walletAddress)}</strong> from the organization?
                      This only updates the local record — it does not revoke any on-chain permissions.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => setConfirmRemove(false)}
                      style={{ flex: 1, background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)', borderRadius: 10, padding: '8px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleRemove}
                      style={{ flex: 2, background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                    >
                      Remove Member
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Self-view note */}
          {isSelf && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Shield size={14} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                You cannot modify your own role or remove yourself. Ask another admin or owner.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
