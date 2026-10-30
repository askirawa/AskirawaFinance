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
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

            {/* Topbar */}
            <Topbar
              onNavigate={navigate}
              onMobileMenuToggle={() => setMobileNavOpen(o => !o)}
            />

            {/* Page content */}
            <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
              <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 28px 80px' }}>
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
              <div
                style={{
                  maxWidth: 1200,
                  margin: '0 auto',
                  padding: '16px 28px 24px',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                  color: 'var(--subtle)',
                }}
              >
                <span>AskirawaFi &copy; 2026</span>
                <span>
                  Built on{' '}
                  <a
                    href="https://arc.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', fontWeight: 600 }}
                  >
                    Arc
                  </a>
                  {' '}· USDC Programmable Treasury
                </span>
              </div>
            </main>
          </div>
        </div>
      </OrgProvider>
    </NotificationProvider>
  )
}
