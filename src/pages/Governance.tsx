import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { isAddress, type Address } from 'viem'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import V2Gate from '../components/v2/V2Gate'
import TxStatus from '../components/v2/TxStatus'
import ProposalCard from '../components/v2/ProposalCard'
import RecoveryPanel from '../components/v2/RecoveryPanel'
import { AddressLink, Field, Notice, inputStyle, memoToBytes32, mono } from '../components/v2/shared'
import { useProposals, useTreasurySnapshot, useViewer } from '../hooks/v2/useTreasuryV2'
import { useV2Tx } from '../hooks/v2/useV2Tx'
import { TREASURY_V2_ABI } from '../lib/v2/abi'
import { TREASURY_V2_ADDRESS } from '../lib/v2/config'
import { ACTION, formatDuration, nowSeconds } from '../lib/v2/status'

const ZERO = '0x0000000000000000000000000000000000000000'
const lines = (v: string) => v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
const dupes = (l: string[]) => l.filter((a, i) => l.findIndex((b) => b.toLowerCase() === a.toLowerCase()) !== i)

/** Roster, pause controls and approver rotation. Every change is a quorum proposal with a timelock. */
export default function Governance() {
  const { data: snap } = useTreasurySnapshot()
  const viewer = useViewer(snap)
  const { data: proposals } = useProposals(snap)
  const pauseTx = useV2Tx()
  const unpauseTx = useV2Tx()
  const govTx = useV2Tx()

  const [approversText, setApproversText] = useState('')
  const [proposersText, setProposersText] = useState('')
  const [quorum, setQuorum] = useState('')
  const [guardian, setGuardian] = useState('')
  const [payrollDelay, setPayrollDelay] = useState('')
  const [configDelay, setConfigDelay] = useState('')
  const [hours, setHours] = useState('72')
  const [confirmed, setConfirmed] = useState(false)
  const [seeded, setSeeded] = useState(false)

  if (snap && !seeded) {
    setSeeded(true)
    setApproversText(snap.approvers.join('\n'))
    setProposersText(snap.proposers.join('\n'))
    setQuorum(String(snap.quorum))
    setGuardian(snap.guardian === ZERO ? '' : snap.guardian)
    setPayrollDelay(String(snap.payrollDelay))
    setConfigDelay(String(snap.configDelay))
  }

  const check = useMemo(() => {
    const approvers = lines(approversText), proposers = lines(proposersText)
    const q = Number(quorum), pd = Number(payrollDelay), cd = Number(configDelay), h = Number(hours)
    const errors: string[] = [], warnings: string[] = []
    const bad = [...approvers, ...proposers, ...(guardian.trim() ? [guardian.trim()] : [])].filter((a) => !isAddress(a))
    if (bad.length) errors.push('Every address must be a valid 0x address.')
    if ([...approvers, ...proposers, guardian.trim()].some((a) => a.toLowerCase() === TREASURY_V2_ADDRESS?.toLowerCase())) errors.push('The treasury itself cannot hold a role.')
    if ([...approvers, ...proposers, guardian.trim()].some((a) => a.toLowerCase() === ZERO)) errors.push('The zero address cannot hold a role.')
    if (approvers.length < 2 || approvers.length > 20) errors.push('Use between 2 and 20 approvers.')
    if (proposers.length > 50) errors.push('Use at most 50 proposers.')
    if (dupes(approvers).length || dupes(proposers).length) errors.push('An address appears twice in the same list.')
    if (!Number.isInteger(q) || q < 2 || q > approvers.length) errors.push('Quorum must be at least 2 and at most the approver count.')
    if (!Number.isInteger(pd) || pd < 0 || pd > 1_209_600) errors.push('Payroll delay must be 0 to 1209600 seconds.')
    if (snap && (!Number.isInteger(cd) || cd < snap.minConfigDelay || cd > 1_209_600)) errors.push(`Configuration delay must be between ${snap.minConfigDelay} and 1209600 seconds.`)
    if (snap && !(Number.isFinite(h) && h * 3600 >= cd + 3900 && h <= 719)) errors.push(`Expiry must be at least ${Math.ceil((cd + 3900) / 3600)}h (timelock plus one hour) and at most 719h.`)
    if (approvers.length < 3) warnings.push('Fewer than 3 approvers leaves no spare key.')
    if (q === approvers.length && approvers.length >= 2) warnings.push('Quorum equals the approver count: losing one key would lock the treasury permanently.')
    if (guardian.trim() && approvers.some((a) => a.toLowerCase() === guardian.trim().toLowerCase())) warnings.push('The guardian is also an approver. Keep them separate.')
    if (pd < 300) warnings.push('Payroll delay under 5 minutes leaves little time to notice a bad proposal.')
    const current = (snap?.approvers ?? []).map((a) => a.toLowerCase())
    const next = approvers.map((a) => a.toLowerCase())
    return { approvers, proposers, q, pd, cd, h, errors, warnings, added: next.filter((a) => !current.includes(a)), removed: current.filter((a) => !next.includes(a)) }
  }, [approversText, proposersText, quorum, guardian, payrollDelay, configDelay, hours, snap])

  const canPropose = viewer.isProposer && check.errors.length === 0 && confirmed
  async function propose() {
    const config = {
      approvers: check.approvers as Address[], proposers: check.proposers as Address[], quorum: check.q,
      guardian: (guardian.trim() || ZERO) as Address, payrollDelay: check.pd, configDelay: check.cd,
    }
    const expiresAt = BigInt(nowSeconds() + Math.round(check.h * 3600))
    const ok = await govTx.run('Governance proposal', { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName: 'proposeGovernance', args: [config, expiresAt, memoToBytes32('governance')] })
    if (ok) setConfirmed(false)
  }

  async function proposeUnpause() {
    if (!snap) return
    const expiresAt = BigInt(nowSeconds() + (snap.configDelay + 3600 + 600))
    await unpauseTx.run('Unpause proposal', { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName: 'proposeUnpause', args: [expiresAt, memoToBytes32('unpause')] })
  }

  const govProposals = (proposals ?? []).filter((p) => p.core.action === ACTION.Governance || p.core.action === ACTION.Unpause)
  const canPause = viewer.isApprover || viewer.isGuardian

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Treasury governance" title="Governance" subtitle="Who can approve, how many approvals are needed, and the emergency pause. Changes need quorum and a timelock." />
      <V2Gate>
        {snap && (
          <SectionCard label={`Current setup · epoch ${snap.epoch.toString()}`}>
            <div style={{ display: 'grid', gap: 16, padding: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              <div><div style={{ ...mono, fontSize: 10, color: 'var(--subtle)' }}>APPROVERS ({snap.quorum} of {snap.approvers.length} needed)</div>{snap.approvers.map((a) => <div key={a}><AddressLink address={a} /></div>)}</div>
              <div><div style={{ ...mono, fontSize: 10, color: 'var(--subtle)' }}>PROPOSERS</div>{snap.proposers.length ? snap.proposers.map((a) => <div key={a}><AddressLink address={a} /></div>) : <span style={{ fontSize: 12, color: 'var(--muted)' }}>None listed (approvers can always propose)</span>}</div>
              <div><div style={{ ...mono, fontSize: 10, color: 'var(--subtle)' }}>GUARDIAN</div>{snap.guardian === ZERO ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>Disabled</span> : <AddressLink address={snap.guardian} />}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Payroll delay {formatDuration(snap.payrollDelay)} · config delay {formatDuration(snap.configDelay)} · minimum config delay {formatDuration(snap.minConfigDelay)} (fixed at deployment)</div>
            </div>
          </SectionCard>
        )}
        <RecoveryPanel snap={snap} viewer={viewer} />

        {snap && (
          <SectionCard label="Emergency pause">
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge variant={snap.paused ? 'danger' : 'success'}>{snap.paused ? 'Paused' : 'Operating'}</Badge>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Pausing blocks payroll, module draws and other executions at once. Unpausing needs a quorum vote and the config timelock.</span>
              </div>
              {!snap.paused && <div><Button variant="danger" icon={<ShieldAlert size={14} />} disabled={!canPause} loading={pauseTx.busy} onClick={() => void pauseTx.run('Pause', { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName: 'pause' })}>Pause treasury</Button>{!canPause && <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10 }}>Only approvers and the guardian can pause.</span>}</div>}
              {snap.paused && <div><Button variant="secondary" disabled={!viewer.isProposer} loading={unpauseTx.busy} onClick={() => void proposeUnpause()}>Propose unpause</Button></div>}
              <TxStatus state={pauseTx.state} />
              <TxStatus state={unpauseTx.state} />
            </div>
          </SectionCard>
        )}

        <SectionCard label="Propose a governance change">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Notice tone="warning">If fewer approvers than the quorum can sign, ordinary governance is blocked. Council recovery is the only way out, and it needs 30 days of inactivity plus a 14 day timelock. Verify that every new approver controls their key before proposing.</Notice>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <Field label="Approvers (one per line)"><textarea style={{ ...inputStyle, height: 120, padding: 10 }} value={approversText} onChange={(e) => setApproversText(e.target.value)} /></Field>
              <Field label="Proposers (optional)"><textarea style={{ ...inputStyle, height: 120, padding: 10 }} value={proposersText} onChange={(e) => setProposersText(e.target.value)} /></Field>
            </div>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <Field label="Quorum"><input style={inputStyle} inputMode="numeric" value={quorum} onChange={(e) => setQuorum(e.target.value)} /></Field>
              <Field label="Guardian (blank disables)"><input style={inputStyle} value={guardian} onChange={(e) => setGuardian(e.target.value)} placeholder="0x…" /></Field>
              <Field label="Payroll delay (s)"><input style={inputStyle} inputMode="numeric" value={payrollDelay} onChange={(e) => setPayrollDelay(e.target.value)} /></Field>
              <Field label="Config delay (s)"><input style={inputStyle} inputMode="numeric" value={configDelay} onChange={(e) => setConfigDelay(e.target.value)} /></Field>
              <Field label="Expires in (hours)"><input style={inputStyle} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
            </div>
            {(check.added.length > 0 || check.removed.length > 0) && (
              <div style={{ fontSize: 12, ...mono }}>
                {check.added.length > 0 && <div style={{ color: 'var(--success)' }}>+ adds {check.added.length} approver(s)</div>}
                {check.removed.length > 0 && <div style={{ color: 'var(--danger)' }}>− removes {check.removed.length} approver(s)</div>}
                <div style={{ color: 'var(--muted)' }}>Executing a governance change voids every other pending proposal.</div>
              </div>
            )}
            {check.errors.map((e) => <Notice key={e} tone="danger">{e}</Notice>)}
            {check.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
            <label style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
              I confirmed that at least the quorum number of the new approvers control their keys and can sign.
            </label>
            <div><Button loading={govTx.busy} disabled={!canPropose} onClick={() => void propose()}>Propose change</Button>{snap && !viewer.isProposer && <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10 }}>Your wallet cannot create proposals.</span>}</div>
            <TxStatus state={govTx.state} />
          </div>
        </SectionCard>

        {snap && govProposals.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Governance proposals</h2>
            {govProposals.map((p) => <ProposalCard key={p.id.toString()} p={p} snapshot={snap} viewer={viewer} />)}
          </div>
        )}
      </V2Gate>
    </div>
  )
}
