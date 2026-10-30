/**
 * Organization — team management page.
 *
 * IMPORTANT: All data is localStorage-only. See src/lib/org.ts for the full
 * architecture note. This page never enforces permissions on-chain.
 */

import { useState, useMemo } from 'react'
import {
  Building2,
  Users,
  UserPlus,
  Settings,
  Shield,
  Clock,
  ChevronRight,
  Info,
  AlertTriangle,
  Trash2,
  Edit3,
  Check,
  X,
} from 'lucide-react'
import { useOrgContext } from '../context/OrgContext'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import InviteMemberModal from '../components/org/InviteMemberModal'
import MemberDetail from '../components/org/MemberDetail'
import {
  type OrgMember,
  type MemberStatus,
  ROLE_LABELS,
  MEMBER_STATUS_LABELS,
  roleVariant,
  memberStatusVariant,
  formatAddr,
  formatDate,
  getOrgStats,
} from '../lib/org'

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardBody>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 500 }}>{label}</p>
        <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1 }}>
          {value}
        </p>
        {sub && <p style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 4 }}>{sub}</p>}
      </CardBody>
    </Card>
  )
}

// ─── Local-data disclaimer ─────────────────────────────────────────────────────

function LocalDataNotice() {
  return (
    <div style={{
      background: 'rgba(232,184,76,0.07)',
      border: '1px solid rgba(232,184,76,0.18)',
      borderRadius: 12,
      padding: '12px 16px',
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <Info size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
      <p style={{ fontSize: 12, color: 'var(--warning)', lineHeight: 1.5 }}>
        <strong>Browser-local records.</strong> Organization and membership data is stored in this browser only.
        It is not shared across devices or users, and it is not verified on-chain.
        A production deployment requires a backend database with SIWE (Sign-In With Ethereum) authentication.
      </p>
    </div>
  )
}

// ─── Create org form ──────────────────────────────────────────────────────────

function CreateOrgForm() {
  const { createOrg, myAddress } = useOrgContext()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
    fontFamily: 'inherit',
  }

  function handleCreate() {
    if (!name.trim()) { setError('Organization name is required.'); return }
    if (name.trim().length < 2) { setError('Name must be at least 2 characters.'); return }
    setIsSubmitting(true)
    setError(null)
    try {
      createOrg(name.trim(), description.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'rgba(53,217,139,0.1)', border: '1px solid var(--accent-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)', margin: '0 auto 16px',
        }}>
          <Building2 size={24} />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 8, fontFamily: "'Space Grotesk', sans-serif" }}>
          Create Your Organization
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 380, margin: '0 auto' }}>
          Set up your treasury organization to manage team members, roles, and financial operations.
        </p>
      </div>

      <LocalDataNotice />

      <Card>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
              Organization Name <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Askirawa Treasury"
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
              Description <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              placeholder="Brief description of this organization's purpose…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Creator info */}
          <div style={{ background: 'var(--surface-muted)', borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>You will be set as Owner</p>
            <p style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--ink-2)' }}>
              {myAddress ?? 'Connect wallet to continue'}
            </p>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: 'var(--danger)', background: 'rgba(232,109,122,0.08)', borderRadius: 8, padding: '8px 12px' }}>
              {error}
            </p>
          )}

          <button
            onClick={handleCreate}
            disabled={isSubmitting || !myAddress}
            style={{
              background: myAddress ? 'var(--accent)' : 'var(--surface-strong)',
              color: myAddress ? '#021a0e' : 'var(--muted)',
              border: 'none', borderRadius: 10, padding: '12px',
              fontWeight: 700, fontSize: 14, cursor: myAddress ? 'pointer' : 'not-allowed',
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            {!myAddress ? 'Connect Wallet First' : isSubmitting ? 'Creating…' : 'Create Organization'}
          </button>
        </CardBody>
      </Card>
    </div>
  )
}

// ─── Settings panel ───────────────────────────────────────────────────────────

