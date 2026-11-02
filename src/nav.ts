/** Navigation vocabulary shared by the shell and every page. */
export type Page = 'dashboard' | 'payroll' | 'recurring' | 'approvals' | 'team' | 'activity' | 'settings' | 'escrow' | 'vesting' | 'governance' | 'automations'

export interface NavOpts {
  /** Open the Approvals page focused on this request number. */
  requestId?: number
  /** Open Payroll or Recurring Payments straight into the creation flow. */
  create?: boolean
}

export type Navigate = (page: Page, opts?: NavOpts) => void

/** Page ids of the retired localStorage-era screens. Kept only so the old, now unused components still compile. */
export type LegacyPage = Page | 'transactions' | 'analytics' | 'notifications' | 'audit' | 'organization'
