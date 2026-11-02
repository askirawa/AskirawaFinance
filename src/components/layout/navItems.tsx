import { LayoutDashboard, Wallet, RefreshCw, CheckSquare, Users, Activity, Settings, Lock, Hourglass, Landmark } from 'lucide-react'
import type { Page } from '../../nav'

export type NavItem = { id: Page; label: string; icon: React.ReactNode; /** Not available yet: shown with a "Soon" tag. */ soon?: boolean }
export type NavGroup = { label: string; items: NavItem[] }

const ICON = { size: 16, strokeWidth: 1.5 } as const

/** Single source of truth for desktop sidebar and mobile drawer navigation. Icons are white via .feature-icon. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard {...ICON} /> }],
  },
  {
    label: 'Payments',
    items: [
      { id: 'payroll', label: 'Payroll', icon: <Wallet {...ICON} /> },
      { id: 'recurring', label: 'Recurring Payments', icon: <RefreshCw {...ICON} /> },
      { id: 'approvals', label: 'Approvals', icon: <CheckSquare {...ICON} /> },
    ],
  },
  {
    label: 'Coming soon',
    items: [
      { id: 'escrow', label: 'Escrow', icon: <Lock {...ICON} />, soon: true },
      { id: 'vesting', label: 'Vesting', icon: <Hourglass {...ICON} />, soon: true },
    ],
  },
  {
    label: 'Company',
    items: [
      { id: 'team', label: 'Team', icon: <Users {...ICON} /> },
      { id: 'governance', label: 'Governance', icon: <Landmark {...ICON} /> },
      { id: 'activity', label: 'Activity', icon: <Activity {...ICON} /> },
      { id: 'settings', label: 'Settings', icon: <Settings {...ICON} /> },
    ],
  },
]

/** Page titles shown in the top bar. */
export const PAGE_TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  payroll: 'Payroll',
  recurring: 'Recurring Payments',
  approvals: 'Approvals',
  team: 'Team',
  activity: 'Activity',
  settings: 'Settings',
  escrow: 'Escrow',
  vesting: 'Vesting',
  governance: 'Governance',
  automations: 'Legacy registry',
}
