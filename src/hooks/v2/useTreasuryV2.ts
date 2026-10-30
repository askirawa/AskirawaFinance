/**
 * Treasury v2 reads. Everything comes from contract state through the public RPC;
 * no value is cached outside React Query and nothing is simulated.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { erc20Abi, type Abi, type Address } from 'viem'
import { TREASURY_V2_ABI } from '../../lib/v2/abi'
import {
  MODULE_V2_ADDRESS, TREASURY_V2_ADDRESS, V2_CHAIN_ID, V2_USDC_ADDRESS,
} from '../../lib/v2/config'
import {
  PSTATUS, decodePayload, type ProposalCore, type ProposalDetails, type Viewer,
} from '../../lib/v2/status'

const POLL_MS = 15_000
const MAX_PROPOSALS = 60

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export interface TreasurySnapshot {
  balance: bigint
  epoch: bigint
  paused: boolean
  pauseCount: bigint
  nextProposalId: bigint
  quorum: number
  payrollDelay: number
  configDelay: number
  minConfigDelay: number
  /** Payroll and module draws are blocked until this time after a recovery; 0 when none. */
  coolingEnd: bigint
  /** Time of the last executed proposal or recovery; gates recovery. */
  lastActivityAt: bigint
  guardian: Address
  approvers: readonly Address[]
  proposers: readonly Address[]
  module: { enabled: boolean; perTxMax: bigint; windowMax: bigint; windowLength: number; windowSpent: bigint; remaining: bigint } | null
}

export function useTreasurySnapshot() {
  const client = usePublicClient({ chainId: V2_CHAIN_ID })
  return useQuery({
    queryKey: ['v2', 'snapshot', TREASURY_V2_ADDRESS, MODULE_V2_ADDRESS],
    enabled: !!client && !!TREASURY_V2_ADDRESS,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<TreasurySnapshot> => {
      const address = TREASURY_V2_ADDRESS as Address
      const abi: Abi = TREASURY_V2_ABI
      const rc = <F extends string>(functionName: F, args?: readonly unknown[]) =>
        client!.readContract({ address, abi, functionName, args }) as Promise<never>
      const [balance, epoch, paused, pauseCount, nextProposalId, quorum, payrollDelay, configDelay, minConfigDelay, guardian, approvers, proposers, coolingEnd, lastActivityAt] =
        await Promise.all([
          rc('balance') as Promise<bigint>, rc('currentEpoch') as Promise<bigint>, rc('paused') as Promise<boolean>,
          rc('pauseCount') as Promise<bigint>, rc('nextProposalId') as Promise<bigint>, rc('quorum') as Promise<number>,
          rc('payrollDelay') as Promise<number>, rc('configDelay') as Promise<number>, rc('MIN_CONFIG_DELAY') as Promise<number>,
          rc('guardian') as Promise<Address>, rc('approvers') as Promise<readonly Address[]>, rc('proposers') as Promise<readonly Address[]>,
          rc('coolingEnd') as Promise<bigint>, rc('lastActivityAt') as Promise<bigint>,
        ])
      let module: TreasurySnapshot['module'] = null
      if (MODULE_V2_ADDRESS) {
        const [m, remaining] = await Promise.all([
          rc('modules', [MODULE_V2_ADDRESS]) as Promise<readonly [boolean, string, bigint, bigint, number, bigint, bigint]>,
          rc('moduleSpendRemaining', [MODULE_V2_ADDRESS]) as Promise<bigint>,
        ])
        module = { enabled: m[0], perTxMax: m[2], windowMax: m[3], windowLength: m[4], windowSpent: m[6], remaining }
      }
      return { balance, epoch, paused, pauseCount, nextProposalId, quorum, payrollDelay, configDelay, minConfigDelay, coolingEnd, lastActivityAt, guardian, approvers, proposers, module }
    },
  })
}

/** Roles of the connected wallet under the CURRENT governance epoch. */
export function useViewer(snapshot: TreasurySnapshot | undefined): Viewer {
  const { address } = useAccount()
  const lower = address?.toLowerCase()
  const has = (list: readonly Address[] | undefined) => !!lower && !!list?.some((a) => a.toLowerCase() === lower)
  const g = snapshot?.guardian
  return {
    address,
    isApprover: has(snapshot?.approvers),
    isProposer: has(snapshot?.approvers) || has(snapshot?.proposers),
    isGuardian: !!lower && !!g && g !== '0x0000000000000000000000000000000000000000' && g.toLowerCase() === lower,
  }
}

export interface ProposalView {
  id: bigint
  core: ProposalCore
  derived: number
  myVote: number
  details: ProposalDetails
}

export function useProposals(snapshot: TreasurySnapshot | undefined) {
  const client = usePublicClient({ chainId: V2_CHAIN_ID })
  const { address } = useAccount()
  const next = snapshot?.nextProposalId
  return useQuery({
    queryKey: ['v2', 'proposals', TREASURY_V2_ADDRESS, next?.toString(), address],
    enabled: !!client && !!TREASURY_V2_ADDRESS && next !== undefined,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<ProposalView[]> => {
      const treasury = TREASURY_V2_ADDRESS as Address
      const last = (next as bigint) - 1n
      const first = last > BigInt(MAX_PROPOSALS) ? last - BigInt(MAX_PROPOSALS) + 1n : 1n
      const ids: bigint[] = []
      for (let i = last; i >= first && i >= 1n; i--) ids.push(i)
      const abi: Abi = TREASURY_V2_ABI
      const read = (functionName: string, args: readonly unknown[]) =>
        client!.readContract({ address: treasury, abi, functionName, args }) as Promise<never>
      return Promise.all(
        ids.map(async (id): Promise<ProposalView> => {
          const [core, derived, myVote] = await Promise.all([
            read('getProposal', [id]) as Promise<ProposalCore>,
            read('status', [id]) as Promise<number>,
            address ? (read('voteOf', [id, address]) as Promise<number>) : Promise.resolve(0),
          ])
          let details: ProposalDetails
          if (core.action === 1) {
            const items = (await read('getPayroll', [id, 0n, 100n])) as readonly { to: Address; amount: bigint }[]
            details = { kind: 'payroll', items }
          } else {
            details = decodePayload(core.action, await read('getPayload', [id]))
          }
          return { id, core, derived: Number(derived), myVote: Number(myVote), details }
        }),
      )
    },
  })
}

export function useUsdcWallet() {
  const client = usePublicClient({ chainId: V2_CHAIN_ID })
  const { address } = useAccount()
  return useQuery({
    queryKey: ['v2', 'usdc', address, TREASURY_V2_ADDRESS],
    enabled: !!client && !!address && !!V2_USDC_ADDRESS && !!TREASURY_V2_ADDRESS,
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const [balance, allowance] = await Promise.all([
        client!.readContract({ address: V2_USDC_ADDRESS as Address, abi: erc20Abi, functionName: 'balanceOf', args: [address as Address] }),
        client!.readContract({ address: V2_USDC_ADDRESS as Address, abi: erc20Abi, functionName: 'allowance', args: [address as Address, TREASURY_V2_ADDRESS as Address] }),
      ])
      return { balance, allowance }
    },
  })
}

export function openProposals(list: ProposalView[] | undefined): ProposalView[] {
  return (list ?? []).filter((p) => [PSTATUS.Pending, PSTATUS.Approved, PSTATUS.Executable].includes(p.derived as never))
}
