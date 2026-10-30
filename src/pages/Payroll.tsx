import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { isAddress, type Address } from 'viem'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import Button from '../components/ui/Button'
import V2Gate from '../components/v2/V2Gate'
import TxStatus from '../components/v2/TxStatus'
import TreasuryOverview from '../components/v2/TreasuryOverview'
import ProposalCard from '../components/v2/ProposalCard'
import { Field, Notice, inputStyle, memoToBytes32, parseAmountInput, usdc } from '../components/v2/shared'
import { useProposals, useTreasurySnapshot, useViewer } from '../hooks/v2/useTreasuryV2'
import { useV2Tx } from '../hooks/v2/useV2Tx'
import { TREASURY_V2_ABI } from '../lib/v2/abi'
import { TREASURY_V2_ADDRESS } from '../lib/v2/config'
import { ACTION, formatDuration, nowSeconds } from '../lib/v2/status'

interface Row { to: string; amount: string }
const MAX_ROWS = 100

/** Payroll is an all-or-nothing batch proposal: it needs quorum and the payroll timelock before it can pay. */
export default function Payroll() {
  const { data: snap } = useTreasurySnapshot()
  const viewer = useViewer(snap)
  const { data: proposals } = useProposals(snap)
  const { state, run, busy } = useV2Tx()
  const [rows, setRows] = useState<Row[]>([{ to: '', amount: '' }])
  const [memo, setMemo] = useState('')
  const [hours, setHours] = useState('72')

  const parsed = rows.map((r) => ({ to: r.to.trim(), amount: parseAmountInput(r.amount) }))
  const rowErrors = parsed.map((r) => (!isAddress(r.to) ? 'Enter a valid address' : r.to.toLowerCase() === TREASURY_V2_ADDRESS?.toLowerCase() ? 'Cannot pay the treasury itself' : r.amount === null ? 'Enter an amount above zero' : null))
  const total = parsed.reduce((s, r) => s + (r.amount ?? 0n), 0n)
  const h = Number(hours)
  const minHours = snap ? Math.ceil((snap.payrollDelay + 3600 + 300) / 3600) : 2
  const hoursOk = Number.isFinite(h) && h >= minHours && h <= 24 * 30 - 1
  const valid = rowErrors.every((e) => e === null) && rows.length > 0 && hoursOk && viewer.isProposer

  async function submit() {
    const items = parsed.map((r) => ({ to: r.to as Address, amount: r.amount as bigint }))
    const expiresAt = BigInt(nowSeconds() + Math.round(h * 3600))
    const ok = await run('Payroll proposal', { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName: 'proposePayroll', args: [items, expiresAt, memoToBytes32(memo)] })
    if (ok) { setRows([{ to: '', amount: '' }]); setMemo('') }
  }

  const payroll = (proposals ?? []).filter((p) => p.core.action === ACTION.Payroll)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Treasury" title="Payroll" subtitle="Propose a batch payment. Approvers vote, the timelock runs, then anyone can execute. The whole batch pays or none of it does." />
      <V2Gate>
        <TreasuryOverview />
        <SectionCard label="New payroll proposal">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
            {snap && !viewer.isProposer && <Notice tone="warning">Your wallet is not an approver or proposer, so it cannot create proposals.</Notice>}
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto', alignItems: 'end' }}>
                <Field label={i === 0 ? 'Recipient' : ''} hint={r.to && rowErrors[i] ? rowErrors[i] : undefined}>
                  <input style={inputStyle} placeholder="0x…" value={r.to} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                </Field>
                <Field label={i === 0 ? 'Amount (USDC)' : ''}>
                  <input style={inputStyle} inputMode="decimal" placeholder="0.00" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                </Field>
                <Button variant="ghost" size="md" icon={<Trash2 size={14} />} aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
              </div>
            ))}
            <div><Button variant="secondary" size="sm" icon={<Plus size={13} />} disabled={rows.length >= MAX_ROWS} onClick={() => setRows([...rows, { to: '', amount: '' }])}>Add recipient</Button></div>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <Field label="Memo (optional)" hint="Up to 31 characters are stored readable; longer text is stored as a hash.">
                <input style={inputStyle} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={120} />
              </Field>
              <Field label="Expires in (hours)" hint={`Minimum ${minHours}h: the ${snap ? formatDuration(snap.payrollDelay) : '…'} timelock plus one hour. Maximum 719h.`}>
                <input style={inputStyle} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
              </Field>
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Total {usdc(total)} USDC to {rows.length} recipient{rows.length === 1 ? '' : 's'}.
              {snap && total > snap.balance && ' This is more than the treasury currently holds: it cannot execute until the treasury is funded.'}
            </div>
            <div><Button loading={busy} disabled={!valid} onClick={() => void submit()}>Create proposal</Button></div>
            <TxStatus state={state} />
          </div>
        </SectionCard>
        {snap && payroll.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Payroll proposals</h2>
            {payroll.map((p) => <ProposalCard key={p.id.toString()} p={p} snapshot={snap} viewer={viewer} />)}
          </div>
        )}
      </V2Gate>
    </div>
  )
}
