import { ExternalLink } from 'lucide-react'
import Badge from '../ui/Badge'
import EmptyState from '../ui/EmptyState'
import Spinner from '../ui/Spinner'
import { Activity as ActivityIcon } from 'lucide-react'
import { Notice, mono, shortAddr, usdc } from './shared'
import { useV2Events, type V2Event } from '../../hooks/v2/useV2Events'
import { ACTION_LABEL, FREQUENCY_LABEL } from '../../lib/v2/status'
import { txUrl } from '../../lib/v2/config'

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'active'
interface Line { title: string; detail: string; tone: Tone; moneyMove: boolean }

const a = (v: unknown) => (typeof v === 'string' ? shortAddr(v) : '—')
const n = (v: unknown) => (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'string' ? String(v) : '')
const m = (v: unknown) => (typeof v === 'bigint' ? usdc(v) : '—')

export function describeEvent(e: V2Event): Line {
  const x = e.args
  switch (e.name) {
    case 'Deposited': return { title: 'Deposit', detail: `${m(x.amount)} USDC from ${a(x.from)}`, tone: 'success', moneyMove: true }
    case 'PaymentSent': return { title: 'Payroll payment', detail: `${m(x.amount)} USDC to ${a(x.to)} (proposal #${n(x.proposalId)})`, tone: 'success', moneyMove: true }
    case 'ModulePaid': return { title: 'Recurring payment', detail: `${m(x.amount)} USDC to ${a(x.to)}`, tone: 'success', moneyMove: true }
    case 'ModuleFunded': return { title: 'Module funded', detail: `${m(x.amount)} USDC moved to the module`, tone: 'warning', moneyMove: true }
    case 'FundsReturned': return { title: 'Module funds returned', detail: `${m(x.amount)} USDC returned to the treasury`, tone: 'success', moneyMove: true }
    case 'Rescued': return { title: 'Token rescued', detail: `${n(x.amount)} units to ${a(x.to)}`, tone: 'warning', moneyMove: true }
    case 'Proposed': return { title: `Proposed: ${ACTION_LABEL[Number(x.action)] ?? 'action'}`, detail: `#${n(x.proposalId)} by ${a(x.proposer)}${typeof x.totalAmount === 'bigint' && x.totalAmount > 0n ? ` · ${m(x.totalAmount)} USDC` : ''}`, tone: 'neutral', moneyMove: false }
    case 'Voted': return { title: Number(x.vote) === 1 ? 'Approved' : 'Rejected', detail: `#${n(x.proposalId)} by ${a(x.voter)} · ${n(x.approvals)} approvals, ${n(x.rejections)} rejections`, tone: Number(x.vote) === 1 ? 'active' : 'danger', moneyMove: false }
    case 'QuorumReached': return { title: 'Quorum reached', detail: `#${n(x.proposalId)} executable after the timelock`, tone: 'active', moneyMove: false }
    case 'Executed': return { title: `Executed: ${ACTION_LABEL[Number(x.action)] ?? 'action'}`, detail: `#${n(x.proposalId)}`, tone: 'success', moneyMove: false }
    case 'Cancelled': return { title: 'Cancelled', detail: `#${n(x.proposalId)} by ${a(x.by)}`, tone: 'neutral', moneyMove: false }
    case 'Rejected': return { title: 'Rejected (quorum impossible)', detail: `#${n(x.proposalId)}`, tone: 'danger', moneyMove: false }
    case 'EpochCreated': return { title: 'Governance epoch started', detail: `Epoch ${n(x.epoch)} · quorum ${n(x.quorum)}`, tone: 'warning', moneyMove: false }
    case 'Paused': return { title: 'Treasury paused', detail: `by ${a(x.by)}`, tone: 'danger', moneyMove: false }
    case 'Unpaused': return { title: 'Treasury unpaused', detail: `proposal #${n(x.proposalId)}`, tone: 'success', moneyMove: false }
    case 'ModuleConfigured': return { title: x.enabled ? 'Module enabled' : 'Module disabled', detail: `per payment ${m(x.perTxMax)} · per window ${m(x.windowMax)} USDC`, tone: 'warning', moneyMove: false }
    case 'ScheduleCreated': return { title: 'Schedule created', detail: `#${n(x.scheduleId)} · ${m(x.amount)} USDC ${FREQUENCY_LABEL[Number(x.frequency)]?.toLowerCase()} to ${a(x.recipient)}`, tone: 'neutral', moneyMove: false }
    case 'ScheduleExecuted': return { title: 'Schedule paid', detail: `#${n(x.scheduleId)} · ${m(x.amount)} USDC to ${a(x.recipient)}`, tone: 'success', moneyMove: false }
    case 'ExecutionFailed': return { title: 'Schedule payment failed', detail: `#${n(x.scheduleId)} · failure ${n(x.failures)}`, tone: 'danger', moneyMove: false }
    case 'ScheduleAutoPaused': return { title: 'Schedule auto-paused', detail: `#${n(x.scheduleId)}`, tone: 'danger', moneyMove: false }
    case 'SchedulePaused': return { title: 'Schedule paused', detail: `#${n(x.scheduleId)} by ${a(x.by)}`, tone: 'warning', moneyMove: false }
    case 'ScheduleResumed': return { title: 'Schedule resumed', detail: `#${n(x.scheduleId)}`, tone: 'neutral', moneyMove: false }
    case 'ScheduleCancelled': return { title: 'Schedule cancelled', detail: `#${n(x.scheduleId)} by ${a(x.by)}`, tone: 'neutral', moneyMove: false }
    case 'RecoveryInitiated': return { title: 'Recovery started', detail: `#${n(x.recoveryId)} by ${a(x.initiator)}`, tone: 'warning', moneyMove: false }
    case 'RecoveryCouncilVoted': return { title: 'Recovery council vote', detail: `#${n(x.recoveryId)} by ${a(x.member)} · ${n(x.approvals)} of ${n(x.threshold)}`, tone: 'active', moneyMove: false }
    case 'RecoveryQuorumReached': return { title: 'Recovery council quorum reached', detail: `#${n(x.recoveryId)} · 14 day timelock started`, tone: 'warning', moneyMove: false }
    case 'RecoveryVetoVoted': return { title: 'Recovery veto vote', detail: `#${n(x.recoveryId)} by ${a(x.approver)} · ${n(x.vetoes)} of ${n(x.vetoQuorum)}`, tone: 'danger', moneyMove: false }
    case 'RecoveryVetoed': return { title: 'Recovery vetoed', detail: `#${n(x.recoveryId)}`, tone: 'danger', moneyMove: false }
    case 'RecoveryCancelled': return { title: 'Recovery cancelled', detail: `#${n(x.recoveryId)} by ${a(x.by)}`, tone: 'neutral', moneyMove: false }
    case 'RecoveryExpired': return { title: 'Recovery expired', detail: `#${n(x.recoveryId)}`, tone: 'neutral', moneyMove: false }
    case 'RecoveryExecuted': return { title: 'Recovery executed', detail: `#${n(x.recoveryId)} · epoch ${n(x.newEpoch)} · spending cooling started`, tone: 'warning', moneyMove: false }
    case 'RecoveryInstalled': return { title: 'Recovery installed', detail: `epoch ${n(x.newEpoch)}`, tone: 'warning', moneyMove: false }
    case 'CoolingPeriodCompleted': return { title: 'Cooling period ended', detail: `epoch ${n(x.epoch)}`, tone: 'success', moneyMove: false }
    case 'ScheduleCompleted': return { title: 'Schedule completed', detail: `#${n(x.scheduleId)}`, tone: 'neutral', moneyMove: false }
    default: return { title: e.name, detail: '', tone: 'neutral', moneyMove: false }
  }
}

