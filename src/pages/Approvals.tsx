/**
 * Approvals page — Treasury Approval Workflows
 */

import { useState, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { Plus, Search, Filter, ShieldCheck, Clock, CheckCircle2, XCircle, PlayCircle, Info, Lock } from 'lucide-react'
import { isTreasuryDeployed, useTreasuryConfig } from '../hooks/useTreasury'
import Badge from '../components/ui/Badge'
import PageHeader from '../components/ui/PageHeader'
import { WalletRequired } from '../components/WalletGate'
import ApprovalRequestModal from '../components/approvals/ApprovalRequestModal'
import ApprovalDetail from '../components/approvals/ApprovalDetail'
import PolicySettings from '../components/approvals/PolicySettings'
import {
  type ApprovalRequest,
  type ApprovalRequestStatus,
  REQUEST_STATUS_LABELS,
  REQUEST_TYPE_LABELS,
  requestStatusVariant,
  formatUsdcBigint,
  parseUsdcString,
  formatTs,
  formatAddr,
  formatRequestId,
} from '../lib/approvals'
import {
  useApprovalRequests,
  useApprovalPolicy,
  useApprovalStats,
  useUsdcBalance,
} from '../hooks/useApprovals'
import { useNotifications } from '../context/NotificationContext'

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div
      className=""
      style={{
        background: 'var(--surface)',
        border: `1px solid ${accent ? 'var(--accent-border)' : 'var(--border)'}`,
        padding: '20px 22px',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent ? 'var(--accent)' : 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab = 'needs-action' | 'submitted' | 'history'

// ─── Row component ────────────────────────────────────────────────────────────

function RequestRow({ req, onClick }: { req: ApprovalRequest; onClick: () => void }) {
  let amountRaw = 0n
  try { amountRaw = parseUsdcString(req.amountUsdc) } catch { /* noop */ }

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-5 py-4 transition-colors cursor-pointer flex-wrap"
      style={{ borderBottom: '1px solid var(--border)', background: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-muted)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* ID + title */}
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--subtle)', letterSpacing: '0.05em' }}>{formatRequestId(req.id)}</span>
          <Badge variant={requestStatusVariant(req.status)}>{REQUEST_STATUS_LABELS[req.status]}</Badge>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {REQUEST_TYPE_LABELS[req.type]} · To {formatAddr(req.recipientAddress)} · {formatTs(req.createdAt)}
        </div>
      </div>

      {/* Amount */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif" }}>
          {formatUsdcBigint(amountRaw)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>USDC</div>
      </div>

      {/* Approvals */}
      <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 48 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
          {req.decisions.filter(d => d.decision === 'approved').length}/{req.requiredApprovals}
        </div>
        <div style={{ fontSize: 10, color: 'var(--subtle)' }}>approvals</div>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function Empty({ icon, message, sub }: { icon: React.ReactNode; message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center" style={{ color: 'var(--muted)' }}>
      <div style={{ marginBottom: 12, opacity: 0.4 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>{message}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 300 }}>{sub}</div>}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Approvals() {
  const { isConnected, address } = useAccount()
  const { emit } = useNotifications()
  const { requests, createRequest, recordDecision, cancelRequest, updateRequest } = useApprovalRequests({ onNotify: emit })
  const { policy, updatePolicy } = useApprovalPolicy()
  const stats = useApprovalStats(requests, address)
  const { formatted: balanceFormatted } = useUsdcBalance()
  const treasuryConfig = useTreasuryConfig()

  const [showCreate, setShowCreate] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('needs-action')
  const [statusFilter, setStatusFilter] = useState<ApprovalRequestStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const selectedRequest = requests.find(r => r.id === selectedId) ?? null

  // Filter logic per tab
  const tabRequests = useMemo(() => {
    if (!address) return []
    if (activeTab === 'needs-action') {
      return requests.filter(r => {
        if (r.status !== 'pending' && r.status !== 'partial' && r.status !== 'approved') return false
        const alreadyDecided = r.decisions.some(d => d.approverAddress.toLowerCase() === address.toLowerCase())
        if (r.status === 'approved') return true // show approved ones for execution
        return !alreadyDecided
      })
    }
    if (activeTab === 'submitted') {
      return requests.filter(r => r.requesterAddress.toLowerCase() === address.toLowerCase())
    }
    return requests // history = all
  }, [requests, activeTab, address])

  const filtered = useMemo(() => {
    let result = tabRequests
    if (statusFilter !== 'all') {
      result = result.filter(r => r.status === statusFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.recipientAddress.toLowerCase().includes(q) ||
        r.requesterAddress.toLowerCase().includes(q) ||
        formatRequestId(r.id).toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => b.createdAt - a.createdAt)
  }, [tabRequests, statusFilter, searchQuery])

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'needs-action', label: 'Needs action', count: stats.needsMyApproval + stats.approved },
    { id: 'submitted', label: 'Submitted by me' },
    { id: 'history', label: 'All requests', count: stats.total },
  ]

  const ALL_STATUSES: ApprovalRequestStatus[] = ['pending', 'partial', 'approved', 'rejected', 'executed', 'failed', 'cancelled']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <PageHeader
        title="Approvals"
        subtitle={`Transfers that need sign-off before they are sent.${balanceFormatted ? ` Treasury balance: ${balanceFormatted} USDC.` : ''}`}
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowPolicy(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 16px', minHeight: 44, fontSize: 13, fontWeight: 600, background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}
            >
              <ShieldCheck size={15} /> Approval rules
            </button>
            {isConnected && (
              <button
                onClick={() => setShowCreate(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 18px', minHeight: 44, fontSize: 13, fontWeight: 700, background: 'var(--accent)', border: 'none', color: 'var(--bg)', cursor: 'pointer' }}
              >
                <Plus size={15} /> New request
              </button>
            )}
          </div>
        }
      />

      {/* Contract / this-browser mode banner */}
      {isTreasuryDeployed ? (
        <div className="flex items-start gap-3 px-4 py-3" style={{ background: 'var(--success-dim)', border: '1px solid var(--success-dim)' }}>
          <Lock size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--success)', lineHeight: 1.5 }}>
            <strong>Approvals are enforced by the treasury contract.</strong>{' '}
            Required approvals: {treasuryConfig.quorum ?? '…'} of {treasuryConfig.approverCount ?? '…'}.
            The contract checks every approval and payment, not just this page.
            {' '}<em>This contract has not been independently audited. Do not hold large amounts of funds in it until an audit is complete.</em>
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-3 px-4 py-3" style={{ background: 'var(--warning-dim)', border: '1px solid var(--warning-border)' }}>
          <Info size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--warning)', lineHeight: 1.5 }}>
            <strong>Saved in this browser only.</strong> Approvals here are records on this device and are not enforced by a contract.
            The treasury contract has not been set up yet, so approvals cannot be checked by the network.
          </span>
        </div>
      )}

      {!isConnected && <WalletRequired message="Connect your wallet to view and manage approval requests." />}

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: 14 }}>
        <StatCard label="Total requests" value={stats.total} />
        <StatCard label="Needs your action" value={stats.needsMyApproval} accent />
        <StatCard label="Waiting for approvals" value={stats.pending + stats.partial} />
        <StatCard label="Ready to send" value={stats.approved} />
        <StatCard label="Sent" value={stats.executed} />
        <StatCard label="Rejected" value={stats.rejected} />
      </div>

      {/* Threshold info */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <ShieldCheck size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          Current rule: transfers of <strong style={{ color: 'var(--ink)' }}>{policy.thresholdUsdc} USDC</strong> or more need{' '}
          <strong style={{ color: 'var(--ink)' }}>{policy.requiredApprovals} approval{policy.requiredApprovals !== 1 ? 's' : ''}</strong>.
          {policy.approverAddresses.length === 0
            ? ' Any connected wallet can approve.'
            : ` ${policy.approverAddresses.length} approver${policy.approverAddresses.length !== 1 ? 's' : ''} allowed.`}
          {' '}
          <button onClick={() => setShowPolicy(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, minHeight: 44 }}>Edit rules</button>
        </span>
      </div>

      {/* Tabs + filter bar */}
      <div className="overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '0 20px',
                minHeight: 44,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--muted)',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, background: activeTab === tab.id ? 'var(--accent-dim)' : 'var(--surface-muted)', color: activeTab === tab.id ? 'var(--accent)' : 'var(--subtle)', padding: '1px 7px', border: '1px solid var(--border)' }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 px-5 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Search by title, ID or wallet address…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ width: '100%', paddingLeft: 32, paddingRight: 12, minHeight: 44, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={13} style={{ color: 'var(--muted)' }} />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as ApprovalRequestStatus | 'all')}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: 44, padding: '0 10px', fontSize: 13, color: 'var(--ink)', outline: 'none', cursor: 'pointer' }}
            >
              <option value="all">All statuses</option>
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{REQUEST_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Request list */}
        {filtered.length === 0 ? (
          activeTab === 'needs-action' ? (
            <Empty
              icon={<ShieldCheck size={36} />}
              message="Nothing needs your action"
              sub="You're all caught up. Requests waiting for you will appear here."
            />
          ) : activeTab === 'submitted' ? (
            <Empty
              icon={<Clock size={36} />}
              message="No requests submitted"
              sub="Select “New request” to ask for approval of a treasury transfer."
            />
          ) : (
            <Empty
              icon={<PlayCircle size={36} />}
              message="No requests found"
              sub={searchQuery || statusFilter !== 'all' ? 'Try adjusting your filters.' : 'Approval requests will appear here once they are submitted.'}
            />
          )
        ) : (
          filtered.map(req => (
            <RequestRow key={req.id} req={req} onClick={() => setSelectedId(req.id)} />
          ))
        )}
      </div>

      {/* Recent activity strip — last 5 sent/rejected */}
      {(() => {
        const recent = [...requests]
          .filter(r => r.status === 'executed' || r.status === 'rejected' || r.status === 'failed')
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 5)
        if (recent.length === 0) return null
        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Recent activity</span>
            </div>
            {recent.map(r => {
              let amountRaw = 0n
              try { amountRaw = parseUsdcString(r.amountUsdc) } catch { /* noop */ }
              const icon = r.status === 'executed'
                ? <CheckCircle2 size={15} style={{ color: 'var(--accent)' }} />
                : r.status === 'rejected'
                  ? <XCircle size={15} style={{ color: 'var(--danger)' }} />
                  : <XCircle size={15} style={{ color: 'var(--warning)' }} />
              return (
                <div
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className="flex items-center gap-4 px-5 py-3 cursor-pointer transition-colors"
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-muted)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {icon}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{formatTs(r.updatedAt)}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif", flexShrink: 0 }}>
                    {formatUsdcBigint(amountRaw)} USDC
                  </div>
                  <Badge variant={requestStatusVariant(r.status)}>{REQUEST_STATUS_LABELS[r.status]}</Badge>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Modals */}
      {showCreate && (
        <ApprovalRequestModal
          policy={policy}
          onSubmit={fields => { createRequest(fields); setShowCreate(false) }}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showPolicy && (
        <PolicySettings
          policy={policy}
          onSave={(updates) => {
            updatePolicy(updates, address)
            setShowPolicy(false)
          }}
          onClose={() => setShowPolicy(false)}
        />
      )}
      {selectedRequest && (
        <ApprovalDetail
          request={selectedRequest}
          policy={policy}
          onClose={() => setSelectedId(null)}
          onApprove={(id, approver, reason) => recordDecision(id, approver, 'approved', reason)}
          onReject={(id, approver, reason) => recordDecision(id, approver, 'rejected', reason)}
          onCancel={cancelRequest}
          onUpdate={updateRequest}
        />
      )}
    </div>
  )
}
