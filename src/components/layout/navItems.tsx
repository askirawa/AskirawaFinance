import {
  LayoutDashboard, Wallet, RefreshCw, CheckSquare,
  BarChart2, Bell, BookOpen, Activity, Zap, List, Building2,
} from 'lucide-react'
import type { Page } from '../../App'

export type NavItem = { id: Page; label: string; icon: React.ReactNode }
export type NavGroup = { label: string; items: NavItem[] }

const ICON = { size: 16, strokeWidth: 1.5 } as const

/** Single source of truth for desktop sidebar and mobile drawer navigation. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard {...ICON} /> }],
  },
  {
    label: 'Treasury',
    items: [
      { id: 'payroll',     label: 'Payroll',            icon: <Wallet {...ICON} /> },
      { id: 'recurring',   label: 'Recurring Payments', icon: <RefreshCw {...ICON} /> },
      { id: 'approvals',   label: 'Approvals',          icon: <CheckSquare {...ICON} /> },
      { id: 'automations', label: 'Automations',        icon: <Zap {...ICON} /> },
    ],
  },
  {
    label: 'Team',
    items: [{ id: 'organization', label: 'Team & Roles', icon: <Building2 {...ICON} /> }],
  },
  {
    label: 'Insights',
    items: [
      { id: 'analytics',    label: 'Analytics',    icon: <BarChart2 {...ICON} /> },
      { id: 'activity',     label: 'Activity',     icon: <Activity {...ICON} /> },
      { id: 'transactions', label: 'Transactions', icon: <List {...ICON} /> },
    ],
  },
  {
    label: 'Records',
    items: [
      { id: 'notifications', label: 'Notifications', icon: <Bell {...ICON} /> },
      { id: 'audit',         label: 'Audit Log',     icon: <BookOpen {...ICON} /> },
    ],
  },
]

/** Page titles shown in the top bar. */
export const PAGE_TITLES: Record<Page, string> = {
  dashboard:     'Dashboard',
  payroll:       'Payroll',
  recurring:     'Recurring Payments',
  approvals:     'Approvals',
  automations:   'Automations',
  organization:  'Team & Roles',
  analytics:     'Analytics',
  activity:      'Activity',
  transactions:  'Transactions',
  notifications: 'Notifications',
  audit:         'Audit Log',
}
