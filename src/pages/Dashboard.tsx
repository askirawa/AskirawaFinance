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
  { type: 'Payroll',   description: 'September Payroll Batch',      amount: '24,300', date: 'Oct 19, 2026', status: 'completed' as const },
  { type: 'Vendor',    description: 'Arc Infrastructure Services',   amount: '8,750',  date: 'Oct 18, 2026', status: 'completed' as const },
  { type: 'Recurring', description: 'Monthly SaaS Subscription',    amount: '4,200',  date: 'Oct 17, 2026', status: 'completed' as const },
  { type: 'Deposit',   description: 'USDC Treasury Deposit',        amount: '100,000',date: 'Oct 16, 2026', status: 'pending'   as const },
]

const FEATURE_CARDS: { page: Page; label: string; desc: string; icon: React.ReactNode }[] = [
  { page: 'payroll',       label: 'Payroll',            desc: 'Pay many people in one go',        icon: <Wallet size={14} strokeWidth={1.5} /> },
  { page: 'recurring',     label: 'Recurring Payments', desc: 'Payments that repeat on a schedule',        icon: <RefreshCw size={14} strokeWidth={1.5} /> },
  { page: 'approvals',     label: 'Approvals',          desc: 'Get sign-off before money moves',  icon: <CheckSquare size={14} strokeWidth={1.5} /> },
  { page: 'automations',   label: 'Automations',        desc: 'Automated tasks registered on Arc',        icon: <Zap size={14} strokeWidth={1.5} /> },
  { page: 'organization',  label: 'Team & Roles',       desc: 'Manage your team and who can do what',    icon: <Building2 size={14} strokeWidth={1.5} /> },
  { page: 'analytics',     label: 'Analytics',          desc: 'Reports and CSV downloads',   icon: <BarChart2 size={14} strokeWidth={1.5} /> },
  { page: 'activity',      label: 'Activity',           desc: 'Latest payment activity',           icon: <Activity size={14} strokeWidth={1.5} /> },
  { page: 'transactions',  label: 'Transactions',       desc: 'Every payment, in full',            icon: <List size={14} strokeWidth={1.5} /> },
  { page: 'notifications', label: 'Notifications',      desc: 'Alerts and updates',            icon: <Bell size={14} strokeWidth={1.5} /> },
  { page: 'audit',         label: 'Audit Log',          desc: 'A record of changes made in this app',  icon: <BookOpen size={14} strokeWidth={1.5} /> },
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>

      <PageHeader
        eyebrow="Programmable USDC Treasury built on Arc"
        title="Dashboard"
        subtitle="Your USDC balance and recent activity."
      />

      {/* Hero row: balance (light card) + network status */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' }}>

        {/* Hero balance card — light gradient */}
        <div style={{
          background: 'linear-gradient(135deg, #F2F2F2 0%, #E0E0E0 100%)',
          border: '1px solid #CCCCCC',
          clipPath: 'polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%)',
          padding: '28px 28px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 200,
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#6B6B6B',
          }}>
            Wallet balance (USDC)
          </div>

          {!isConnected ? (
            <>
              <div style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 44,
                fontWeight: 700,
                color: '#AAAAAA',
                letterSpacing: '-0.04em',
                lineHeight: 1.0,
                fontVariantNumeric: 'tabular-nums',
              }}>—</div>
              <div style={{ fontSize: 13, color: '#888888', marginTop: 4 }}>Connect your wallet to see your balance</div>
            </>
          ) : balanceLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Spinner size={18} />
              <span style={{ fontSize: 13, color: '#888888' }}>Loading…</span>
            </div>
          ) : (
            <>
              <div style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 44,
                fontWeight: 700,
                color: '#111111',
                letterSpacing: '-0.04em',
                lineHeight: 1.0,
                fontVariantNumeric: 'tabular-nums',
              }}>
                ${formattedBalance ?? '0.00'}
              </div>
              <div style={{ fontSize: 13, color: '#666666' }}>USDC on Arc Mainnet</div>
            </>
          )}

          {isConnected && address && (
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: '#888888',
              marginTop: 'auto',
              letterSpacing: '0.04em',
            }}>
              {formatAddress(address)}
            </div>
          )}

          {/* Primary action */}
          <button
            onClick={() => onNavigate('payroll')}
            style={{
              marginTop: 8,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px',
              height: 44,
              background: '#1C1C1C',
              color: '#FFFFFF',
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 0,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#333333' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#1C1C1C' }}
          >
            <span>New payment</span>
            <ArrowUpRight size={13} strokeWidth={1.5} style={{ marginLeft: 8 }} />
          </button>
        </div>

        {/* Network status — dark card */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          padding: '28px 28px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 200,
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--subtle)',
          }}>
            Network status
          </div>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 32,
            fontWeight: 700,
            color: 'var(--ink)',
            letterSpacing: '-0.03em',
            lineHeight: 1.0,
          }}>
            Operational
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Arc Mainnet. Network fees are paid in USDC.</div>
          <div style={{ marginTop: 'auto' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: 'var(--muted)',
            }}>
              <span style={{ width: 5, height: 5, background: 'var(--success)', display: 'inline-block', flexShrink: 0 }} />
              <span>Automation Registry</span>
              <a
                href={`https://explorer.arc.io/address/${AUTOMATION_REGISTRY_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  color: 'var(--ink-2)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                }}
              >
                {formatAddress(AUTOMATION_REGISTRY_ADDRESS)}
                <ExternalLink size={10} strokeWidth={1.5} />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', border: '1px solid var(--border)' }}>
        <StatCard
          label="Registered automations"
          value={!isConnected ? '—' : countLoading ? null : String(automationCount ?? 0)}
          note="Total on Arc"
        />
        <StatCard
          label="Network fees"
          value="USDC"
          note="Paid in USDC, no other token needed"
        />
        <StatCard
          label="Network"
          value="Arc"
          note="Mainnet, chain ID 5042"
        />
        <StatCard
          label="Pending payments"
          value="—"
          note="Needs the automation service"
        />
      </div>

      {/* Recent Activity */}
      <SectionCard
        label="Recent activity"
        chamfer
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Badge variant="warning">Sample data</Badge>
            <button
              onClick={() => onNavigate('activity')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--muted)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                padding: 0,
                fontFamily: "'JetBrains Mono', monospace",
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              See all <ArrowUpRight size={11} strokeWidth={1.5} />
            </button>
          </div>
        }
      >
        <table>
          <thead>
            <tr>
              <th>Type</th>
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
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: 'var(--subtle)',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}>{row.type}</span>
                </td>
                <td style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.description}</td>
                <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: 'var(--ink)', fontSize: 13 }}>
                  ${row.amount}
                </td>
                <td style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--subtle)', fontSize: 11, letterSpacing: '0.04em' }}>
                  {row.date}
                </td>
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
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--subtle)',
          marginBottom: 16,
        }}>
          What you can do
        </div>
        <div style={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))', border: '1px solid var(--border)' }}>
          {FEATURE_CARDS.map(({ page, label, desc, icon }) => (
            <button
              key={page}
              onClick={() => onNavigate(page)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                padding: '20px 22px',
                background: 'var(--surface)',
                border: 'none',
                borderRight: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)', opacity: 0.9 }}>{icon}</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4, letterSpacing: '-0.01em' }}>
                  {label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{desc}</div>
              </div>
              <ArrowUpRight size={11} strokeWidth={1.5} style={{ color: 'var(--subtle)', marginTop: 'auto' }} />
            </button>
          ))}
        </div>
      </div>

      {/* Architecture disclosures */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--warning)',
        padding: '18px 22px',
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
      }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--warning)',
            marginBottom: 8,
          }}>Important to know</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
            Approval rules, team roles and payment schedules are saved in this browser only. They are not enforced
            by a smart contract and do not sync between devices.
            Recurring and scheduled payments must be run by hand because the automation service is not running yet.
            The activity table above shows sample data.
          </div>
        </div>
      </div>

    </div>
  )
}
