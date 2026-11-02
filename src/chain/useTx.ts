/**
 * Transaction lifecycle for every write in the app.
 *
 *   idle -> wallet (waiting for signature) -> pending (submitted, not final) -> confirmed | failed
 *
 * "confirmed" is only reached after the receipt shows success AND (when supplied) a follow-up read of the
 * contract proves the expected state change. Nothing is marked done from the wallet prompt alone.
 */
import { useCallback, useState } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { decodeEventLog, type Abi, type Hex, type TransactionReceipt } from 'viem'
import { treasuryAbi } from './abi'
import { TREASURY_CHAIN_ID, NETWORK } from './config'
import { describeError } from './format'
import { forgetPendingTx, rememberPendingTx } from './pendingTx'

export type TxPhase = 'idle' | 'wallet' | 'pending' | 'confirmed' | 'failed'

export interface TxState {
  phase: TxPhase
  hash?: Hex
  message?: string
  /** True when the user simply declined in the wallet. Not an error. */
  cancelled?: boolean
  /** Request number read from the Proposed event of a confirmed proposal. */
  proposalId?: number
}

export interface TxRequest {
  address: `0x${string}`
  abi: Abi
  functionName: string
  args: readonly unknown[]
  /** Re-reads the contract after the receipt. Return true only when the expected state is visible. */
  verify?: () => Promise<boolean>
}

export function proposalIdFromReceipt(receipt: TransactionReceipt): number | undefined {
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({ abi: treasuryAbi, data: log.data, topics: log.topics })
      if (event.eventName === 'Proposed') return Number(event.args.proposalId)
    } catch {
      // not a treasury event
    }
  }
  return undefined
}

export function useTx() {
  const { address, chainId } = useAccount()
  const client = usePublicClient({ chainId: TREASURY_CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [state, setState] = useState<TxState>({ phase: 'idle' })

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  const send = useCallback(
    async (req: TxRequest): Promise<TxState> => {
      const fail = (message: string, extra: Partial<TxState> = {}): TxState => {
        const next: TxState = { phase: 'failed', message, ...extra }
        setState(next)
        return next
      }
      if (!address) return fail('Connect your company wallet first.')
      if (chainId !== TREASURY_CHAIN_ID) return fail(`Switch your wallet to ${NETWORK.name} first. The app never switches networks on its own.`)
      if (!client) return fail('Network connection is not ready. Try again in a moment.')

      let hash: Hex
      try {
        // Dry-run first so contract rules are explained in plain language before the wallet opens.
        await client.simulateContract({
          account: address,
          address: req.address,
          abi: req.abi,
          functionName: req.functionName,
          args: req.args,
        } as never)
        setState({ phase: 'wallet' })
        hash = await writeContractAsync({
          address: req.address,
          abi: req.abi,
          functionName: req.functionName,
          args: req.args,
          chainId: TREASURY_CHAIN_ID,
        })
      } catch (e) {
        const { message, cancelled } = describeError(e)
        if (cancelled) {
          const next: TxState = { phase: 'idle', message, cancelled: true }
          setState(next)
          return next
        }
        return fail(message)
      }

      setState({ phase: 'pending', hash })
      rememberPendingTx(hash)
      try {
        const receipt = await client.waitForTransactionReceipt({ hash })
        forgetPendingTx(hash)
        if (receipt.status !== 'success') {
          return fail('The network rejected this transaction. Nothing changed.', { hash })
        }
        if (req.verify && !(await req.verify())) {
          return fail('The transaction was mined but the treasury state did not change as expected. Check the transaction details.', { hash })
        }
        await queryClient.invalidateQueries()
        const next: TxState = { phase: 'confirmed', hash, proposalId: proposalIdFromReceipt(receipt) }
        setState(next)
        return next
      } catch (e) {
        // The hash stays remembered: the transaction may still be mined, and a reload can show its real state.
        return fail(describeError(e).message, { hash })
      }
    },
    [address, chainId, client, queryClient, writeContractAsync],
  )

  return { state, send, reset, busy: state.phase === 'wallet' || state.phase === 'pending' }
}
