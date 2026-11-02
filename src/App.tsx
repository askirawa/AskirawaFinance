import { useState } from 'react'
import Sidebar from './components/layout/Sidebar'
import Topbar from './components/layout/Topbar'
import MobileNav from './components/layout/MobileNav'
import { NetworkBanner } from './components/flow/shared'
import PendingTxBanner from './components/flow/PendingTxBanner'
import Dashboard from './pages/Dashboard'
import Payroll from './pages/Payroll'
import RecurringPayments from './pages/RecurringPayments'
import Approvals from './pages/Approvals'
import Team from './pages/Team'
import Activity from './pages/Activity'
import Settings from './pages/Settings'
import ComingSoon from './pages/ComingSoon'
import Governance from './pages/Governance'
import Automations from './pages/Automations'
import type { NavOpts, Page } from './nav'

export type { Page } from './nav'

/**
 * App shell. Company journey: Connect Wallet -> Create Payment -> Review -> Request Approval ->
 * On-chain Approval -> Execute -> Track. Every page reads the treasury contract; nothing here keeps
 * its own copy of balances, approvals or payments.
 */
export default function App() {
  const [activePage, setActivePage] = useState<Page>('dashboard')
  const [opts, setOpts] = useState<NavOpts>({})
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  function navigate(page: Page, next: NavOpts = {}) {
    setActivePage(page)
    setOpts(next)
    setMobileNavOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--bg)' }}>
      <div className="hidden lg:flex">
        <Sidebar activePage={activePage} onNavigate={navigate} />
      </div>

      {mobileNavOpen && (
        <MobileNav activePage={activePage} onNavigate={navigate} onClose={() => setMobileNavOpen(false)} />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflowX: 'clip' }}>
        <Topbar
          activePage={activePage}
          onMobileMenuToggle={() => setMobileNavOpen((o) => !o)}
          mobileMenuOpen={mobileNavOpen}
        />

        <main style={{ flex: 1, minWidth: 0 }}>
          <div className="app-content">
            <NetworkBanner />
            <PendingTxBanner />
            {activePage === 'dashboard' && <Dashboard onNavigate={navigate} />}
            {activePage === 'payroll' && <Payroll onNavigate={navigate} startCreating={!!opts.create} />}
            {activePage === 'recurring' && <RecurringPayments onNavigate={navigate} startCreating={!!opts.create} />}
            {activePage === 'approvals' && <Approvals focusRequestId={opts.requestId} />}
            {activePage === 'team' && <Team />}
            {activePage === 'activity' && <Activity onNavigate={navigate} />}
            {activePage === 'settings' && <Settings onNavigate={navigate} />}
            {activePage === 'governance' && <Governance />}
            {activePage === 'automations' && <Automations />}
            {(activePage === 'escrow' || activePage === 'vesting') && <ComingSoon kind={activePage} onNavigate={navigate} />}
          </div>

          <div className="app-footer">
            <span className="footer-note">Askirawa Finance</span>
            <span className="footer-note">
              Built on{' '}
              <a href="https://arc.io" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--muted)', fontWeight: 600 }}>
                Arc
              </a>{' '}
              · USDC Treasury
            </span>
          </div>
        </main>
      </div>
    </div>
  )
}
