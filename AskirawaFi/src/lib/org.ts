/**
 * AskirawaFi — Organization & Team Management
 *
 * STORAGE ARCHITECTURE NOTE:
 * There is no backend, authentication service, or on-chain organization registry
 * in the current AskirawaFi application. Organization and membership data is
 * therefore stored in browser localStorage.
 *
 * Limitations that must be understood:
 *   - localStorage is per-browser and per-origin — it is not shared across devices
 *     or users. True multi-user collaboration requires a backend database.
 *   - A typed wallet address is NOT proof of ownership. Without a wallet signature
 *     or authentication token, anyone can type any address.
 *   - Role restrictions are enforced by the UI only — they do NOT prevent direct
 *     smart-contract calls or API calls outside this app.
 *   - "Invitations" are local records only — no email or notification is sent unless
 *     a notification service is added.
 *   - Org data is associated with the CREATOR's wallet address as a local identifier.
 *
 * What is needed for production-grade org management:
 *   1. A backend with authenticated wallet-signature login (SIWE — Sign-In With Ethereum).
 *   2. A database storing organizations, memberships, roles, and invitation tokens.
 *   3. Invitation delivery (email or share-link) with server-side verification.
 *   4. Optional: an on-chain role registry contract for treasury-enforced permissions.
 */

// ─── Role model ───────────────────────────────────────────────────────────────

/**
 * Roles in ascending privilege order. Higher index = more privilege.
 * Used to prevent privilege escalation (cannot assign a role above your own).
 */
export type OrgRole = 'viewer' | 'finance_manager' | 'approver' | 'admin' | 'owner'

export const ROLE_ORDER: OrgRole[] = ['viewer', 'finance_manager', 'approver', 'admin', 'owner']

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  finance_manager: 'Finance Manager',
  approver: 'Approver',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: 'Full control: settings, members, treasury policies.',
  admin: 'Manage members and operations within owner-granted scope.',
  finance_manager: 'Create payroll, recurring payments, and submit transfer requests.',
  approver: 'Review and approve or reject treasury requests.',
  viewer: 'Read-only access to permitted information.',
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export type Permission =
  | 'manage_org_settings'
  | 'manage_members'
  | 'assign_roles'
  | 'configure_treasury_policy'
  | 'create_payroll'
  | 'execute_payroll'
  | 'create_recurring'
  | 'modify_recurring'
  | 'submit_transfer'
  | 'approve_requests'
  | 'execute_approved'
  | 'view_treasury'
  | 'view_members'
  | 'view_payroll'
  | 'view_recurring'
  | 'view_approvals'

const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  owner: [
    'manage_org_settings', 'manage_members', 'assign_roles', 'configure_treasury_policy',
    'create_payroll', 'execute_payroll', 'create_recurring', 'modify_recurring',
    'submit_transfer', 'approve_requests', 'execute_approved',
    'view_treasury', 'view_members', 'view_payroll', 'view_recurring', 'view_approvals',
  ],
  admin: [
    'manage_members', 'assign_roles',
    'create_payroll', 'execute_payroll', 'create_recurring', 'modify_recurring',
    'submit_transfer', 'approve_requests', 'execute_approved',
    'view_treasury', 'view_members', 'view_payroll', 'view_recurring', 'view_approvals',
  ],
  finance_manager: [
    'create_payroll', 'execute_payroll', 'create_recurring', 'modify_recurring',
    'submit_transfer',
    'view_treasury', 'view_members', 'view_payroll', 'view_recurring', 'view_approvals',
  ],
  approver: [
    'approve_requests',
    'view_treasury', 'view_members', 'view_payroll', 'view_recurring', 'view_approvals',
  ],
  viewer: [
    'view_treasury', 'view_members', 'view_payroll', 'view_recurring', 'view_approvals',
  ],
}

export function hasPermission(role: OrgRole | null | undefined, permission: Permission): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role].includes(permission)
}

