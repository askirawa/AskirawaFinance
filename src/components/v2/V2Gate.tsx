import type { ReactNode } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import Button from '../ui/Button'
import { Notice } from './shared'
import { V2_CHAIN, V2_CHAIN_ID, V2_IS_TESTNET, isTreasuryV2Configured } from '../../lib/v2/config'

/**
 * Wraps every treasury page. Without a configured treasury address nothing onchain is shown
 * (no placeholder data). A wrong network is flagged but reads still work.
 */
export default function V2Gate({ children }: { children: ReactNode }) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()

  if (!isTreasuryV2Configured) {
    return (
      <Notice tone="warning">
        <strong>Treasury v2 is not configured.</strong> Set <code>VITE_TREASURY_ADDRESS</code> (and{' '}
        <code>VITE_RECURRING_MODULE_ADDRESS</code>, <code>VITE_RECOVERY_ADDRESS</code>, <code>VITE_TREASURY_DEPLOY_BLOCK</code>) in <code>.env</code> after deploying to{' '}
        {V2_CHAIN.name}, then restart the dev server. Until then this page shows no treasury data. See docs/testnet-deployment-checklist.md.
      </Notice>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {V2_IS_TESTNET && <Notice>Network: {V2_CHAIN.name} (test funds only). Contracts are unaudited.</Notice>}
      {isConnected && chainId !== V2_CHAIN_ID && (
        <Notice tone="warning">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>Your wallet is on a different network. Switch to {V2_CHAIN.name} to send transactions.</span>
            <Button size="sm" variant="secondary" loading={isPending} onClick={() => switchChain({ chainId: V2_CHAIN_ID })}>Switch network</Button>
          </div>
        </Notice>
      )}
      {!isConnected && <Notice>Connect a wallet to vote, propose or execute. Reading works without one.</Notice>}
      {children}
    </div>
  )
}
