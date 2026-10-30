import { useState } from 'react'
import { Check, X, Play, Ban } from 'lucide-react'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import TxStatus from './TxStatus'
import { AddressLink, Notice, bytes32ToMemo, mono, usdc } from './shared'
import { useNow, type ProposalView, type TreasurySnapshot } from '../../hooks/v2/useTreasuryV2'
import { useV2Tx } from '../../hooks/v2/useV2Tx'
import { TREASURY_V2_ABI } from '../../lib/v2/abi'
import { TREASURY_V2_ADDRESS } from '../../lib/v2/config'
import {
  ACTION, ACTION_LABEL, PSTATUS, PSTATUS_META, canCancel, canVote, countdownLabel, formatTimestamp, type Viewer,
} from '../../lib/v2/status'

function Details({ p }: { p: ProposalView }) {
  const d = p.details
  const row = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, ...mono } as const
  if (d.kind === 'payroll') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {d.items.map((it, i) => <div key={i} style={row}><AddressLink address={it.to} /><span>{usdc(it.amount)} USDC</span></div>)}
      </div>
    )
  }
  if (d.kind === 'governance') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        <div>Quorum {d.config.quorum} of {d.config.approvers.length} · payroll delay {d.config.payrollDelay}s · config delay {d.config.configDelay}s</div>
        <div>Approvers: {d.config.approvers.map((a) => <span key={a} style={{ marginRight: 8 }}><AddressLink address={a} /></span>)}</div>
        <div>Proposers: {d.config.proposers.length ? d.config.proposers.map((a) => <span key={a} style={{ marginRight: 8 }}><AddressLink address={a} /></span>) : 'none listed'}</div>
        <div>Guardian: {d.config.guardian === '0x0000000000000000000000000000000000000000' ? 'disabled' : <AddressLink address={d.config.guardian} />}</div>
      </div>
    )
  }
  if (d.kind === 'moduleConfig') {
    return (
      <div style={{ fontSize: 12 }}>
        {d.enabled ? 'Enable' : 'Disable'} module <AddressLink address={d.module} /> · per payment {usdc(d.perTxMax)} · per window {usdc(d.windowMax)} USDC · window {d.windowLength}s
      </div>
    )
  }
  if (d.kind === 'moduleAction') {
    const names: Record<number, string> = { 1: 'Create schedule', 2: 'Resume schedule', 3: 'Return module funds to treasury' }
    return <div style={{ fontSize: 12 }}>{names[d.actionCode] ?? `Action ${d.actionCode}`} on <AddressLink address={d.module} />{d.fundingAmount > 0n ? ` · funds ${usdc(d.fundingAmount)} USDC` : ''}</div>
  }
  if (d.kind === 'rescue') return <div style={{ fontSize: 12 }}>Rescue {d.amount.toString()} units of token <AddressLink address={d.token} /> to <AddressLink address={d.to} /></div>
  if (d.kind === 'unpause') return <div style={{ fontSize: 12 }}>Unpause the treasury (pause #{d.pauseCount.toString()})</div>
  return <div style={{ fontSize: 12, color: 'var(--muted)' }}>Payload could not be decoded.</div>
}

export default function ProposalCard({ p, snapshot, viewer }: { p: ProposalView; snapshot: TreasurySnapshot; viewer: Viewer }) {
  const now = useNow()
  const { state, run, busy } = useV2Tx()
  const [open, setOpen] = useState(false)
  const meta = PSTATUS_META[p.derived] ?? PSTATUS_META[0]
  const core = p.core
  const pct = Math.min(100, Math.round((core.approvals / Math.max(1, core.quorum)) * 100))
  const countdown = countdownLabel(core, p.derived, now)
  const live = p.derived === PSTATUS.Pending
  const call = (functionName: string, label: string) => {
    void run(label, { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName, args: [p.id] })
  }

  const showVote = canVote(core, p.derived, viewer, p.myVote, snapshot.epoch)
  const showExec = p.derived === PSTATUS.Executable && !(snapshot.paused && ![ACTION.Governance, ACTION.Unpause].includes(core.action as never))
  const showCancel = canCancel(core, p.derived, viewer)
  const pausedBlock = p.derived === PSTATUS.Executable && snapshot.paused && ![ACTION.Governance, ACTION.Unpause].includes(core.action as never)

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ ...mono, fontSize: 12, color: 'var(--subtle)' }}>#{p.id.toString()}</span>
          <strong style={{ fontSize: 15 }}>{ACTION_LABEL[core.action] ?? 'Proposal'}</strong>
          <Badge variant={meta.variant}>{meta.label}</Badge>
          {core.totalAmount > 0n && <span style={{ ...mono, fontSize: 12 }}>{usdc(core.totalAmount)} USDC</span>}
        </div>
        {countdown && <span style={{ ...mono, fontSize: 12, color: 'var(--muted)' }}>{countdown}</span>}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
          <span>Approvals {core.approvals} of {core.quorum} needed{core.rejections > 0 ? ` · ${core.rejections} rejected` : ''}</span>
          <span>{meta.help}</span>
        </div>
        <div style={{ height: 4, background: 'var(--surface-2)' }}><div style={{ height: 4, width: `${pct}%`, background: core.approvals >= core.quorum ? 'var(--success)' : 'var(--ink)' }} /></div>
      </div>

      <button type="button" onClick={() => setOpen((o) => !o)} style={{ ...mono, fontSize: 11, textAlign: 'left', color: 'var(--muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <Details p={p} />
          <div style={{ ...mono, fontSize: 11, color: 'var(--subtle)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>Proposed by <AddressLink address={core.proposer} /> · epoch {core.epoch.toString()}</span>
            {bytes32ToMemo(core.memoRef) && <span>Memo: {bytes32ToMemo(core.memoRef)}</span>}
            <span>Created {formatTimestamp(core.createdAt)} · expires {formatTimestamp(core.expiresAt)}</span>
            {core.executableAt > 0n && <span>Executable from {formatTimestamp(core.executableAt)}</span>}
          </div>
        </div>
      )}

      {pausedBlock && <Notice tone="warning">The treasury is paused, so this cannot execute until it is unpaused.</Notice>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {showVote && live && <Button size="sm" icon={<Check size={13} />} loading={busy} onClick={() => call('approve', 'Approve')}>Approve</Button>}
        {showVote && live && <Button size="sm" variant="secondary" icon={<X size={13} />} loading={busy} onClick={() => call('reject', 'Reject')}>Reject</Button>}
        {showExec && <Button size="sm" icon={<Play size={13} />} loading={busy} onClick={() => call('execute', 'Execute')}>Execute</Button>}
        {showCancel && <Button size="sm" variant="danger" icon={<Ban size={13} />} loading={busy} onClick={() => call('cancel', 'Cancel')}>Cancel</Button>}
        {p.myVote !== 0 && <Badge variant="neutral">You {p.myVote === 1 ? 'approved' : 'rejected'}</Badge>}
      </div>
      <TxStatus state={state} />
    </div>
  )
}