/** Can `actorRole` assign `targetRole` to another member? */
export function canAssignRole(actorRole: OrgRole, targetRole: OrgRole): boolean {
  const actorIdx = ROLE_ORDER.indexOf(actorRole)
  const targetIdx = ROLE_ORDER.indexOf(targetRole)
  // Can only assign roles strictly below your own, or the same role (admin can give admin)
  // Owner can assign any role including owner
  if (actorRole === 'owner') return true
  return actorIdx > targetIdx
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemberStatus = 'active' | 'invited' | 'declined' | 'removed'

export interface OrgMember {
  id: string
  walletAddress: string       // lowercase
  displayName?: string        // optional friendly name
  role: OrgRole
  status: MemberStatus
  invitedBy?: string          // wallet address of inviter
  invitedAt: number           // unix ms
  joinedAt?: number           // unix ms — set when status becomes 'active'
  removedAt?: number
  note?: string               // optional invite note
}

export interface Organization {
  id: string
  name: string
  description: string
  treasuryWallet?: string     // the primary wallet address for the org treasury
  createdBy: string           // wallet address of creator (first owner)
  createdAt: number           // unix ms
  updatedAt: number
  members: OrgMember[]
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const ORG_STORAGE_KEY = 'askirawafi_org_v1'

export function loadOrg(): Organization | null {
  try {
    const raw = localStorage.getItem(ORG_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Organization
  } catch {
    return null
  }
}

export function saveOrg(org: Organization): void {
  org.updatedAt = Date.now()
  localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(org))
}

export function clearOrg(): void {
  localStorage.removeItem(ORG_STORAGE_KEY)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generateOrgId(): string {
  return `org-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function generateMemberId(): string {
  return `mbr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase()
}

export function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim())
}

export function formatAddr(addr: string, len = 6): string {
  if (!addr) return '—'
  return `${addr.slice(0, len)}…${addr.slice(-4)}`
}

export function formatTs(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

/** Find the role of a wallet in an org; returns null if not a member or not active. */
export function getMemberRole(org: Organization | null, walletAddress: string): OrgRole | null {
  if (!org || !walletAddress) return null
  const lower = walletAddress.toLowerCase()
  const member = org.members.find(
    m => m.walletAddress === lower && m.status === 'active'
  )
  return member?.role ?? null
}

/** Count active members with a given role. */
export function countByRole(org: Organization, role: OrgRole): number {
  return org.members.filter(m => m.role === role && m.status === 'active').length
}

/** Prevent removing the last owner. */
export function canRemoveMember(org: Organization, memberId: string): boolean {
  const member = org.members.find(m => m.id === memberId)
  if (!member) return false
  if (member.role === 'owner') {
    return countByRole(org, 'owner') > 1
  }
  return true
}

/** Prevent demoting the last owner. */
export function canChangeRole(org: Organization, memberId: string, newRole: OrgRole): boolean {
  const member = org.members.find(m => m.id === memberId)
  if (!member) return false
  if (member.role === 'owner' && newRole !== 'owner') {
    return countByRole(org, 'owner') > 1
  }
  return true
}

// ─── Derived stats ────────────────────────────────────────────────────────────

export interface OrgStats {
  totalMembers: number
  activeMembers: number
  pendingInvitations: number
  owners: number
  admins: number
  financeManagers: number
  approvers: number
  viewers: number
}

export function getOrgStats(org: Organization): OrgStats {
  const active = org.members.filter(m => m.status === 'active')
  return {
    totalMembers: active.length,
    activeMembers: active.length,
    pendingInvitations: org.members.filter(m => m.status === 'invited').length,
    owners: active.filter(m => m.role === 'owner').length,
    admins: active.filter(m => m.role === 'admin').length,
    financeManagers: active.filter(m => m.role === 'finance_manager').length,
    approvers: active.filter(m => m.role === 'approver').length,
    viewers: active.filter(m => m.role === 'viewer').length,
  }
}

// ─── Role badge variant ────────────────────────────────────────────────────────

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'active'

export function roleVariant(role: OrgRole): BadgeVariant {
  if (role === 'owner') return 'warning'
  if (role === 'admin') return 'active'
  if (role === 'finance_manager') return 'success'
  if (role === 'approver') return 'neutral'
  return 'neutral'
}

export function memberStatusVariant(status: MemberStatus): BadgeVariant {
  if (status === 'active') return 'success'
  if (status === 'invited') return 'warning'
  if (status === 'declined') return 'danger'
  return 'neutral'
}

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: 'Active',
  invited: 'Invited',
  declined: 'Declined',
  removed: 'Removed',
}
