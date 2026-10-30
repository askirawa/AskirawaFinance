import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { erc20Abi, isAddress, type Address } from 'viem'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import V2Gate from '../components/v2/V2Gate'
import TxStatus from '../components/v2/TxStatus'
import ProposalCard from '../components/v2/ProposalCard'
import { AddressLink, Field, Notice, inputStyle, memoToBytes32, mono, parseAmountInput, usdc } from '../components/v2/shared'
import { useNow, useProposals, useTreasurySnapshot, useViewer } from '../hooks/v2/useTreasuryV2'
import { useModuleV2, type ScheduleView } from '../hooks/v2/useModuleV2'
import { useV2Tx } from '../hooks/v2/useV2Tx'
import { MODULE_ACTION, MODULE_V2_ABI, TREASURY_V2_ABI } from '../lib/v2/abi'
import { MODULE_V2_ADDRESS, TREASURY_V2_ADDRESS, V2_CHAIN_ID, V2_USDC_ADDRESS } from '../lib/v2/config'
import {
  ACTION, FREQUENCY_LABEL, MODULE_STATUS_LABEL, encodeResume, encodeScheduleParams, formatDuration, formatTimestamp, inspectScheduleExecution, nowSeconds,
} from '../lib/v2/status'

const ZERO = '0x0000000000000000000000000000000000000000' as Address

