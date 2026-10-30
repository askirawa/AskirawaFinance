/**
 * Bounded event scan for treasury + module history.
 * Starts at the recorded deployment block (never block 0), scans in small ranges, remembers the last
 * scanned block so refreshes only fetch new blocks, and reports progress as facts.
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Address, Hash } from 'viem'
import { MODULE_V2_ABI, RECOVERY_V2_ABI, TREASURY_V2_ABI } from '../../lib/v2/abi'
import { DEPLOY_BLOCK, MODULE_V2_ADDRESS, RECOVERY_V2_ADDRESS, TREASURY_V2_ADDRESS, V2_CHAIN_ID } from '../../lib/v2/config'

const CHUNK = 2_000n
const MAX_SPAN = 200_000n
const FALLBACK_LOOKBACK = 5_000n
const CONCURRENCY = 4

export interface V2Event {
  source: 'treasury' | 'module' | 'recovery'
  name: string
  args: Record<string, unknown>
  blockNumber: bigint
  logIndex: number
  txHash: Hash
  timestamp?: number
}

export interface EventScan {
  events: V2Event[]
  fromBlock: bigint
  scannedTo: bigint
  head: bigint
  truncated: boolean
  deployBlockKnown: boolean
}

interface Cache { key: string; from: bigint; scannedTo: bigint; events: V2Event[]; ts: Map<bigint, number>; truncated: boolean }
let cache: Cache | null = null

const treasuryEvents = TREASURY_V2_ABI.filter((x) => x.type === 'event')
const moduleEvents = MODULE_V2_ABI.filter((x) => x.type === 'event')
const recoveryEvents = RECOVERY_V2_ABI.filter((x) => x.type === 'event')

export function useV2Events() {
  const client = usePublicClient({ chainId: V2_CHAIN_ID })
  return useQuery({
    queryKey: ['v2', 'events', TREASURY_V2_ADDRESS, MODULE_V2_ADDRESS, RECOVERY_V2_ADDRESS],
    enabled: !!client && !!TREASURY_V2_ADDRESS,
    refetchInterval: 30_000,
    queryFn: async (): Promise<EventScan> => {
      const c = client!
      const head = await c.getBlockNumber()
      const key = `${TREASURY_V2_ADDRESS}-${MODULE_V2_ADDRESS}-${RECOVERY_V2_ADDRESS}`
      if (!cache || cache.key !== key) {
        let from = DEPLOY_BLOCK ?? (head > FALLBACK_LOOKBACK ? head - FALLBACK_LOOKBACK : 0n)
        let truncated = false
        if (head - from > MAX_SPAN) { from = head - MAX_SPAN; truncated = true }
        cache = { key, from, scannedTo: from - 1n, events: [], ts: new Map(), truncated }
      }
      const state = cache
      const ranges: [bigint, bigint][] = []
      for (let s = state.scannedTo + 1n; s <= head; s += CHUNK) ranges.push([s, s + CHUNK - 1n > head ? head : s + CHUNK - 1n])

      const fetchRange = async ([fromBlock, toBlock]: [bigint, bigint]): Promise<V2Event[]> => {
        const out: V2Event[] = []
        const t = await c.getLogs({ address: TREASURY_V2_ADDRESS as Address, events: treasuryEvents, fromBlock, toBlock })
        for (const l of t) out.push({ source: 'treasury', name: (l as { eventName: string }).eventName, args: ((l as { args?: Record<string, unknown> }).args ?? {}), blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash })
        if (MODULE_V2_ADDRESS) {
          const m = await c.getLogs({ address: MODULE_V2_ADDRESS, events: moduleEvents, fromBlock, toBlock })
          for (const l of m) out.push({ source: 'module', name: (l as { eventName: string }).eventName, args: ((l as { args?: Record<string, unknown> }).args ?? {}), blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash })
        }
        if (RECOVERY_V2_ADDRESS) {
          const r = await c.getLogs({ address: RECOVERY_V2_ADDRESS, events: recoveryEvents, fromBlock, toBlock })
          for (const l of r) out.push({ source: 'recovery', name: (l as { eventName: string }).eventName, args: ((l as { args?: Record<string, unknown> }).args ?? {}), blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash })
        }
        return out
      }

      let scannedTo = state.scannedTo
      for (let i = 0; i < ranges.length; i += CONCURRENCY) {
        const batch = ranges.slice(i, i + CONCURRENCY)
        const results = await Promise.all(batch.map(fetchRange))
        for (const r of results) state.events.push(...r)
        scannedTo = batch[batch.length - 1]?.[1] ?? scannedTo
        state.scannedTo = scannedTo
      }

      // block timestamps for the newest events only
      const recent = [...state.events].sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, 80)
      await Promise.all(
        [...new Set(recent.map((e) => e.blockNumber))]
          .filter((b) => !state.ts.has(b))
          .map(async (b) => { state.ts.set(b, Number((await c.getBlock({ blockNumber: b })).timestamp)) }),
      )
      const events = state.events
        .map((e) => ({ ...e, timestamp: state.ts.get(e.blockNumber) }))
        .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)))
      return { events, fromBlock: state.from, scannedTo: state.scannedTo, head, truncated: state.truncated, deployBlockKnown: DEPLOY_BLOCK !== null }
    },
  })
}
