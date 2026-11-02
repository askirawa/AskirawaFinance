import { useState } from 'react'
import type { Navigate } from '../nav'
import { useAccount, useSwitchChain } from 'wagmi'
import { Archive, Coins, FileCode2, Globe, Settings2, Shield, Wallet, Wrench } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import { SetupNotice, Who } from '../components/flow/shared'
import { AddressLine, Panel, Row, duration, note } from '../components/pagekit/Panel'
import {
  DEPLOY_BLOCK, NETWORK, RECOVERY_ADDRESS, RECURRING_MODULE_ADDRESS, TREASURY_ADDRESS, TREASURY_CHAIN_ID, addressUrl,
} from '../chain/config'
import { dateTime } from '../chain/format'
import { useTreasuryOverview } from '../chain/hooks'

/** Documentation constant only. This app never calls it. */
const LEGACY_REGISTRY = '0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434'

const ENV_VARS: [string, string][] = [
  ['VITE_CHAIN_ID', 'Which network the treasury runs on: 5042 for Arc Mainnet or 5042002 for Arc Testnet.'],
  ['VITE_TREASURY_ADDRESS', 'Address of the treasury contract.'],
  ['VITE_RECURRING_MODULE_ADDRESS', 'Address of the recurring payments module.'],
  ['VITE_RECOVERY_ADDRESS', 'Address of the recovery contract.'],
  ['VITE_TREASURY_DEPLOY_BLOCK', 'Block where the treasury was deployed. History is read from here.'],
]

export default function Settings({ onNavigate }: { onNavigate?: Navigate }) {
  const overview = useTreasuryOverview()
  const { address, chainId, chain, isConnected } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()
  const ready = overview.state === 'ready'
  const [nowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)))
  const cooling = overview.coolingEnd > nowSeconds
  const walletNetwork = chain?.name ?? (chainId ? `Chain ID ${chainId}` : 'Unknown')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Reference" title="Settings"
        subtitle="Which network and contracts this app is connected to, and the rules the treasury enforces. Read-only." />
      <SetupNotice overview={overview} />

      <Panel icon={Globe} title="Network">
        <Row label="Network">{NETWORK.name}</Row>
        <Row label="Chain ID"><span className="mono">{NETWORK.id}</span></Row>
        <Row label="USDC contract"><AddressLine address={NETWORK.usdcAddress} /> <span style={{ color: 'var(--muted)' }}>({NETWORK.usdcDecimals} decimals)</span></Row>
        <Row label="Explorer"><a href={NETWORK.explorerBase} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink-2)', textDecoration: 'underline' }}>{NETWORK.explorerBase}</a></Row>
      </Panel>

      <Panel icon={Wallet} title="Wallet">
        {!isConnected || !address ? <p style={{ margin: 0, color: 'var(--muted)' }}>No wallet connected. Use Connect Company Wallet in the top bar.</p> : (
          <>
            <Row label="Connected address"><Who address={address} /></Row>
            <Row label="Wallet network">
              {walletNetwork} {chainId === TREASURY_CHAIN_ID ? <Badge variant="success">Correct network</Badge> : <Badge variant="warning">Different network</Badge>}
            </Row>
            {chainId !== TREASURY_CHAIN_ID && (
              <div style={{ marginTop: 12 }}>
                <p style={{ ...note, margin: '0 0 10px' }}>The network is never switched automatically. Nothing is sent until you choose to switch.</p>
                <button type="button" disabled={isPending} onClick={() => switchChain({ chainId: TREASURY_CHAIN_ID })}
                  style={{ minHeight: 44, padding: '0 16px', background: 'var(--ink)', color: 'var(--bg)', border: '1px solid var(--ink)', cursor: 'pointer', fontWeight: 600, opacity: isPending ? 0.5 : 1 }}>
                  {isPending ? 'Switching…' : `Switch to ${NETWORK.name}`}
                </button>
                {error && <p role="alert" style={{ ...note, color: 'var(--danger)' }}>Your wallet did not switch networks. You can switch it in the wallet itself.</p>}
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel icon={Shield} title="Treasury rules" subtitle="Enforced by the treasury contract.">
        {!ready ? <p style={{ margin: 0, color: 'var(--muted)' }}>Rules appear once the treasury is set up and loaded.</p> : (
          <>
            <Row label="Approval rule">{overview.quorum} of {overview.approvers.length} approvers must approve every payment</Row>
            <Row label="Payment safety wait">{duration(overview.payrollDelay)} between approval and payment</Row>
            <Row label="Rules-change safety wait">{duration(overview.configDelay)} between approval and a change of approvers or rules</Row>
            <Row label="Emergency pause contact">{overview.guardian ? <Who address={overview.guardian} /> : 'No emergency pause contact is set'}</Row>
            <Row label="Treasury state">{overview.paused ? <Badge variant="danger">Paused</Badge> : <Badge variant="success">Active</Badge>}</Row>
            {cooling && <Row label="Cooling period">Payments are blocked until {dateTime(overview.coolingEnd)}</Row>}
          </>
        )}
      </Panel>

      <Panel icon={FileCode2} title="Contracts">
        <Row label="Treasury"><AddressLine address={TREASURY_ADDRESS} /></Row>
        <Row label="Recurring payments"><AddressLine address={RECURRING_MODULE_ADDRESS} /></Row>
        <Row label="Recovery"><AddressLine address={RECOVERY_ADDRESS ?? overview.recovery} /></Row>
      </Panel>

      <Panel icon={Archive} title="History">
        {DEPLOY_BLOCK !== null
          ? <p style={{ margin: 0 }}>History is read from block <span className="mono">{DEPLOY_BLOCK.toString()}</span>, where the treasury was deployed.</p>
          : <p style={{ margin: 0 }}>Not configured: history is limited to recent blocks.</p>}
      </Panel>

      <Panel icon={Coins} title="Fees">
        <p style={{ margin: 0 }}>Network fees are paid in USDC by the wallet that signs each transaction.</p>
      </Panel>

      <Panel icon={Settings2} title="Legacy Automation Registry">
        <Row label="Address">
          <a href={addressUrl(LEGACY_REGISTRY)} target="_blank" rel="noopener noreferrer" className="mono" style={{ color: 'var(--ink-2)', textDecoration: 'underline', fontSize: 13 }}>{LEGACY_REGISTRY}</a>
        </Row>
        <p style={note}>A legacy record store of automation entries. It does not move money, and this app does not use it to make payments.</p>
        {onNavigate && (
          <button type="button" onClick={() => onNavigate('automations')}
                  style={{ marginTop: 10, minHeight: 44, padding: '0 14px', background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: 'pointer' }}>
            Open the legacy registry viewer (read only)
          </button>
        )}
      </Panel>

      <Panel icon={Wrench} title="Advanced">
        <details>
          <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Configuration variables</summary>
          <p style={note}>These build-time variables point the app at a deployment. Values are not shown here.</p>
          <dl style={{ margin: '8px 0 0' }}>
            {ENV_VARS.map(([name, meaning]) => (
              <div key={name} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <dt className="mono" style={{ fontSize: 13, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{name}</dt>
                <dd style={{ margin: '2px 0 0', color: 'var(--muted)', fontSize: 13 }}>{meaning}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Panel>
    </div>
  )
}
