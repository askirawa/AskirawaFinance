import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, Wallet, XCircle } from 'lucide-react'
import Badge from '../ui/Badge'
import { NETWORK, TREASURY_CHAIN_ID, addressUrl, txUrl } from '../../chain/config'
import { SCHEDULE_STATUS, shortAddress, statusViewFor, type Tone } from '../../chain/format'
import type { TxState } from '../../chain/useTx'
import type { TreasuryOverview } from '../../chain/hooks'
import { useLabels } from '../../chain/addressBook'

const MONO = "'JetBrains Mono', monospace"

export function toneToBadge(tone: Tone): 'success' | 'warning' | 'danger' | 'neutral' {
  if (tone === 'success') return 'success'
  if (tone === 'warning') return 'warning'
  if (tone === 'danger') return 'danger'
  return 'neutral'
}

export function RequestStatus({ status, action = 1 }: { status: number; action?: number }) {
  const view = statusViewFor(status, action)
  return <Badge variant={toneToBadge(view.tone)}>{view.label}</Badge>
}

export function ScheduleStatusBadge({ status }: { status: number }) {
  const view = SCHEDULE_STATUS[status] ?? SCHEDULE_STATUS[0]
  return <Badge variant={toneToBadge(view.tone)}>{view.label}</Badge>
}

/** A person or wallet: saved name first, short address always visible, full address on hover. */
export function Who({ address }: { address: string }) {
  const { nameOf } = useLabels()
  const name = nameOf(address)
  return (
    <a href={addressUrl(address)} target="_blank" rel="noopener noreferrer" title={address}
       style={{ color: 'inherit', textDecoration: 'none', overflowWrap: 'anywhere' }}>
      {name ? <><strong style={{ fontWeight: 600 }}>{name}</strong> <span className="mono" style={{ color: 'var(--subtle)', fontSize: 12 }}>{shortAddress(address)}</span></>
        : <span className="mono" style={{ fontSize: 13 }}>{shortAddress(address)}</span>}
    </a>
  )
}

export function ExplorerLink({ hash, label = 'View receipt' }: { hash: string; label?: string }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer"
       style={{ color: 'var(--ink-2)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, textDecoration: 'underline' }}>
      {label} <ExternalLink size={13} />
    </a>
  )
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol style={{ display: 'flex', gap: 0, listStyle: 'none', padding: 0, margin: '0 0 24px', flexWrap: 'wrap' }} aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={label} aria-current={active ? 'step' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 120px', minWidth: 110, padding: '10px 0',
                       borderTop: `2px solid ${done || active ? 'var(--ink)' : 'var(--border)'}`, marginRight: 8,
                       color: active ? 'var(--ink)' : done ? 'var(--ink-2)' : 'var(--subtle)' }}>
            <span style={{ fontFamily: MONO, fontSize: 11 }}>{String(i + 1).padStart(2, '0')}</span>
            <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Honest transaction feedback. "Confirmed" appears only after the receipt and the state check pass. */
export function TxPanel({ state, onDismiss, doneText }: { state: TxState; onDismiss?: () => void; doneText?: string }) {
  if (state.phase === 'idle' && !state.message) return null
  const box = (tone: 'info' | 'success' | 'danger' | 'neutral') => ({
    display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', margin: '16px 0',
    background: `var(--${tone === 'neutral' ? 'surface-muted' : tone + '-dim'})`,
    border: `1px solid var(--${tone === 'neutral' ? 'border' : tone + '-border'})`,
  }) as React.CSSProperties
  if (state.phase === 'wallet') {
    return <div role="status" style={box('info')}><Loader2 size={18} className="animate-spin" /><div><strong>Confirm in your wallet</strong><div style={{ color: 'var(--muted)', fontSize: 13 }}>Nothing has been sent yet. Review and sign the request in your wallet.</div></div></div>
  }
  if (state.phase === 'pending') {
    return <div role="status" style={box('info')}><Loader2 size={18} className="animate-spin" /><div><strong>Submitted. Waiting for network confirmation</strong><div style={{ color: 'var(--muted)', fontSize: 13 }}>This is not final yet. Do not treat it as done.</div>{state.hash && <ExplorerLink hash={state.hash} label="Track transaction" />}</div></div>
  }
  if (state.phase === 'confirmed') {
    return <div role="status" style={box('success')}><CheckCircle2 size={18} style={{ color: 'var(--success)' }} /><div style={{ flex: 1 }}><strong>Confirmed on-chain</strong>{doneText && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{doneText}</div>}{state.hash && <ExplorerLink hash={state.hash} />}</div>{onDismiss && <button onClick={onDismiss} style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}>Dismiss</button>}</div>
  }
  if (state.phase === 'failed') {
    return <div role="alert" style={box('danger')}><XCircle size={18} style={{ color: 'var(--danger)' }} /><div style={{ flex: 1 }}><strong>This did not go through</strong><div style={{ color: 'var(--ink-2)', fontSize: 13 }}>{state.message}</div>{state.hash && <ExplorerLink hash={state.hash} label="View transaction" />}</div>{onDismiss && <button onClick={onDismiss} style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}>Dismiss</button>}</div>
  }
  return <div role="status" style={box('neutral')}><Info size={18} /><div style={{ fontSize: 13 }}>{state.message}</div></div>
}

