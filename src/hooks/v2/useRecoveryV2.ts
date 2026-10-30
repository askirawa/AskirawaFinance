/** TreasuryRecovery reads: council, inactivity gate and recent recoveries. */
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import type { Abi, Address } from 'viem'
import { RECOVERY_V2_ABI } from '../../lib/v2/abi'
import { RECOVERY_V2_ADDRESS, V2_CHAIN_ID } from '../../lib/v2/config'
import { decodeRecoveryPayload, type RecoveryPayloadView, type RecoveryRecord } from '../../lib/v2/status'

export interface RecoveryView {
  id: bigint
  record: RecoveryRecord
  payload: RecoveryPayloadView | null
  myCouncilVote: boolean
  myVeto: boolean
}

export interface RecoveryInfo {
  council: readonly Address[]
  threshold: number
  eligibleAt: bigint
  lastResetAt: bigint
  activeId: bigint
  recoveries: RecoveryView[]
  isCouncilMember: boolean
}

const MAX_RECOVERIES = 8

export function useRecoveryV2() {
  const client = usePublicClient({ chainId: V2_CHAIN_ID })
  const { address } = useAccount()
  return useQuery({
    queryKey: ['v2', 'recovery', RECOVERY_V2_ADDRESS, address],
    enabled: !!client && !!RECOVERY_V2_ADDRESS,
    refetchInterval: 15_000,
    queryFn: async (): Promise<RecoveryInfo> => {
      const target = RECOVERY_V2_ADDRESS as Address
      const abi: Abi = RECOVERY_V2_ABI
      const read = (functionName: string, args?: readonly unknown[]) =>
        client!.readContract({ address: target, abi, functionName, args }) as Promise<never>
      const [council, threshold, eligibleAt, lastResetAt, activeId, next] = await Promise.all([
        read('councilMembers') as Promise<readonly Address[]>, read('councilThreshold') as Promise<number>,
        read('recoveryEligibleAt') as Promise<bigint>, read('lastResetAt') as Promise<bigint>,
        read('activeRecoveryId') as Promise<bigint>, read('nextRecoveryId') as Promise<bigint>,
      ])
      const ids: bigint[] = []
      for (let i = next - 1n; i >= 1n && ids.length < MAX_RECOVERIES; i--) ids.push(i)
      const recoveries = await Promise.all(ids.map(async (id): Promise<RecoveryView> => {
        const [r, payload, voted, vetoed] = await Promise.all([
          read('recoveries', [id]) as Promise<readonly unknown[]>,
          read('getRecoveryPayload', [id]) as Promise<`0x${string}`>,
          address ? (read('councilVoted', [id, address]) as Promise<boolean>) : Promise.resolve(false),
          address ? (read('vetoVoted', [id, address]) as Promise<boolean>) : Promise.resolve(false),
        ])
        const record: RecoveryRecord = {
          status: Number(r[0]), epoch: r[1] as bigint, vetoQuorum: Number(r[2]), initiator: r[3] as Address, initiatedAt: r[4] as bigint,
          approvedAt: r[5] as bigint, executableAt: r[6] as bigint, expiresAt: r[7] as bigint, approvals: Number(r[8]),
          vetoes: Number(r[9]), payloadHash: r[10] as `0x${string}`,
        }
        return { id, record, payload: decodeRecoveryPayload(payload), myCouncilVote: voted, myVeto: vetoed }
      }))
      const mine = !!address && council.some((m) => m.toLowerCase() === address.toLowerCase())
      return { council, threshold, eligibleAt, lastResetAt, activeId, recoveries, isCouncilMember: mine }
    },
  })
}
