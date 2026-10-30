import { ExternalLink } from 'lucide-react'
import type { TxState } from '../../hooks/v2/useV2Tx'
import { txUrl } from '../../lib/v2/config'
import { Notice } from './shared'

const TEXT: Record<string, string> = {
  simulating: 'Checking the transaction against current contract state…',
  wallet: 'Confirm in your wallet…',
  confirming: 'Submitted. Waiting for onchain confirmation…',
}

/** Honest transaction state: success appears only after a mined, successful receipt. */
export default function TxStatus({ state }: { state: TxState }) {
  if (state.phase === 'idle') return null
  const link = state.hash ? (
    <a href={txUrl(state.hash)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: 'inherit', textDecoration: 'underline' }}>
      View transaction <ExternalLink size={11} style={{ display: 'inline' }} />
    </a>
  ) : null
  if (state.phase === 'success') return <Notice tone="success">{state.label}: confirmed onchain.{link}</Notice>
  if (state.phase === 'failed') return <Notice tone="danger">{state.label} failed. {state.error}{link}</Notice>
  return <Notice>{TEXT[state.phase]}{link}</Notice>
}
