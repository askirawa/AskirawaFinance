import { useState } from 'react'
import Button from '../ui/Button'
import { useTreasuryActions } from '../../chain/actions'
import { parseUsdc } from '../../onchain-money'
import { ConnectPrompt, TxPanel } from '../flow/shared'
import { useAccount } from 'wagmi'

function parse(text: string): { value: bigint | null; error: string | null } {
  if (!text.trim()) return { value: null, error: null }
  try {
    const v = parseUsdc(text.trim())
    return v > 0n ? { value: v, error: null } : { value: null, error: 'Enter an amount greater than zero.' }
  } catch {
    return { value: null, error: 'Enter a valid amount, for example 1000 or 2500.50 (up to 6 decimals).' }
  }
}

/** Deposit USDC into the treasury. Allowance (if needed) then deposit: two wallet confirmations. */
export default function AddFunds({ onClose }: { onClose: () => void }) {
  const { address } = useAccount()
  const actions = useTreasuryActions()
  const { state, reset, busy } = actions.tx
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const { value, error } = parse(text)

  const submit = async () => {
    if (value === null) return
    setRunning(true)
    try {
      await actions.deposit(value)
    } finally {
      setRunning(false)
    }
  }

  const midway = running && state.phase === 'confirmed'

  return (
    <div style={{ marginTop: 20, padding: 20, background: 'var(--surface-muted)', border: '1px solid var(--border-strong)', color: 'var(--ink)' }}>
      <h3 className="display" style={{ margin: '0 0 6px', fontSize: 18 }}>Add funds</h3>
      <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 14, maxWidth: 520 }}>
        Add USDC from your wallet to the company treasury. Your wallet will ask you to confirm twice: first to allow the treasury to receive this exact amount, then to deposit it. If you already allowed this amount, only the deposit is needed.
      </p>
      {!address ? <ConnectPrompt text="Connect your company wallet to add funds." /> : (
        <>
          <label htmlFor="fund-amount">Amount (USDC)</label>
          <input id="fund-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text}
                 onChange={(e) => { setText(e.target.value); if (state.phase !== 'idle') reset() }}
                 disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'fund-error' : undefined} style={{ maxWidth: 320 }} />
          {error && <p id="fund-error" role="alert" style={{ margin: '8px 0 0', color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <Button className="min-h-[44px]" disabled={value === null || busy} loading={busy} onClick={() => void submit()}>Add funds</Button>
            <Button className="min-h-[44px]" variant="ghost" disabled={busy} onClick={onClose}>Close</Button>
          </div>
          {midway
            ? <div role="status" style={{ margin: '16px 0 0', fontSize: 14, color: 'var(--ink-2)' }}>Step 1 of 2 done: allowance confirmed. Now confirm the deposit in your wallet.</div>
            : <TxPanel state={state} onDismiss={reset} doneText="Your deposit is in the treasury. The balance above updates from the network." />}
        </>
      )}
    </div>
  )
}
