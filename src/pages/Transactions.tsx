import { Receipt, Info } from 'lucide-react'
import SectionCard from '../components/ui/SectionCard'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'

// Demo data — clearly labeled
const DEMO_TRANSACTIONS = [
  { id: 1, name: 'August Payroll', network: 'Arc', amount: '18,450', date: 'Oct 18, 2026', status: 'completed' as const },
  { id: 2, name: 'Vendor Settlement', network: 'Arc', amount: '7,250', date: 'Oct 18, 2026', status: 'completed' as const },
  { id: 3, name: 'Operations Reserve', network: 'Arc', amount: '3,800', date: 'Oct 17, 2026', status: 'pending' as const },
  { id: 4, name: 'Treasury Deposit', network: 'Arc', amount: '50,000', date: 'Oct 17, 2026', status: 'completed' as const },
  { id: 5, name: 'July Payroll', network: 'Arc', amount: '18,450', date: 'Sep 30, 2026', status: 'completed' as const },
]

export default function Transactions() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Treasury"
        title="Transactions"
        subtitle="Review payments, deposits and settlements made through Askirawa Finance."
      />

      {/* Demo notice */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '10px 14px', fontSize: 12,
          background: 'var(--warning-dim)', border: '1px solid var(--warning-border)', color: 'var(--warning)',
        }}
      >
        <Info size={13} style={{ marginTop: 1, flexShrink: 0 }} />
        <span style={{ minWidth: 0 }}>
          The transactions below are sample data, not your real payments. Live transaction history from Arc is not connected yet.
        </span>
      </div>

      <SectionCard
        title="Transaction history"
        actions={
          <span style={{ fontSize: 11, padding: '3px 9px', background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning-border)', fontWeight: 600 }}>
            Sample data
          </span>
        }
      >
        {DEMO_TRANSACTIONS.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No transactions yet"
            description="Transactions will appear here once live history is connected."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Network</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_TRANSACTIONS.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{row.name}</td>
                    <td>{row.network}</td>
                    <td className="mono" style={{ color: 'var(--ink)', fontWeight: 600 }}>{row.amount} USDC</td>
                    <td>{row.date}</td>
                    <td>
                      <Badge variant={row.status === 'completed' ? 'success' : 'warning'}>
                        {row.status === 'completed' ? 'Completed' : 'Pending'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Roadmap */}
      <div style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', padding: '18px 22px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>
          Not available yet
        </div>
        <div className="display" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 14 }}>Planned: live transaction feed</div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' }}>
          {[
            { title: 'Full history from Arc', desc: 'Show every automation and payment recorded on Arc.' },
            { title: 'USDC transfer tracking', desc: 'Follow each USDC transfer with a link to Arc Explorer.' },
            { title: 'Cross-chain settlement', desc: 'Records of USDC moved between blockchains.' },
          ].map(({ title, desc }) => (
            <div key={title} style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>{title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
