/**
 * Council recovery panel: shows the council, the inactivity gate and every recovery, and offers the
 * restricted actions each wallet is allowed to take. Recovery can only install replacement governance
 * (approvers, quorum, proposers, guardian, council). It can never move treasury funds.
 */
import { useState } from 'react'
import { isAddress, type Address } from 'viem'
import SectionCard from '../ui/SectionCard'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import TxStatus from './TxStatus'
import { AddressLink, Field, Notice, inputStyle, mono } from './shared'
import { useNow, type TreasurySnapshot } from '../../hooks/v2/useTreasuryV2'
import { useRecoveryV2, type RecoveryView } from '../../hooks/v2/useRecoveryV2'
import { useV2Tx } from '../../hooks/v2/useV2Tx'
import { RECOVERY_V2_ABI, TREASURY_V2_ABI } from '../../lib/v2/abi'
import { RECOVERY_V2_ADDRESS, TREASURY_V2_ADDRESS } from '../../lib/v2/config'
import { RECOVERY_STATUS_META, formatDuration, formatTimestamp, type Viewer } from '../../lib/v2/status'

const DAY = 86_400
const VOTING_WINDOW = 7 * DAY
const lines = (v: string) => v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
const dupes = (l: string[]) => l.filter((a, i) => l.findIndex((b) => b.toLowerCase() === a.toLowerCase()) !== i)

function until(target: bigint, now: number): string {
  const d = Number(target) - now
  return d > 0 ? `in ${formatDuration(d)}` : 'now'
}

