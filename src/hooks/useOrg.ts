/**
 * useOrg — Organization and Team Management hooks.
 *
 * All data is localStorage-backed (per-browser). See src/lib/org.ts for
 * the full architecture note about what this means for security and
 * multi-user collaboration.
 *
 * Notification and audit callbacks are injected by callers to avoid circular deps.
 */

import { useState, useCallback, useMemo } from 'react'
import { useAccount } from 'wagmi'
import {
  type Organization,
  type OrgMember,
  type OrgRole,
  type Permission,
  loadOrg,
  saveOrg,
  clearOrg,
  generateOrgId,
  generateMemberId,
  normalizeAddress,
  getMemberRole,
  canRemoveMember,
  canChangeRole,
  hasPermission,
  getOrgStats,
  countByRole,
} from '../lib/org'
import { Notify, type AppNotification } from '../lib/notifications'
import { logAuditEvent, type AuditEntry } from '../lib/audit'

export type NotifyFn = (n: AppNotification) => void
export type AuditFn = (fields: Omit<AuditEntry, 'id' | 'timestamp'>) => void

// ─── Primary org hook ─────────────────────────────────────────────────────────

export function useOrganization(opts?: { onNotify?: NotifyFn }) {
  const { address } = useAccount()
  const [org, setOrgState] = useState<Organization | null>(loadOrg)

  const persist = useCallback((next: Organization | null) => {
    setOrgState(next)
    if (next) saveOrg(next)
    else clearOrg()
  }, [])

  const myAddress = address ? normalizeAddress(address) : null
  const myRole = useMemo(() => getMemberRole(org, myAddress ?? ''), [org, myAddress])

  const can = useCallback(
    (permission: Permission) => hasPermission(myRole, permission),
    [myRole]
  )

  // ─── Create org ─────────────────────────────────────────────────────────────

  function createOrg(name: string, description: string): Organization {
    if (!myAddress) throw new Error('Connect your wallet to create an organization.')
    const now = Date.now()
    const firstMember: OrgMember = {
      id: generateMemberId(),
      walletAddress: myAddress,
      role: 'owner',
      status: 'active',
      invitedAt: now,
      joinedAt: now,
    }
    const newOrg: Organization = {
      id: generateOrgId(),
      name: name.trim(),
      description: description.trim(),
      treasuryWallet: myAddress,
      createdBy: myAddress,
      createdAt: now,
      updatedAt: now,
      members: [firstMember],
    }
    persist(newOrg)

    const n = Notify.orgCreated(newOrg.id, newOrg.name)
    opts?.onNotify?.(n)
    logAuditEvent({
      category: 'organization',
      action: 'org_created',
      actorAddress: myAddress,
      description: `Organization "${newOrg.name}" created. Owner: ${myAddress.slice(0, 8)}….`,
      outcome: 'success',
      entityId: newOrg.id,
      entityLabel: newOrg.name,
    })

    return newOrg
  }

  // ─── Update org settings ─────────────────────────────────────────────────────

  function updateOrgSettings(updates: Partial<Pick<Organization, 'name' | 'description' | 'treasuryWallet'>>) {
    if (!org) throw new Error('No organization was found. Create one first and try again.')
    const updated = { ...org, ...updates, updatedAt: Date.now() }
    persist(updated)

    const n = Notify.orgUpdated(org.id, updated.name)
    opts?.onNotify?.(n)
    logAuditEvent({
      category: 'organization',
      action: 'org_updated',
      actorAddress: myAddress,
      description: `Organization "${updated.name}" settings updated.`,
      outcome: 'info',
      entityId: org.id,
      entityLabel: updated.name,
    })
  }

  // ─── Invite member ───────────────────────────────────────────────────────────

  function inviteMember(walletAddress: string, role: OrgRole, displayName?: string, note?: string): string {
    if (!org) throw new Error('No organization was found. Create one first and try again.')
    if (!myAddress) throw new Error('Connect your wallet to continue.')
    const lower = normalizeAddress(walletAddress)
    const existing = org.members.find(m => m.walletAddress === lower && m.status !== 'removed')
    if (existing) throw new Error('This wallet address is already on your team or has a pending invitation.')

    const now = Date.now()
    const newMember: OrgMember = {
      id: generateMemberId(),
      walletAddress: lower,
      displayName: displayName?.trim() || undefined,
      role,
      status: 'invited',
      invitedBy: myAddress,
      invitedAt: now,
      note: note?.trim() || undefined,
    }
    const updated: Organization = {
      ...org,
      members: [...org.members, newMember],
    }
    persist(updated)

    const n = Notify.memberInvited(org.id, org.name, lower)
    opts?.onNotify?.(n)
    logAuditEvent({
      category: 'organization',
      action: 'member_invited',
      actorAddress: myAddress,
      description: `${lower.slice(0, 8)}… invited to "${org.name}" as ${role}. (Saved in this browser only — no email sent.)`,
      outcome: 'info',
      entityId: org.id,
      entityLabel: org.name,
      meta: { invitedAddress: lower, role },
    })

    return newMember.id
  }

  // ─── Accept invitation ────────────────────────────────────────────────────────

  function acceptInvitation(): void {
    if (!org || !myAddress) return
    const updated: Organization = {
      ...org,
      members: org.members.map(m =>
        m.walletAddress === myAddress && m.status === 'invited'
          ? { ...m, status: 'active' as const, joinedAt: Date.now() }
          : m
      ),
    }
    persist(updated)

    const n = Notify.memberAccepted(org.id, org.name, myAddress)
    opts?.onNotify?.(n)
    logAuditEvent({
      category: 'organization',
      action: 'member_accepted',
      actorAddress: myAddress,
      description: `${myAddress.slice(0, 8)}… accepted invitation to "${org.name}".`,
      outcome: 'success',
      entityId: org.id,
      entityLabel: org.name,
    })
  }

  // ─── Decline invitation ──────────────────────────────────────────────────────

  function declineInvitation(): void {
    if (!org || !myAddress) return
    const updated: Organization = {
      ...org,
      members: org.members.map(m =>
        m.walletAddress === myAddress && m.status === 'invited'
          ? { ...m, status: 'declined' as const }
          : m
      ),
    }
    persist(updated)

    const n = Notify.memberDeclined(org.id, org.name, myAddress)
    opts?.onNotify?.(n)
    logAuditEvent({
      category: 'organization',
      action: 'member_declined',
      actorAddress: myAddress,
      description: `${myAddress.slice(0, 8)}… declined invitation to "${org.name}".`,
      outcome: 'info',
      entityId: org.id,
      entityLabel: org.name,
    })
  }

  // ─── Change member role ───────────────────────────────────────────────────────

  function changeMemberRole(memberId: string, newRole: OrgRole): void {
    if (!org) throw new Error('No organization was found. Create one first and try again.')
    if (!canChangeRole(org, memberId, newRole)) {
      throw new Error('This would leave the team with no Owner. Make someone else an Owner first.')
    }
    const member = org.members.find(m => m.id === memberId)
    const updated: Organization = {
      ...org,
      members: org.members.map(m =>
        m.id === memberId ? { ...m, role: newRole } : m
      ),
    }
    persist(updated)

    if (member) {
      const n = Notify.memberRoleChanged(org.id, org.name, member.walletAddress, newRole)
      opts?.onNotify?.(n)
      logAuditEvent({
        category: 'organization',
        action: 'member_role_changed',
        actorAddress: myAddress,
        description: `${member.walletAddress.slice(0, 8)}…'s role in "${org.name}" changed to ${newRole}.`,
        outcome: 'info',
        entityId: org.id,
        entityLabel: org.name,
        meta: { memberAddress: member.walletAddress, newRole },
      })
    }
  }

  // ─── Remove member ────────────────────────────────────────────────────────────

  function removeMember(memberId: string): void {
    if (!org) throw new Error('No organization was found. Create one first and try again.')
    if (!canRemoveMember(org, memberId)) {
      throw new Error('This is the last Owner and cannot be removed. Make someone else an Owner first.')
    }
    const member = org.members.find(m => m.id === memberId)
    const updated: Organization = {
      ...org,
      members: org.members.map(m =>
        m.id === memberId ? { ...m, status: 'removed' as const, removedAt: Date.now() } : m
      ),
    }
    persist(updated)

    if (member) {
      const n = Notify.memberRemoved(org.id, org.name, member.walletAddress)
      opts?.onNotify?.(n)
      logAuditEvent({
        category: 'organization',
        action: 'member_removed',
        actorAddress: myAddress,
        description: `${member.walletAddress.slice(0, 8)}… removed from "${org.name}".`,
        outcome: 'info',
        entityId: org.id,
        entityLabel: org.name,
        meta: { memberAddress: member.walletAddress },
      })
    }
  }

  // ─── Delete org ───────────────────────────────────────────────────────────────

  function deleteOrg(): void {
    if (org) {
      logAuditEvent({
        category: 'organization',
        action: 'org_deleted',
        actorAddress: myAddress,
        description: `Organization "${org.name}" deleted.`,
        outcome: 'info',
        entityId: org.id,
        entityLabel: org.name,
      })
    }
    persist(null)
  }

  // ─── Derived ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => (org ? getOrgStats(org) : null), [org])
  const ownerCount = org ? countByRole(org, 'owner') : 0

  const myPendingInvite = useMemo(() => {
    if (!org || !myAddress) return null
    return org.members.find(m => m.walletAddress === myAddress && m.status === 'invited') ?? null
  }, [org, myAddress])

  const activeMembers = useMemo(
    () => (org?.members.filter(m => m.status === 'active') ?? []),
    [org]
  )

  return {
    org,
    myRole,
    myAddress,
    myPendingInvite,
    activeMembers,
    stats,
    ownerCount,
    can,
    createOrg,
    updateOrgSettings,
    inviteMember,
    acceptInvitation,
    declineInvitation,
    changeMemberRole,
    removeMember,
    deleteOrg,
  }
}
