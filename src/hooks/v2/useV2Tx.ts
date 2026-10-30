/**
 * useV2Tx: simulate -> sign -> wait for the receipt -> verify status.
 * A write is reported as successful ONLY after a mined receipt with status "success".
 * Reverts, wallet rejections and timeouts surface as an explicit failed state.
 */
import { useCallback, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Abi, Address, Hash, TransactionReceipt } from 'viem'
import { V2_CHAIN_ID } from '../../lib/v2/config'
import { describeError } from '../../lib/v2/status'

export type TxPhase = 'idle' | 'simulating' | 'wallet' | 'confirming' | 'success' | 'failed'

export interface TxState {
  phase: TxPhase
  label: string
  hash?: Hash
  error?: string
}

export interface TxRequest {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

const IDLE: TxState = { phase: 'idle', label: '' }

export function useV2Tx() {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: V2_CHAIN_ID })
  const { data: walletClient } = useWalletClient({ chainId: V2_CHAIN_ID })
  const { switchChainAsync } = useSwitchChain()
  const queryClient = useQueryClient()
  const [state, setState] = useState<TxState>(IDLE)

  const reset = useCallback(() => setState(IDLE), [])

  /** Resolves true only when the transaction was mined successfully. */
  const run = useCallback(
    async (label: string, req: TxRequest, inspect?: (receipt: TransactionReceipt) => string | null): Promise<boolean> => {
      if (!address || !publicClient) {
        setState({ phase: 'failed', label, error: 'Connect your wallet first.' })
        return false
      }
      try {
        if (chainId !== V2_CHAIN_ID) await switchChainAsync({ chainId: V2_CHAIN_ID })
        if (!walletClient) throw new Error('Wallet is not ready on the right network. Try again.')
        setState({ phase: 'simulating', label })
        const { request } = await publicClient.simulateContract({ ...req, account: address } as never)
        setState({ phase: 'wallet', label })
        const hash = await walletClient.writeContract(request as never)
        setState({ phase: 'confirming', label, hash })
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
        if (receipt.status !== 'success') {
          const msg = 'The transaction was mined but reverted onchain. Nothing changed.'
          setState({ phase: 'failed', label, hash, error: msg })
          toast.error(`${label} failed`, { description: msg })
          return false
        }
        // Some calls succeed at the EVM level but report a business failure in their logs
        // (for example a recurring payment that was skipped). Those are NOT successes.
        const softFailure = inspect?.(receipt) ?? null
        if (softFailure) {
          setState({ phase: 'failed', label, hash, error: softFailure })
          toast.error(`${label} did not complete`, { description: softFailure })
          await queryClient.invalidateQueries({ queryKey: ['v2'] })
          return false
        }
        setState({ phase: 'success', label, hash })
        toast.success(`${label} confirmed`)
        await queryClient.invalidateQueries({ queryKey: ['v2'] })
        return true
      } catch (err) {
        const msg = describeError(err)
        setState((s) => ({ phase: 'failed', label, hash: s.hash, error: msg }))
        toast.error(`${label} failed`, { description: msg })
        return false
      }
    },
    [address, chainId, publicClient, queryClient, switchChainAsync, walletClient],
  )

  const busy = state.phase === 'simulating' || state.phase === 'wallet' || state.phase === 'confirming'
  return { state, run, reset, busy }
}
