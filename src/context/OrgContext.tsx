/**
 * OrgContext — app-wide organization and role state.
 *
 * Provides the current organization and the connected wallet's role
 * to any component in the tree without prop-drilling.
 *
 * Usage:
 *   import { useOrgContext } from '../context/OrgContext'
 *   const { org, myRole, can } = useOrgContext()
 */

import { createContext, useContext, type ReactNode } from 'react'
import { useOrganization } from '../hooks/useOrg'
import type { OrgRole, Permission, Organization, OrgMember } from '../lib/org'
import { useNotifications } from './NotificationContext'

interface OrgContextValue {
  org: Organization | null
  myRole: OrgRole | null
  myAddress: string | null
  myPendingInvite: OrgMember | null
  activeMembers: OrgMember[]
  stats: ReturnType<typeof useOrganization>['stats']
  ownerCount: number
  can: (permission: Permission) => boolean
  createOrg: ReturnType<typeof useOrganization>['createOrg']
  updateOrgSettings: ReturnType<typeof useOrganization>['updateOrgSettings']
  inviteMember: ReturnType<typeof useOrganization>['inviteMember']
  acceptInvitation: ReturnType<typeof useOrganization>['acceptInvitation']
  declineInvitation: ReturnType<typeof useOrganization>['declineInvitation']
  changeMemberRole: ReturnType<typeof useOrganization>['changeMemberRole']
  removeMember: ReturnType<typeof useOrganization>['removeMember']
  deleteOrg: ReturnType<typeof useOrganization>['deleteOrg']
}

const OrgContext = createContext<OrgContextValue | null>(null)

export function OrgProvider({ children }: { children: ReactNode }) {
  const { emit } = useNotifications()
  const orgState = useOrganization({ onNotify: emit })
  return <OrgContext.Provider value={orgState}>{children}</OrgContext.Provider>
}

export function useOrgContext(): OrgContextValue {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrgContext must be used inside OrgProvider')
  return ctx
}
