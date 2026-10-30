/** RecurringPaymentModule reads: schedules with their live due state. */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Abi, Address } from 'viem'
import { MODULE_V2_ABI } from '../../lib/v2/abi'
import { MODULE_V2_ADDRESS, V2_CHAIN_ID } from '../../lib/v2/config'

export interface ScheduleView {
  id: bigint
  recipient: Address
  amount: bigint
  startTime: bigint
  nextDue: bigint
  nextRetryAt: bigint
  endTime: bigint
  frequency: number
  status: number
  executedCount: number
  maxExecutions: number
  failures: number
  totalPaid: bigint
  maxTotal: bigint
  minTreasuryBalanceAfter: bigint
  executor: Address
  memoRef: `0x${string}`
  isDue: boolean
}

export interface ModuleInfo {
  retryDelay: number
  maxFailures: number
  scheduleCount: bigint
  schedules: ScheduleView[]
}

const MAX_SCHEDULES = 60

export function useModuleV2() {
  const client = usePublicClient({ chainId: V2_CHAIN_ID })
  return useQuery({
    queryKey: ['v2', 'module', MODULE_V2_ADDRESS],
    enabled: !!client && !!MODULE_V2_ADDRESS,
    refetchInterval: 15_000,
    queryFn: async (): Promise<ModuleInfo> => {
      const address = MODULE_V2_ADDRESS as Address
      const abi: Abi = MODULE_V2_ABI
      const read = (functionName: string, args?: readonly unknown[]) =>
        client!.readContract({ address, abi, functionName, args }) as Promise<never>
      const [retryDelay, maxFailures, scheduleCount] = await Promise.all([
        read('retryDelay') as Promise<number>, read('maxFailures') as Promise<number>, read('scheduleCount') as Promise<bigint>,
      ])
      const ids: bigint[] = []
      for (let i = scheduleCount; i >= 1n && ids.length < MAX_SCHEDULES; i--) ids.push(i)
      const schedules = await Promise.all(
        ids.map(async (id): Promise<ScheduleView> => {
          const [s, due] = await Promise.all([read('getSchedule', [id]) as Promise<Omit<ScheduleView, 'id' | 'isDue'>>, read('isDue', [id]) as Promise<boolean>])
          return { ...s, id, isDue: due }
        }),
      )
      return { retryDelay, maxFailures, scheduleCount, schedules }
    },
  })
}