/** Onchain history. `moneyOnly` limits it to events that move USDC. */
export default function EventFeed({ moneyOnly = false }: { moneyOnly?: boolean }) {
  const { data, isLoading, error } = useV2Events()
  if (error) return <Notice tone="danger">Could not read events: {error instanceof Error ? error.message : 'RPC error'}</Notice>
  if (isLoading || !data) return <Spinner />
  const rows = data.events.map((e) => ({ e, line: describeEvent(e) })).filter((r) => !moneyOnly || r.line.moneyMove)
  const behind = data.head - data.scannedTo
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Notice tone={data.truncated || !data.deployBlockKnown ? 'warning' : 'neutral'}>
        Scanned blocks {data.fromBlock.toString()} to {data.scannedTo.toString()} of chain head {data.head.toString()}
        {behind > 0n ? ` (${behind.toString()} blocks remaining)` : ' (up to date)'}.
        {!data.deployBlockKnown && ' VITE_TREASURY_DEPLOY_BLOCK is not set, so only the most recent blocks are scanned.'}
        {data.truncated && ' History older than the scan window is not shown.'}
      </Notice>
      {rows.length === 0 && <EmptyState icon={ActivityIcon} title="No events yet" description="Onchain activity appears here after it is confirmed." />}
      {rows.map(({ e, line }) => (
        <div key={`${e.txHash}-${e.logIndex}`} style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            <Badge variant={line.tone}>{line.title}</Badge>
            <span style={{ fontSize: 13 }}>{line.detail}</span>
          </div>
          <div style={{ ...mono, fontSize: 11, color: 'var(--subtle)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span>{e.timestamp ? new Date(e.timestamp * 1000).toLocaleString() : `block ${e.blockNumber.toString()}`}</span>
            <a href={txUrl(e.txHash)} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }} aria-label="Open transaction in explorer"><ExternalLink size={12} /></a>
          </div>
        </div>
      ))}
    </div>
  )
}
