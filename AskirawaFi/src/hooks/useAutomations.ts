import { useReadContract, useReadContracts } from 'wagmi'
import {
  AUTOMATION_REGISTRY_ADDRESS,
  AUTOMATION_REGISTRY_ABI,
  AUTOMATION_REGISTRY_CHAIN_ID,
  parseAutomationTuple,
  type AutomationRecord,
} from '../lib/contract'

/** Reads the total count of automations on-chain */
export function useAutomationCount() {
  return useReadContract({
    address: AUTOMATION_REGISTRY_ADDRESS,
    abi: AUTOMATION_REGISTRY_ABI,
    functionName: 'automationCount',
    chainId: AUTOMATION_REGISTRY_CHAIN_ID,
  })
}

/** Reads all automations for a given owner address */
export function useUserAutomations(ownerAddress: string | undefined): {
  automations: AutomationRecord[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
} {
  const {
    data: countData,
    isLoading: countLoading,
    error: countError,
    refetch: refetchCount,
  } = useAutomationCount()

  const totalCount = countData ? Number(countData) : 0

  // Build array of calls: getAutomation(1), getAutomation(2), ...
  const calls = Array.from({ length: totalCount }, (_, i) => ({
    address: AUTOMATION_REGISTRY_ADDRESS as `0x${string}`,
    abi: AUTOMATION_REGISTRY_ABI,
    functionName: 'getAutomation' as const,
    args: [BigInt(i + 1)] as [bigint],
    chainId: AUTOMATION_REGISTRY_CHAIN_ID,
  }))

  const {
    data: automationData,
    isLoading: automationsLoading,
    error: automationsError,
    refetch: refetchAutomations,
  } = useReadContracts({
    contracts: calls,
    query: { enabled: totalCount > 0 },
  })

  const automations: AutomationRecord[] = []

  if (automationData && ownerAddress) {
    for (const result of automationData) {
      if (result.status === 'success' && result.result) {
        const parsed = parseAutomationTuple(result.result)
        if (parsed.owner.toLowerCase() === ownerAddress.toLowerCase()) {
          automations.push(parsed)
        }
      }
    }
  }

  return {
    automations,
    isLoading: countLoading || automationsLoading,
    error: (countError || automationsError),
    refetch: () => {
      void refetchCount()
      void refetchAutomations()
    },
  }
}