function ScheduleRow({ s, canStop, isApprover }: { s: ScheduleView; canStop: boolean; isApprover: boolean }) {
  const now = useNow()
  const { state, run, busy } = useV2Tx()
  const meta = MODULE_STATUS_LABEL[s.status] ?? MODULE_STATUS_LABEL[0]
  const call = (functionName: 'execute' | 'pause' | 'cancel', label: string) => {
    void run(label, { address: MODULE_V2_ADDRESS!, abi: MODULE_V2_ABI, functionName, args: [s.id] }, functionName === 'execute' ? inspectScheduleExecution : undefined)
  }
  const waiting = s.status === 1 && !s.isDue ? Math.max(Number(s.nextDue), Number(s.nextRetryAt)) - now : 0
  const restricted = s.executor !== ZERO && !isApprover
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ ...mono, fontSize: 12, color: 'var(--subtle)' }}>#{s.id.toString()}</span>
          <strong>{usdc(s.amount)} USDC {FREQUENCY_LABEL[s.frequency]?.toLowerCase()}</strong>
          <span style={{ fontSize: 12 }}>to <AddressLink address={s.recipient} /></span>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
        {s.status === 1 && <span style={{ ...mono, fontSize: 12, color: 'var(--muted)' }}>{s.isDue ? 'Due now' : `Due in ${formatDuration(waiting)}`}</span>}
      </div>
      <div style={{ ...mono, fontSize: 11, color: 'var(--subtle)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>Paid {s.executedCount}× · {usdc(s.totalPaid)} USDC</span>
        <span>Failures {s.failures}</span>
        <span>Next due {formatTimestamp(s.nextDue)}</span>
        {s.executor !== ZERO && <span>Executor <AddressLink address={s.executor} /></span>}
      </div>
      {s.status === 2 && <Notice tone="warning">Paused. Resuming needs a governance proposal (use "Propose resume" below).</Notice>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button size="sm" disabled={!s.isDue || restricted} loading={busy} onClick={() => call('execute', 'Execute payment')}>Execute payment</Button>
        {canStop && s.status === 1 && <Button size="sm" variant="secondary" loading={busy} onClick={() => call('pause', 'Pause schedule')}>Pause</Button>}
        {canStop && (s.status === 1 || s.status === 2) && <Button size="sm" variant="danger" loading={busy} onClick={() => call('cancel', 'Cancel schedule')}>Cancel</Button>}
      </div>
      {restricted && s.isDue && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Only the schedule's executor or an approver can run this one.</span>}
      <TxStatus state={state} />
    </div>
  )
}

export default function RecurringPayments() {
  const { data: snap } = useTreasurySnapshot()
  const viewer = useViewer(snap)
  const { data: proposals } = useProposals(snap)
  const { data: mod } = useModuleV2()
  const client = usePublicClient({ chainId: V2_CHAIN_ID })
  const cfgTx = useV2Tx(); const schedTx = useV2Tx(); const recoverTx = useV2Tx(); const resumeTx = useV2Tx()

  const { data: moduleBalance } = useQuery({
    queryKey: ['v2', 'moduleBalance', MODULE_V2_ADDRESS],
    enabled: !!client && !!MODULE_V2_ADDRESS && !!V2_USDC_ADDRESS,
    refetchInterval: 15_000,
    queryFn: () => client!.readContract({ address: V2_USDC_ADDRESS as Address, abi: erc20Abi, functionName: 'balanceOf', args: [MODULE_V2_ADDRESS as Address] }),
  })

  const [enable, setEnable] = useState(true)
  const [perTx, setPerTx] = useState('10'); const [windowMax, setWindowMax] = useState('50'); const [windowSecs, setWindowSecs] = useState('86400')
  const [recipient, setRecipient] = useState(''); const [amount, setAmount] = useState(''); const [frequency, setFrequency] = useState('1')
  const [start, setStart] = useState(''); const [end, setEnd] = useState(''); const [maxExec, setMaxExec] = useState('0')
  const [maxTotal, setMaxTotal] = useState(''); const [minBal, setMinBal] = useState(''); const [executor, setExecutor] = useState(''); const [memo, setMemo] = useState('')
  const [resumeId, setResumeId] = useState(''); const [skipMissed, setSkipMissed] = useState(true)

  if (!MODULE_V2_ADDRESS) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <PageHeader eyebrow="Treasury" title="Recurring Payments" subtitle="Budget-limited scheduled payments." />
        <V2Gate><Notice tone="warning">Set <code>VITE_RECURRING_MODULE_ADDRESS</code> to the deployed module address to use this page.</Notice></V2Gate>
      </div>
    )
  }

  const proposalExpiry = (delay: number) => BigInt(nowSeconds() + delay + 3600 + 600 + 24 * 3600)
  const perTxRaw = parseAmountInput(perTx), winRaw = parseAmountInput(windowMax)
  const cfgValid = viewer.isProposer && perTxRaw !== null && winRaw !== null && perTxRaw <= winRaw && Number(windowSecs) > 0 && Number(windowSecs) <= 31_536_000

  const amountRaw = parseAmountInput(amount)
  const toSecs = (v: string) => (v ? BigInt(Math.floor(new Date(v).getTime() / 1000)) : 0n)
  const schedErrors: string[] = []
  if (!isAddress(recipient)) schedErrors.push('Enter a valid recipient address.')
  if (amountRaw === null) schedErrors.push('Enter an amount above zero.')
  else if (snap?.module && amountRaw > snap.module.perTxMax) schedErrors.push(`Amount is above the module's per-payment limit (${usdc(snap.module.perTxMax)} USDC).`)
  if (executor && !isAddress(executor)) schedErrors.push('Executor must be an address or blank (anyone).')
  if (end && start && toSecs(end) <= toSecs(start)) schedErrors.push('End must be after start.')
  const maxTotalRaw = maxTotal ? parseAmountInput(maxTotal) : 0n
  const minBalRaw = minBal ? parseAmountInput(minBal) : 0n
  if (maxTotal && maxTotalRaw === null) schedErrors.push('Maximum total is invalid.')
  if (minBal && minBalRaw === null) schedErrors.push('Minimum treasury balance is invalid.')

  const modulePending = (proposals ?? []).filter((p) => p.core.action === ACTION.ModuleConfig || p.core.action === ACTION.ModuleAction)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Treasury" title="Recurring Payments" subtitle="Schedules are created and enabled by quorum. The treasury enforces the budget on every payment; the module cannot spend beyond it." />
      <V2Gate>
        <SectionCard label="Module and budget">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>Module <AddressLink address={MODULE_V2_ADDRESS} /></span>
              {snap?.module && <Badge variant={snap.module.enabled ? 'success' : 'warning'}>{snap.module.enabled ? 'Enabled' : 'Disabled'}</Badge>}
              {snap?.paused && <Badge variant="danger">Treasury paused</Badge>}
            </div>
            {snap?.module && (
              <div style={{ ...mono, fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>Per payment ≤ {usdc(snap.module.perTxMax)}</span>
                <span>Per window ≤ {usdc(snap.module.windowMax)} / {formatDuration(snap.module.windowLength)}</span>
                <span>Window remaining {usdc(snap.module.remaining)} USDC</span>
              </div>
            )}
            {mod && <div style={{ ...mono, fontSize: 12, color: 'var(--muted)' }}>Retry delay {formatDuration(mod.retryDelay)} · auto-pause after {mod.maxFailures} failures · {mod.scheduleCount.toString()} schedule(s)</div>}
            {snap?.module && !snap.module.enabled && <Notice>The module is disabled. No schedule can pay until governance enables it (below).</Notice>}
            {moduleBalance !== undefined && moduleBalance > 0n && <Notice tone="warning">The module holds {usdc(moduleBalance)} USDC of its own. Return it to the treasury with a quorum proposal.</Notice>}
          </div>
        </SectionCard>

        <SectionCard label="Enable or change the module budget (governance)">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <Field label="Action"><select style={inputStyle} value={enable ? 'on' : 'off'} onChange={(e) => setEnable(e.target.value === 'on')}><option value="on">Enable</option><option value="off">Disable</option></select></Field>
              <Field label="Per payment max (USDC)"><input style={inputStyle} value={perTx} onChange={(e) => setPerTx(e.target.value)} /></Field>
              <Field label="Per window max (USDC)"><input style={inputStyle} value={windowMax} onChange={(e) => setWindowMax(e.target.value)} /></Field>
              <Field label="Window length (s)"><input style={inputStyle} value={windowSecs} onChange={(e) => setWindowSecs(e.target.value)} /></Field>
            </div>
            <div><Button loading={cfgTx.busy} disabled={!cfgValid || !snap} onClick={() => void cfgTx.run('Module configuration proposal', { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName: 'proposeModuleConfig', args: [MODULE_V2_ADDRESS, enable, perTxRaw, winRaw, Number(windowSecs), proposalExpiry(snap!.configDelay), memoToBytes32('module-config')] })}>Propose</Button></div>
            <TxStatus state={cfgTx.state} />
          </div>
        </SectionCard>

        <SectionCard label="New schedule (governance)">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              <Field label="Recipient"><input style={inputStyle} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" /></Field>
              <Field label="Amount per payment (USDC)"><input style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Frequency"><select style={inputStyle} value={frequency} onChange={(e) => setFrequency(e.target.value)}>{FREQUENCY_LABEL.map((f, i) => <option key={f} value={i}>{f}</option>)}</select></Field>
              <Field label="Start (blank = on approval)"><input type="datetime-local" style={inputStyle} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="End (optional)"><input type="datetime-local" style={inputStyle} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
              <Field label="Max payments (0 = none)"><input style={inputStyle} value={maxExec} onChange={(e) => setMaxExec(e.target.value)} /></Field>
              <Field label="Max total USDC (optional)"><input style={inputStyle} value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} /></Field>
              <Field label="Keep treasury ≥ (USDC, optional)"><input style={inputStyle} value={minBal} onChange={(e) => setMinBal(e.target.value)} /></Field>
              <Field label="Executor (blank = anyone)"><input style={inputStyle} value={executor} onChange={(e) => setExecutor(e.target.value)} placeholder="0x…" /></Field>
              <Field label="Memo"><input style={inputStyle} value={memo} maxLength={31} onChange={(e) => setMemo(e.target.value)} /></Field>
            </div>
            {schedErrors.map((e) => <Notice key={e} tone="danger">{e}</Notice>)}
            <div><Button loading={schedTx.busy} disabled={!viewer.isProposer || schedErrors.length > 0 || !snap || !snap.module?.enabled} onClick={() => void schedTx.run('Schedule proposal', { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName: 'proposeModuleAction', args: [MODULE_V2_ADDRESS, MODULE_ACTION.CREATE_SCHEDULE, encodeScheduleParams({ recipient: recipient as Address, amount: amountRaw!, frequency: Number(frequency), startTime: toSecs(start), endTime: toSecs(end), maxExecutions: Number(maxExec) || 0, maxTotal: maxTotalRaw ?? 0n, minTreasuryBalanceAfter: minBalRaw ?? 0n, executor: (executor || ZERO) as Address, memoRef: memoToBytes32(memo) }), 0n, proposalExpiry(snap!.payrollDelay), memoToBytes32(memo)] })}>Propose schedule</Button></div>
            <TxStatus state={schedTx.state} />
          </div>
        </SectionCard>

        <SectionCard label="Resume a paused schedule or return module funds (governance)">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Schedule id"><input style={{ ...inputStyle, width: 120 }} value={resumeId} onChange={(e) => setResumeId(e.target.value)} /></Field>
              <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', height: 40 }}><input type="checkbox" checked={skipMissed} onChange={(e) => setSkipMissed(e.target.checked)} /> Skip missed periods</label>
              <Button variant="secondary" loading={resumeTx.busy} disabled={!viewer.isProposer || !/^\d+$/.test(resumeId) || !snap} onClick={() => void resumeTx.run('Resume proposal', { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName: 'proposeModuleAction', args: [MODULE_V2_ADDRESS, MODULE_ACTION.RESUME_SCHEDULE, encodeResume(BigInt(resumeId), skipMissed), 0n, proposalExpiry(snap!.payrollDelay), memoToBytes32('resume')] })}>Propose resume</Button>
              <Button variant="secondary" loading={recoverTx.busy} disabled={!viewer.isProposer || !moduleBalance || !snap} onClick={() => void recoverTx.run('Return-funds proposal', { address: TREASURY_V2_ADDRESS!, abi: TREASURY_V2_ABI, functionName: 'proposeModuleAction', args: [MODULE_V2_ADDRESS, MODULE_ACTION.RECOVER_FUNDS, '0x', 0n, proposalExpiry(snap!.payrollDelay), memoToBytes32('return-funds')] })}>Propose return of module funds</Button>
            </div>
            <TxStatus state={resumeTx.state} /><TxStatus state={recoverTx.state} />
          </div>
        </SectionCard>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Schedules</h2>
          {mod && mod.schedules.length === 0 && <Notice>No schedules yet. Create one with a proposal above.</Notice>}
          {mod?.schedules.map((s) => <ScheduleRow key={s.id.toString()} s={s} canStop={viewer.isApprover || viewer.isGuardian} isApprover={viewer.isApprover} />)}
        </div>

        {snap && modulePending.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Module proposals</h2>
            {modulePending.map((p) => <ProposalCard key={p.id.toString()} p={p} snapshot={snap} viewer={viewer} />)}
          </div>
        )}
      </V2Gate>
    </div>
  )
}
