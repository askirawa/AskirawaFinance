/** Dry-runs the request against the contract before anything is signed. Sends nothing. */
import { useAccount, usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { Address, PublicClient } from 'viem'
import { Loader2 } from 'lucide-react'
import Button from '../ui/Button'
import { TREASURY_CHAIN_ID } from '../../chain/config'
import { describeError } from '../../chain/format'
import { Notice, TAP } from './formUi'

export type PreflightCheck = (ctx: { client: PublicClient; account: Address }) => Promise<void>

export default function Preflight({ check, deps, okText }: { check: PreflightCheck; deps: string; okText: string }) {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: TREASURY_CHAIN_ID })
  const query = useQuery({
    queryKey: ['preflight', address, deps],
    enabled: !!address && !!client,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      await check({ client: client!, account: address! })
      return true
    },
  })

  if (!address) {
    return <Notice title="Contract check not run yet">Connect your wallet to ask the contract whether it would accept this request. Nothing is sent.</Notice>
  }
  if (query.isError) {
    return (
      <Notice tone="danger" title="The contract would refuse this request">
        <div>{describeError(query.error).message}</div>
        <Button variant="secondary" size="sm" className={`${TAP} mt-2`} arrow={false} onClick={() => void query.refetch()}>Check again</Button>
      </Notice>
    )
  }
  if (query.isSuccess && !query.isFetching) {
    return <Notice tone="success" title="The contract accepts this request">{okText}</Notice>
  }
  return (
    <Notice title="Checking with the contract">
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Loader2 size={14} className="animate-spin" /> Running a dry run. Nothing is sent.</span>
    </Notice>
  )
}

/** Same deadline rule as useTreasuryActions: 7 days, longer only when the safety wait needs it, never over 30 days. */
export async function deadlineFor(client: PublicClient, delaySeconds: number): Promise<bigint> {
  const block = await client.getBlock()
  const day = 86_400n
  const wanted = 7n * day
  const minimum = BigInt(delaySeconds) + 3_600n + 60n
  const lifetime = wanted > minimum ? wanted : minimum
  const cap = 30n * day - 60n
  return block.timestamp + (lifetime > cap ? cap : lifetime)
}
