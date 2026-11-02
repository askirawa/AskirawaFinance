/** Step 4 of the payroll wizard: send the request and show what the contract says afterwards. */
import { useAccount } from 'wagmi'
import { CheckCircle2 } from 'lucide-react'
import Button from '../ui/Button'
import { ApprovalMeter, ConnectPrompt, TxPanel } from '../flow/shared'
import { useRequests } from '../../chain/hooks'
import { usdc } from '../../chain/format'
import type { TxState } from '../../chain/useTx'
import type { Navigate } from '../../nav'
import { Details, Notice, TAP } from './formUi'
import { NETWORK, TREASURY_ADDRESS, addressUrl } from '../../chain/config'

interface Props {
  name: string
  count: number
  total: bigint
  quorum: number
  canCreate: boolean
  canSubmit: boolean
  state: TxState
  busy: boolean
  onSubmit: () => void
  onDismiss: () => void
  onNavigate: Navigate
  onAnother: () => void
}

export default function PayrollSubmit(p: Props) {
  const { address } = useAccount()
  const { items } = useRequests()
  const confirmed = p.state.phase === 'confirmed'
  const requestId = p.state.proposalId
  const live = requestId !== undefined ? items.find((r) => r.id === requestId) : undefined

  if (confirmed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 14, padding: 18, border: '1px solid var(--success-border)', background: 'var(--success-dim)' }}>
          <CheckCircle2 size={22} style={{ color: 'var(--success)', flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {requestId !== undefined ? `Request #${requestId} submitted` : 'Request submitted'}
            </h2>
            <p style={{ margin: '6px 0 12px', color: 'var(--ink-2)', fontSize: 14 }}>
              {p.name.trim()}: {usdc(p.total)} USDC to {p.count} recipient{p.count === 1 ? '' : 's'}. Nobody has been paid yet.
            </p>
            {live
              ? <ApprovalMeter approvals={live.approvals} quorum={live.quorum} />
              : <div style={{ fontSize: 13, color: 'var(--muted)' }}>Waiting for approval (a quorum of {p.quorum} approvers is needed). Reading the latest approval count from the contract…</div>}
          </div>
        </div>
        <TxPanel state={p.state} doneText="The request is now recorded on the treasury contract." />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button className={TAP} onClick={() => p.onNavigate('approvals', requestId !== undefined ? { requestId } : undefined)}>Track in Approvals</Button>
          <Button variant="secondary" className={TAP} arrow={false} onClick={p.onAnother}>Create another</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18 }}>Send for approval</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 14 }}>
          You are asking approvers to pay {usdc(p.total)} USDC to {p.count} recipient{p.count === 1 ? '' : 's'}. Your wallet will ask you to confirm.
        </p>
      </div>
      {!address && <ConnectPrompt text="Connect your company wallet to send this request for approval." />}
      {address && !p.canCreate && (
        <Notice tone="danger" title="This wallet cannot create payment requests">
          Only approvers and proposers of this treasury can create a payroll. Switch to an authorised wallet.
        </Notice>
      )}
      {address && (
        <div>
          <Button className={TAP} loading={p.busy} disabled={!p.canSubmit || p.busy} onClick={p.onSubmit}>Request Approval</Button>
        </div>
      )}
      <TxPanel state={p.state} onDismiss={p.onDismiss} />
      <Details>
        <div>Network: {NETWORK.name}</div>
        {TREASURY_ADDRESS && <div>Treasury contract: <a href={addressUrl(TREASURY_ADDRESS)} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{TREASURY_ADDRESS}</a></div>}
        <div>Action: propose payroll. The request stores each recipient and amount on-chain.</div>
      </Details>
    </div>
  )
}
