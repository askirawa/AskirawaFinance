import { useState } from 'react'
import { erc20Abi } from 'viem'
import StatCard from '../ui/StatCard'
import SectionCard from '../ui/SectionCard'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import TxStatus from './TxStatus'
import { Field, Notice, grid, inputStyle, parseAmountInput, usdc } from './shared'
import { useTreasurySnapshot, useUsdcWallet } from '../../hooks/v2/useTreasuryV2'
import { useV2Tx } from '../../hooks/v2/useV2Tx'
import { TREASURY_V2_ABI } from '../../lib/v2/abi'
import { TREASURY_V2_ADDRESS, V2_USDC_ADDRESS } from '../../lib/v2/config'
import { formatDuration } from '../../lib/v2/status'

/** Treasury balance, governance summary and the USDC deposit flow (approve, then deposit). */
export default function TreasuryOverview() {
  const { data: snap, isLoading, error } = useTreasurySnapshot()
  const { data: wallet } = useUsdcWallet()
  const { state, run, busy } = useV2Tx()
  const [amount, setAmount] = useState('')
  const raw = parseAmountInput(amount)

  async function deposit() {
    if (!raw || !TREASURY_V2_ADDRESS || !V2_USDC_ADDRESS) return
    if ((wallet?.allowance ?? 0n) < raw) {
      const ok = await run('USDC approval', { address: V2_USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [TREASURY_V2_ADDRESS, raw] })
      if (!ok) return
    }
    const ok = await run('Deposit', { address: TREASURY_V2_ADDRESS, abi: TREASURY_V2_ABI, functionName: 'deposit', args: [raw] })
    if (ok) setAmount('')
  }

  if (error) return <Notice tone="danger">Could not read the treasury: {error instanceof Error ? error.message : 'RPC error'}. Check VITE_CHAIN_ID and VITE_TREASURY_ADDRESS.</Notice>

  const insufficient = raw !== null && wallet !== undefined && raw > wallet.balance
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={grid}>
        <StatCard label="Treasury balance (USDC)" value={snap ? usdc(snap.balance) : isLoading ? null : '—'} note="Read from the treasury contract" />
        <StatCard label="Quorum" value={snap ? `${snap.quorum} of ${snap.approvers.length}` : null} note={snap ? `Governance epoch ${snap.epoch}` : undefined} />
        <StatCard label="Timelocks" value={snap ? `${formatDuration(snap.payrollDelay)} / ${formatDuration(snap.configDelay)}` : null} note="Payroll / configuration" />
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--subtle)' }}>Status</span>
          {snap ? <Badge variant={snap.paused ? 'danger' : 'success'}>{snap.paused ? 'Paused' : 'Operating'}</Badge> : null}
          {snap?.paused && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Payments and module draws are blocked.</span>}
        </div>
      </div>

      <SectionCard label="Deposit USDC" subtitle="Anyone can fund the treasury. Withdrawals need approver quorum and the timelock.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <Field label="Amount (USDC)" hint={wallet ? `Wallet balance: ${usdc(wallet.balance)} USDC` : 'Connect a wallet to deposit'}>
                <input style={inputStyle} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>
            <Button loading={busy} disabled={!raw || insufficient || !wallet} onClick={() => void deposit()}>Deposit</Button>
          </div>
          {insufficient && <Notice tone="warning">Amount is more than your wallet USDC balance.</Notice>}
          <TxStatus state={state} />
        </div>
      </SectionCard>
    </div>
  )
}