export default function RecoveryPanel({ snap, viewer }: { snap: TreasurySnapshot | undefined; viewer: Viewer }) {
  const { data: info } = useRecoveryV2()
  const now = useNow()
  const tx = useV2Tx()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ approvers: '', proposers: '', quorum: '2', guardian: '', payroll: '', config: '', council: '', threshold: '2', confirm: false })
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }))

  if (!RECOVERY_V2_ADDRESS) {
    return <SectionCard label="Council recovery"><div style={{ padding: 16 }}><Notice tone="warning">No recovery contract configured. Set VITE_RECOVERY_ADDRESS to the deployed TreasuryRecovery.</Notice></div></SectionCard>
  }
  const rec = RECOVERY_V2_ADDRESS
  const call = (label: string, fn: string, args: readonly unknown[]) =>
    void tx.run(label, { address: rec, abi: RECOVERY_V2_ABI, functionName: fn, args })

  const eligible = info ? Number(info.eligibleAt) <= now : false
  const activeLive = info?.recoveries.some((r) => r.record.status === 1 || r.record.status === 2) ?? false
  const cooling = snap && snap.coolingEnd > BigInt(now)
  const coolingDone = snap && snap.coolingEnd > 0n && snap.coolingEnd <= BigInt(now)

  const approvers = lines(f.approvers), council = lines(f.council), proposers = lines(f.proposers)
  const problems: string[] = []
  if (approvers.length < 2 || approvers.length > 20) problems.push('Use 2 to 20 approvers (3 or more recommended).')
  if (approvers.length === 2) problems.push('Warning: 2 approvers means one lost key locks the treasury again. Use 3 or more.')
  if ([...approvers, ...proposers, ...council].some((a) => !isAddress(a))) problems.push('Every entry must be a valid address.')
  if (dupes(approvers).length || dupes(council).length) problems.push('Duplicate addresses found.')
  const q = Number(f.quorum), th = Number(f.threshold)
  if (!(q >= 2 && q <= approvers.length)) problems.push('Quorum must be at least 2 and at most the number of approvers.')
  else if (q === approvers.length) problems.push('Warning: quorum equals the approver count, so one lost key blocks governance.')
  if (council.length < 3 || council.length > 7 || !(th >= 2 && th < council.length)) problems.push('Council needs 3 to 7 members and a threshold of at least 2, below the member count.')
  if (council.some((c) => approvers.some((a) => a.toLowerCase() === c.toLowerCase()) || c.toLowerCase() === f.guardian.trim().toLowerCase())) problems.push('Council members cannot be approvers or the guardian.')
  if (f.guardian.trim() && !isAddress(f.guardian.trim())) problems.push('Guardian must be an address or empty.')
  const hard = problems.filter((p) => !p.startsWith('Warning'))
  const payrollDelay = Number(f.payroll || snap?.payrollDelay || 0), configDelay = Number(f.config || snap?.configDelay || 0)
  if (snap && configDelay < snap.minConfigDelay) hard.push(`Config delay cannot be below the fixed minimum (${formatDuration(snap.minConfigDelay)}).`)

  const initiate = () => {
    call('Start recovery', 'initiateRecovery', [{
      approvers: approvers as Address[], proposers: proposers as Address[], quorum: q,
      guardian: (f.guardian.trim() || '0x0000000000000000000000000000000000000000') as Address, payrollDelay, configDelay,
    }, council, th])
  }

  return (
    <SectionCard label="Council recovery">
      <div style={{ display: 'grid', gap: 14, padding: 16 }}>
        <Notice>
          If too many approver keys are lost, an independent council ({info ? `${info.threshold} of ${info.council.length}` : '…'}) can install replacement governance.
          It needs {formatDuration(30 * DAY)} with no executed proposal, then a {formatDuration(14 * DAY)} timelock during which the current approvers can veto with their normal quorum.
          After it runs, payroll and module payments are blocked for {formatDuration(7 * DAY)}. The council can never move treasury funds.
        </Notice>

        {cooling && snap && <Notice tone="warning">Spending cooling period active: payroll and recurring payments resume {until(snap.coolingEnd, now)} ({formatTimestamp(snap.coolingEnd)}). Deposits and governance still work. Proposals made now must expire after that time.</Notice>}
        {coolingDone && TREASURY_V2_ADDRESS && (
          <Button size="sm" onClick={() => void tx.run('Acknowledge end of cooling period', { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName: 'completeCooling', args: [] })}>Acknowledge cooling period ended</Button>
        )}

        {info && (
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <div>
              <div style={{ ...mono, fontSize: 10, color: 'var(--subtle)' }}>COUNCIL ({info.threshold} of {info.council.length} needed)</div>
              {info.council.map((a) => <div key={a}><AddressLink address={a} /></div>)}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ ...mono, fontSize: 10, color: 'var(--subtle)' }}>INACTIVITY GATE</div>
              {eligible ? <span style={{ color: 'var(--warning)' }}>Open: recovery can be started</span> : <span>Closed. Opens {until(info.eligibleAt, now)} ({formatTimestamp(info.eligibleAt)})</span>}
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>Any executed proposal, veto or recovery restarts the 30 day clock.</div>
            </div>
          </div>
        )}

        {info && info.recoveries.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>No recovery has ever been started.</span>}
        {info?.recoveries.map((r) => <RecoveryRow key={r.id.toString()} r={r} now={now} viewer={viewer} isCouncil={info.isCouncilMember} threshold={info.threshold} call={call} />)}

        {info?.isCouncilMember && !activeLive && (
          <div>
            <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} disabled={!eligible}>{open ? 'Hide' : 'Start a recovery'}</Button>
            {!eligible && <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10 }}>Available once the inactivity gate opens.</span>}
            {open && eligible && (
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <Field label="Replacement approvers" hint="One address per line. Each must be a wallet that can sign."><textarea rows={3} style={{ ...inputStyle, height: 'auto', padding: 10 }} value={f.approvers} onChange={(e) => set('approvers', e.target.value)} /></Field>
                <Field label="Proposers (optional)"><textarea rows={2} style={{ ...inputStyle, height: 'auto', padding: 10 }} value={f.proposers} onChange={(e) => set('proposers', e.target.value)} /></Field>
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                  <Field label="Quorum"><input style={inputStyle} value={f.quorum} onChange={(e) => set('quorum', e.target.value)} /></Field>
                  <Field label="Guardian (optional)"><input style={inputStyle} value={f.guardian} onChange={(e) => set('guardian', e.target.value)} /></Field>
                  <Field label="Payroll delay (s)"><input style={inputStyle} placeholder={String(snap?.payrollDelay ?? '')} value={f.payroll} onChange={(e) => set('payroll', e.target.value)} /></Field>
                  <Field label="Config delay (s)"><input style={inputStyle} placeholder={String(snap?.configDelay ?? '')} value={f.config} onChange={(e) => set('config', e.target.value)} /></Field>
                </div>
                <Field label="Replacement council" hint="3 to 7 independent wallets, not approvers, not the guardian."><textarea rows={3} style={{ ...inputStyle, height: 'auto', padding: 10 }} value={f.council} onChange={(e) => set('council', e.target.value)} /></Field>
                <Field label="Council threshold"><input style={inputStyle} value={f.threshold} onChange={(e) => set('threshold', e.target.value)} /></Field>
                {problems.map((p) => <Notice key={p} tone={p.startsWith('Warning') ? 'warning' : 'danger'}>{p}</Notice>)}
                <label style={{ fontSize: 13, display: 'flex', gap: 8 }}><input type="checkbox" checked={f.confirm} onChange={(e) => set('confirm', e.target.checked)} />I confirmed every new approver and council wallet is controlled and can sign. There is no further recovery from a mistake.</label>
                <div><Button disabled={hard.length > 0 || !f.confirm} onClick={initiate}>Start recovery</Button></div>
              </div>
            )}
          </div>
        )}
        <TxStatus state={tx.state} />
      </div>
    </SectionCard>
  )
}