export function NetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  if (!isConnected || chainId === TREASURY_CHAIN_ID) return null
  return (
    <div role="alert" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px', marginBottom: 20, background: 'var(--warning-dim)', border: '1px solid var(--warning-border)', color: 'var(--warning)' }}>
      <AlertTriangle size={16} />
      <span style={{ flex: 1, minWidth: 200, fontSize: 14 }}>Your wallet is on a different network. This treasury runs on {NETWORK.name}. Nothing is sent until you switch.</span>
      <button onClick={() => switchChain({ chainId: TREASURY_CHAIN_ID })} disabled={isPending}
              style={{ minHeight: 44, padding: '0 16px', background: 'transparent', border: '1px solid var(--warning-border)', color: 'var(--warning)', cursor: 'pointer', fontWeight: 600 }}>
        {isPending ? 'Switching…' : `Switch to ${NETWORK.name}`}
      </button>
    </div>
  )
}

export function ConnectPrompt({ text = 'Connect your company wallet to continue.' }: { text?: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      <Wallet size={26} style={{ color: 'var(--ink)', margin: '0 auto 12px' }} />
      <p style={{ margin: '0 0 16px', color: 'var(--ink-2)' }}>{text}</p>
      <ConnectKitButton label="Connect Company Wallet" />
    </div>
  )
}

/** Honest status for a treasury that is not ready. Returns null when everything is fine. */
export function SetupNotice({ overview }: { overview: TreasuryOverview }) {
  if (overview.state === 'ready') return null
  const copy: Record<string, { title: string; body: string }> = {
    unconfigured: { title: 'Treasury is not set up yet', body: `No treasury contract is connected to this app, so there are no balances, requests or payments to show. The app needs the treasury address for ${NETWORK.name} (see Settings, Advanced, for the setting names). Nothing on this screen is simulated.` },
    loading: { title: 'Loading treasury', body: 'Reading the treasury from the network.' },
    'no-contract': { title: 'No treasury found at the configured address', body: `The configured address has no contract on ${NETWORK.name}. Check that the app points at the right network and address (see Settings).` },
    error: { title: 'Could not read the treasury', body: 'The network did not answer. Your data is safe on-chain. Try again in a moment.' },
  }
  const c = copy[overview.state]
  return (
    <div role="status" style={{ display: 'flex', gap: 12, padding: '16px 18px', marginBottom: 20, background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      {overview.state === 'loading' ? <Loader2 size={18} className="animate-spin" /> : <Info size={18} />}
      <div><strong style={{ display: 'block', marginBottom: 2 }}>{c.title}</strong><span style={{ color: 'var(--muted)', fontSize: 14 }}>{c.body}</span></div>
    </div>
  )
}

/** `open` = the request can still collect approvals. For closed requests the "more needed" hint would be misleading. */
export function ApprovalMeter({ approvals, quorum, open = true }: { approvals: number; quorum: number; open?: boolean }) {
  const pct = quorum > 0 ? Math.min(100, Math.round((approvals / quorum) * 100)) : 0
  return (
    <div aria-label={`${approvals} of ${quorum} approvals`}>
      <div style={{ height: 6, background: 'var(--border)' }}><div style={{ width: `${pct}%`, height: '100%', background: approvals >= quorum ? 'var(--success)' : 'var(--ink)' }} /></div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{approvals} of {quorum} approvals{open && approvals < quorum ? ` (${quorum - approvals} more needed)` : ''}</div>
    </div>
  )
}
