import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import {
  ArrowUpRight, Wallet, RefreshCw, CheckSquare,
  BarChart2, Bell, BookOpen, Zap, Building2, Activity,
  List, ExternalLink,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import SectionCard from '../components/ui/SectionCard'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import { AUTOMATION_REGISTRY_CHAIN_ID, AUTOMATION_REGISTRY_ADDRESS, formatAddress } from '../lib/contract'
import { useAutomationCount } from '../hooks/useAutomations'
import { getUsdc } from '../onchain-facts'
import { Amount, usdcDecimalsFor } from '../onchain-money'
import type { Page } from '../App'

interface DashboardProps {
  onNavigate: (page: Page) => void
}

// Demo activity — clearly labeled
const DEMO_ACTIVITY = [
  { type: 'Payroll', description: 'September Payroll Batch', amount: '24,300', date: 'Oct 19, 2026', status: 'completed' as const },
  { type: 'Vendor', description: 'Arc Infrastructure Services', amount: '8,750', date: 'Oct 18, 2026', status: 'completed' as const },
  { type: 'Recurring', description: 'Monthly SaaS Subscription', amount: '4,200', date: 'Oct 17, 2026', status: 'completed' as const },
  { type: 'Deposit', description: 'USDC Treasury Deposit', amount: '100,000', date: 'Oct 16, 2026', status: 'pending' as const },
]

const FEATURE_CARDS: { page: Page; label: string; desc: string; icon: React.ReactNode }[] = [
  { page: 'payroll',       label: 'Payroll',            desc: 'Batch USDC payroll execution',        icon: <Wallet size={18} /> },
  { page: 'recurring',     label: 'Recurring Payments', desc: 'Scheduled payment management',        icon: <RefreshCw size={18} /> },
  { page: 'approvals',     label: 'Approvals',          desc: 'Multi-party treasury authorization',  icon: <CheckSquare size={18} /> },
  { page: 'automations',   label: 'Automations',        desc: 'On-chain automation registry',        icon: <Zap size={18} /> },
  { page: 'organization',  label: 'Team & Roles',       desc: 'Organisation and role management',    icon: <Building2 size={18} /> },
  { page: 'analytics',     label: 'Analytics',          desc: 'Treasury reporting and CSV export',   icon: <BarChart2 size={18} /> },
  { page: 'activity',      label: 'Activity',           desc: 'Transaction activity feed',           icon: <Activity size={18} /> },
  { page: 'transactions',  label: 'Transactions',       desc: 'Full transaction history',            icon: <List size={18} /> },
  { page: 'notifications', label: 'Notifications',      desc: 'Alerts and system events',            icon: <Bell size={18} /> },
  { page: 'audit',         label: 'Audit Log',          desc: 'Immutable application event record',  icon: <BookOpen size={18} /> },
]

export default function Dashboard({ onNavigate }: DashboardProps) {
  const { address, isConnected } = useAccount()
  const chainId = AUTOMATION_REGISTRY_CHAIN_ID
  const usdcFact = getUsdc(chainId)

  const { data: usdcBalance, isLoading: balanceLoading } = useReadContract({
    address: usdcFact?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: !!address && !!usdcFact },
  })

  const { data: automationCountRaw, isLoading: countLoading } = useAutomationCount()
  const automationCount = automationCountRaw !== undefined ? Number(automationCountRaw) : null

  const formattedBalance = usdcBalance != null
    ? Amount.fromRaw(usdcBalance, usdcDecimalsFor(chainId)).toFixed(2)
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <PageHeader
        eyebrow="Programmable USDC Treasury"
        title="Dashboard"
        subtitle="Your treasury overview on Arc Mainnet."
      />

      {/* Hero: balance + network */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {/* Treasury Balance */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(53,217,139,0.1) 0%, rgba(7,13,20,0.95) 55%)',
            border: '1px solid var(--accent-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px 26px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 180,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--accent)' }}>
            Treasury Balance
          </div>
          {!isConnected ? (
            <>
              <div className="display" style={{ fontSize: 38, fontWeight: 700, color: 'var(--subtle)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>—</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Connect wallet to view live balance</div>
            </>
          ) : balanceLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Spinner size={18} />
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Loading balance…</span>
            </div>
          ) : (
            <>
              <div className="display" style={{ fontSize: 38, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                ${formattedBalance ?? '0.00'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>USDC · Arc Mainnet</div>
            </>
          )}
          {isConnected && address && (
            <div className="mono" style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 'auto' }}>
              {formatAddress(address)}
            </div>
          )}
        </div>

        {/* Network Status */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px 26px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 180,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)' }}>
            Network Status
          </div>
          <div className="display" style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>
            Operational
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Arc Mainnet · USDC native gas</div>
          <div style={{ marginTop: 'auto', fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
            <span>Registry contract</span>
            <a
              href={`https://explorer.arc.io/address/${AUTOMATION_REGISTRY_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600 }}
            >
              {formatAddress(AUTOMATION_REGISTRY_ADDRESS)}
              <ExternalLink size={10} />
            </a>
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        <StatCard
          label="On-Chain Automations"
          value={!isConnected ? '—' : countLoading ? null : String(automationCount ?? 0)}
          note="Registry total"
          accent
        />
        <StatCard
          label="Avg Gas Fee"
          value="< $0.01"
          note="USDC · Arc Mainnet"
        />
        <StatCard
          label="Settlement Network"
          value="Arc"
          note="EVM · Chain 5042"
        />
        <StatCard
          label="Pending Payments"
          value="—"
          note="Keeper service required"
        />
      </div>

      {/* Recent Activity */}
      <SectionCard
        title="Recent Activity"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 9px',
                borderRadius: 6,
                background: 'var(--warning-dim)',
                color: 'var(--warning)',
                border: '1px solid var(--warning-border)',
              }}
            >
              Demo data
            </span>
            <button
              onClick={() => onNavigate('activity')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                padding: 0,
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              View all <ArrowUpRight size={13} />
            </button>
          </div>
        }
      >
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Amount (USDC)</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_ACTIVITY.map((row, i) => (
              <tr key={i}>
                <td>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{row.type}</span>
                </td>
                <td style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.description}</td>
                <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--ink)' }}>
                  ${row.amount}
                </td>
                <td className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>{row.date}</td>
                <td>
                  <Badge variant={row.status === 'completed' ? 'success' : 'warning'}>
                    {row.status === 'completed' ? 'Completed' : 'Pending'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* Feature navigation grid */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 14 }}>
          Treasury Features
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {FEATURE_CARDS.map(({ page, label, desc, icon }) => (
            <button
              key={page}
              onClick={() => onNavigate(page)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '16px 18px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--surface-hover)'
                e.currentTarget.style.borderColor = 'var(--border-strong)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--surface)'
                e.currentTarget.style.borderColor = 'var(--border)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--accent)', opacity: 0.85 }}>{icon}</span>
                <ArrowUpRight size={13} style={{ color: 'var(--subtle)' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Roadmap */}
      <div
        style={{
          background: 'rgba(232,184,76,0.04)',
          border: '1px solid rgba(232,184,76,0.15)',
          borderRadius: 'var(--radius)',
          padding: '16px 20px',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ color: 'var(--warning)', marginTop: 1, flexShrink: 0 }}>ℹ</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning)', marginBottom: 4 }}>Architecture Disclosures</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            Approval policies, organisation roles, and scheduling rules are enforced at the application layer only — not by an on-chain contract.
            All records are stored in browser localStorage and are not shared across devices.
            Recurring payments and scheduled payroll require manual execution; no keeper service is currently deployed.
          </div>
        </div>
      </div>
    </div>
  )
}