function RecoveryRow({ r, now, viewer, isCouncil, threshold, call }: {
  r: RecoveryView; now: number; viewer: Viewer; isCouncil: boolean; threshold: number
  call: (label: string, fn: string, args: readonly unknown[]) => void
}) {
  const { record: x, payload } = r
  const meta = RECOVERY_STATUS_META[x.status] ?? RECOVERY_STATUS_META[0]
  const live = x.status === 1 || x.status === 2
  const timeStale = (x.status === 1 && now >= Number(x.initiatedAt) + VOTING_WINDOW) || (x.status === 2 && now >= Number(x.expiresAt))
  const id = r.id
  return (
    <div style={{ border: '1px solid var(--border)', padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: 12 }}>Recovery #{id.toString()}</span>
        <Badge variant={meta.variant}>{meta.label}</Badge>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>council {x.approvals}/{threshold} · vetoes {x.vetoes}/{x.vetoQuorum}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{meta.help} Started {formatTimestamp(x.initiatedAt)} by <AddressLink address={x.initiator} />.</div>
      {x.status === 2 && <div style={{ fontSize: 12 }}>Executable {until(x.executableAt, now)} ({formatTimestamp(x.executableAt)}); expires {formatTimestamp(x.expiresAt)}.</div>}
      {payload && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Installs {payload.config.approvers.length} approvers (quorum {payload.config.quorum}), council {payload.threshold} of {payload.council.length}, guardian {payload.config.guardian === '0x0000000000000000000000000000000000000000' ? 'disabled' : payload.config.guardian}.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {x.status === 1 && isCouncil && !r.myCouncilVote && <Button size="sm" onClick={() => call('Approve recovery', 'approveRecovery', [id])}>Approve (council)</Button>}
        {live && viewer.isApprover && !r.myVeto && <Button size="sm" variant="danger" onClick={() => call('Veto recovery', 'vetoRecovery', [id])}>Veto (approver)</Button>}
        {x.status === 1 && viewer.address?.toLowerCase() === x.initiator.toLowerCase() && <Button size="sm" variant="secondary" onClick={() => call('Cancel recovery', 'cancelRecovery', [id])}>Cancel</Button>}
        {x.status === 2 && now >= Number(x.executableAt) && now < Number(x.expiresAt) && <Button size="sm" onClick={() => call('Execute recovery', 'executeRecovery', [id])}>Execute</Button>}
        {live && timeStale && <Button size="sm" variant="secondary" onClick={() => call('Expire recovery', 'expireRecovery', [id])}>Mark expired</Button>}
      </div>
    </div>
  )
}