function OrgSettings({ onClose }: { onClose: () => void }) {
  const { org, myAddress, can, updateOrgSettings, deleteOrg } = useOrgContext()
  const [name, setName] = useState(org?.name ?? '')
  const [description, setDescription] = useState(org?.description ?? '')
  const [treasuryWallet, setTreasuryWallet] = useState(org?.treasuryWallet ?? myAddress ?? '')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canEdit = can('manage_org_settings')

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: canEdit ? 'var(--surface-muted)' : 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    color: canEdit ? 'var(--ink)' : 'var(--muted)',
    fontSize: 14,
    padding: '10px 14px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  }

  function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return }
    try {
      updateOrgSettings({ name: name.trim(), description: description.trim(), treasuryWallet: treasuryWallet.trim() || undefined })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 60,
        width: '100%', maxWidth: 440,
        background: 'var(--surface)', borderLeft: '1px solid var(--border)',
        overflowY: 'auto', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Settings size={16} style={{ color: 'var(--accent)' }} />
            <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>Organization Settings</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}><X size={18} /></button>
        </div>

        <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {!canEdit && (
            <div style={{ background: 'rgba(232,184,76,0.08)', border: '1px solid rgba(232,184,76,0.2)', borderRadius: 10, padding: '10px 14px', display: 'flex', gap: 8 }}>
              <Shield size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: 'var(--warning)' }}>You need Owner permission to edit organization settings.</p>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
              Organization Name <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={!canEdit} style={inputStyle} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={!canEdit} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>Treasury Wallet Address</label>
            <input type="text" value={treasuryWallet} onChange={e => setTreasuryWallet(e.target.value)} disabled={!canEdit} placeholder="0x…" style={inputStyle} />
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Display-only. This does not create or control a smart contract wallet.</p>
          </div>

          <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>Organization ID</p>
            <p style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--subtle)' }}>{org?.id}</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, marginBottom: 2 }}>Created</p>
            <p style={{ fontSize: 12, color: 'var(--subtle)' }}>{org ? formatDate(org.createdAt) : '—'}</p>
          </div>

          {error && <p style={{ fontSize: 13, color: 'var(--danger)', background: 'rgba(232,109,122,0.08)', borderRadius: 8, padding: '8px 12px' }}>{error}</p>}

          {canEdit && (
            <button
              onClick={handleSave}
              style={{
                background: saved ? 'var(--accent-dim)' : 'var(--accent)',
                color: saved ? 'var(--accent)' : '#021a0e',
                border: saved ? '1px solid var(--accent-border)' : 'none',
                borderRadius: 10, padding: '11px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {saved ? <><Check size={14} /> Saved</> : <><Edit3 size={14} /> Save Changes</>}
            </button>
          )}

          {/* Danger zone */}
          {can('manage_org_settings') && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Danger Zone</p>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  style={{ width: '100%', background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.25)', color: 'var(--danger)', borderRadius: 10, padding: '10px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <Trash2 size={14} /> Delete Organization
                </button>
              ) : (
                <div style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.25)', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                    <p style={{ fontSize: 13, color: 'var(--ink)' }}>
                      Delete all local organization data? This cannot be undone. On-chain contracts and tokens are unaffected.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)', borderRadius: 10, padding: '8px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={() => { deleteOrg(); onClose() }} style={{ flex: 2, background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Delete Permanently</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({ member, onClick }: { member: OrgMember; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      style={{ cursor: 'pointer', transition: 'background 0.15s' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-muted)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--surface-muted)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--subtle)', fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>
            {(member.displayName?.[0] ?? member.walletAddress[2] ?? 'M').toUpperCase()}
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              {member.displayName || formatAddr(member.walletAddress, 8)}
            </p>
            {member.displayName && (
              <p style={{ fontSize: 11, color: 'var(--subtle)', fontFamily: 'monospace' }}>
                {formatAddr(member.walletAddress)}
              </p>
            )}
          </div>
        </div>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <Badge variant={roleVariant(member.role)}>{ROLE_LABELS[member.role]}</Badge>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <Badge variant={memberStatusVariant(member.status)}>{MEMBER_STATUS_LABELS[member.status]}</Badge>
      </td>
      <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--muted)' }}>
        {member.joinedAt ? formatDate(member.joinedAt) : member.status === 'invited' ? <span style={{ color: 'var(--warning)' }}>Pending</span> : '—'}
      </td>
      <td style={{ padding: '12px 16px' }}>
        <ChevronRight size={14} style={{ color: 'var(--subtle)' }} />
      </td>
    </tr>
  )
}

// ─── Invitation banner ─────────────────────────────────────────────────────────

function InviteBanner() {
  const { org, myPendingInvite, acceptInvitation, declineInvitation } = useOrgContext()
  const [actioned, setActioned] = useState(false)

  if (!myPendingInvite || actioned) return null

  const inviterMember = org?.members.find(m => m.walletAddress === myPendingInvite.invitedBy)
  const inviterLabel = inviterMember?.displayName || (myPendingInvite.invitedBy ? formatAddr(myPendingInvite.invitedBy) : 'a team member')

  return (
    <div style={{
      background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
      borderRadius: 12, padding: '14px 18px',
      display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)', marginBottom: 2 }}>
          You have a pending invitation
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          {inviterLabel} invited you to join as <strong>{ROLE_LABELS[myPendingInvite.role]}</strong>
          {myPendingInvite.note && `: "${myPendingInvite.note}"`}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => { declineInvitation(); setActioned(true) }}
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, padding: '7px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >
          Decline
        </button>
        <button
          onClick={() => { acceptInvitation(); setActioned(true) }}
          style={{ background: 'var(--accent)', color: '#021a0e', border: 'none', borderRadius: 8, padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          Accept
        </button>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type TabId = 'members' | 'invitations' | 'roles'
type StatusFilter = 'all' | MemberStatus

export default function Organization() {
  const { org, myAddress, myRole, can, stats } = useOrgContext()

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedMember, setSelectedMember] = useState<OrgMember | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('members')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  // All hooks must be called before any conditional return
  const orgStats = org ? getOrgStats(org) : null

  const filteredMembers = useMemo(() => {
    if (!org) return []
    let list = org.members.filter(m => m.status !== 'removed')

    if (activeTab === 'members') list = list.filter(m => m.status === 'active')
    else if (activeTab === 'invitations') list = list.filter(m => m.status === 'invited' || m.status === 'declined')

    if (statusFilter !== 'all') list = list.filter(m => m.status === statusFilter)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        m.walletAddress.toLowerCase().includes(q) ||
        m.displayName?.toLowerCase().includes(q) ||
        ROLE_LABELS[m.role].toLowerCase().includes(q)
      )
    }

    return list
  }, [org, activeTab, statusFilter, search])

  // Conditional render AFTER all hooks
  if (!org) {
    return (
      <div style={{ padding: '48px 0' }}>
        {!myAddress && (
          <div style={{ textAlign: 'center', maxWidth: 400, margin: '0 auto 32px', padding: '0 16px' }}>
            <p style={{ fontSize: 14, color: 'var(--muted)' }}>Connect your wallet to create or join an organization.</p>
          </div>
        )}
        <CreateOrgForm />
      </div>
    )
  }

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'members', label: 'Active Members', count: orgStats?.activeMembers ?? 0 },
    { id: 'invitations', label: 'Invitations', count: orgStats?.pendingInvitations ?? 0 },
    { id: 'roles', label: 'Role Summary', count: 0 },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif", marginBottom: 4 }}>
            {org.name}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>
            {org.description || 'Organization and team management'}
            {myRole && (
              <span style={{ marginLeft: 8 }}>
                <Badge variant={roleVariant(myRole)}>{ROLE_LABELS[myRole]}</Badge>
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {can('manage_org_settings') && (
            <button
              onClick={() => setShowSettings(true)}
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)', borderRadius: 10, padding: '9px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Settings size={14} /> Settings
            </button>
          )}
          {can('manage_members') && (
            <button
              onClick={() => setShowInviteModal(true)}
              style={{ background: 'var(--accent)', color: '#021a0e', border: 'none', borderRadius: 10, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <UserPlus size={14} /> Invite Member
            </button>
          )}
        </div>
      </div>

      {/* Local data notice */}
      <LocalDataNotice />

      {/* Pending invite banner */}
      <InviteBanner />

      {/* Stats — orgStats is non-null here because the !org guard above returned early */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <StatCard label="Total Members" value={orgStats!.activeMembers} />
        <StatCard label="Pending Invites" value={orgStats!.pendingInvitations} />
        <StatCard label="Owners" value={orgStats!.owners} />
        <StatCard label="Admins" value={orgStats!.admins} />
        <StatCard label="Finance Managers" value={orgStats!.financeManagers} />
        <StatCard label="Approvers" value={orgStats!.approvers} />
      </div>

      {/* Main card */}
      <Card>
        {/* Tabs */}
        <div style={{ borderBottom: '1px solid var(--border)', display: 'flex', gap: 0, padding: '0 24px', overflowX: 'auto' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setStatusFilter('all'); setSearch('') }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '14px 16px', fontSize: 13, fontWeight: 600,
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--muted)',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  background: activeTab === tab.id ? 'var(--accent-dim)' : 'var(--surface-muted)',
                  color: activeTab === tab.id ? 'var(--accent)' : 'var(--muted)',
                  borderRadius: 20, fontSize: 11, fontWeight: 700,
                  padding: '1px 7px', border: '1px solid var(--border)',
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Role summary tab */}
        {activeTab === 'roles' ? (
          <CardBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Permission matrix */}
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                Role permissions are enforced in the UI only. On-chain treasury operations are not restricted by these roles.
                A production deployment requires an authenticated backend and/or smart-contract role enforcement.
              </p>

              {(['owner', 'admin', 'finance_manager', 'approver', 'viewer'] as const).map(role => {
                const count = stats ? (
                  role === 'owner' ? stats.owners :
                  role === 'admin' ? stats.admins :
                  role === 'finance_manager' ? stats.financeManagers :
                  role === 'approver' ? stats.approvers :
                  stats.viewers
                ) : 0

                const perms: Record<typeof role, string[]> = {
                  owner: ['All permissions including org settings, members, treasury policy'],
                  admin: ['Manage members, roles, operations (within owner scope)'],
                  finance_manager: ['Create/manage payroll, recurring payments, submit transfers'],
                  approver: ['Review and approve/reject treasury requests'],
                  viewer: ['Read-only access to permitted information'],
                }

                return (
                  <div
                    key={role}
                    style={{
                      padding: '14px 0',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 140 }}>
                      <Badge variant={roleVariant(role)}>{ROLE_LABELS[role]}</Badge>
                      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{count} member{count !== 1 ? 's' : ''}</p>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1 }}>{perms[role][0]}</p>
                  </div>
                )
              })}

              <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 12, color: 'var(--warning)' }}>
                  UI-level roles do not prevent direct on-chain transactions. Treasury security requires contract-level authorization (e.g. a multisig or role-gated contract).
                </p>
              </div>
            </div>
          </CardBody>
        ) : (
          <>
            {/* Filters */}
            <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Search by name or address…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  flex: 1, minWidth: 200, background: 'var(--surface-muted)', border: '1px solid var(--border)',
                  borderRadius: 8, color: 'var(--ink)', fontSize: 13, padding: '7px 12px', outline: 'none',
                }}
              />
              {activeTab === 'invitations' && (
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--ink-2)', fontSize: 13, padding: '7px 12px', outline: 'none', cursor: 'pointer' }}
                >
                  <option value="all">All statuses</option>
                  <option value="invited">Invited</option>
                  <option value="declined">Declined</option>
                </select>
              )}
            </div>

            {/* Table */}
            {filteredMembers.length === 0 ? (
              <div style={{ padding: '0 24px' }}>
                <EmptyState
                  icon={activeTab === 'invitations' ? Clock : Users}
                  title={activeTab === 'invitations' ? 'No pending invitations' : 'No members found'}
                  description={
                    activeTab === 'invitations'
                      ? 'Invite team members using the button above.'
                      : search ? 'Try adjusting your search.' : 'Invite members to get started.'
                  }
                  action={
                    can('manage_members') && activeTab === 'members' ? (
                      <button
                        onClick={() => setShowInviteModal(true)}
                        style={{ background: 'var(--accent)', color: '#021a0e', border: 'none', borderRadius: 10, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <UserPlus size={13} /> Invite Member
                      </button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Member', 'Role', 'Status', 'Joined', ''].map(h => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map(m => (
                      <MemberRow key={m.id} member={m} onClick={() => setSelectedMember(m)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Org info card */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Organization Info</span>
          </div>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {[
              { label: 'Name', value: org.name },
              { label: 'Created by', value: formatAddr(org.createdBy) },
              { label: 'Created', value: formatDate(org.createdAt) },
              { label: 'Treasury Wallet', value: org.treasuryWallet ? formatAddr(org.treasuryWallet) : 'Not set' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</p>
                <p style={{ fontSize: 13, color: 'var(--ink-2)', fontFamily: label.includes('Wallet') || label === 'Created by' ? 'monospace' : 'inherit' }}>{value}</p>
              </div>
            ))}
          </div>
          {org.description && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Description</p>
              <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>{org.description}</p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Modals */}
      {showInviteModal && <InviteMemberModal onClose={() => setShowInviteModal(false)} />}
      {showSettings && <OrgSettings onClose={() => setShowSettings(false)} />}
      {selectedMember && <MemberDetail member={selectedMember} onClose={() => setSelectedMember(null)} />}
    </div>
  )
}
