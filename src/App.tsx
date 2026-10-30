import { useState } from 'react'
import Sidebar from './components/layout/Sidebar'
import Topbar from './components/layout/Topbar'
import MobileNav from './components/layout/MobileNav'
import Dashboard from './pages/Dashboard'
import Activity from './pages/Activity'
import Automations from './pages/Automations'
import Transactions from './pages/Transactions'
import Payroll from './pages/Payroll'
import RecurringPayments from './pages/RecurringPayments'
import Approvals from './pages/Approvals'
import Organization from './pages/Organization'
import Analytics from './pages/Analytics'
import Notifications from './pages/Notifications'
import AuditLog from './pages/AuditLog'
import { OrgProvider } from './context/OrgContext'
import { NotificationProvider } from './context/NotificationContext'

export type Page =
  | 'dashboard'
  | 'activity'
  | 'automations'
  | 'transactions'
  | 'payroll'
  | 'recurring'
  | 'approvals'
  | 'organization'
  | 'analytics'
  | 'notifications'
  | 'audit'

export default function App() {
  const [activePage, setActivePage] = useState<Page>('dashboard')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  function navigate(page: Page) {
    setActivePage(page)
    setMobileNavOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <NotificationProvider>
      <OrgProvider>
        <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--bg)' }}>

          {/* Sidebar — desktop only */}
          <div className="hidden lg:flex">
            <Sidebar activePage={activePage} onNavigate={navigate} />
          </div>

          {/* Mobile nav drawer */}
          {mobileNavOpen && (
            <MobileNav
              activePage={activePage}
              onNavigate={navigate}
              onClose={() => setMobileNavOpen(false)}
            />
          )}

          {/* Main column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflowX: 'clip' }}>

            {/* Topbar */}
            <Topbar
              activePage={activePage}
              onNavigate={navigate}
              onMobileMenuToggle={() => setMobileNavOpen(o => !o)}
              mobileMenuOpen={mobileNavOpen}
            />

            {/* Page content */}
            <main style={{ flex: 1, minWidth: 0 }}>
              <div className="app-content">
                {activePage === 'dashboard'     && <Dashboard onNavigate={navigate} />}
                {activePage === 'activity'      && <Activity />}
                {activePage === 'automations'   && <Automations />}
                {activePage === 'transactions'  && <Transactions />}
                {activePage === 'payroll'       && <Payroll />}
                {activePage === 'recurring'     && <RecurringPayments />}
                {activePage === 'approvals'     && <Approvals />}
                {activePage === 'organization'  && <Organization />}
                {activePage === 'analytics'     && <Analytics />}
                {activePage === 'notifications' && <Notifications />}
                {activePage === 'audit'         && <AuditLog />}
              </div>

              {/* Footer */}
              <div className="app-footer">
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  color: 'var(--subtle)',
                }}>Askirawa Finance &copy; 2026</span>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  color: 'var(--subtle)',
                }}>
                  Built on{' '}
                  <a
                    href="https://arc.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--muted)', fontWeight: 600 }}
                  >
                    Arc
                  </a>
                  {' '}· USDC Treasury
                </span>
              </div>
            </main>
          </div>
        </div>
      </OrgProvider>
    </NotificationProvider>
  )
}
