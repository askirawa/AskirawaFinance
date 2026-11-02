/**
 * Onchain history. Scans contract logs forward from the deployment block in bounded chunks and keeps
 * only new blocks on each refresh. If the deployment block is unknown the scan is limited to recent
 * blocks and the UI says so. It never starts from block zero.
 */
import { useEffect, useRef, useState } from 'react'
import { usePublicClient } from 'wagmi'
import type { Address, Hex } from 'viem'
import { parseAbiItem } from 'viem'
import {
  DEPLOY_BLOCK, RECURRING_MODULE_ADDRESS, TREASURY_ADDRESS, TREASURY_CHAIN_ID, isTreasuryConfigured,
} from './config'

const CHUNK = 2_000n
const RECENT_WINDOW = 5_000n
const POLL_MS = 20_000
const MAX_EVENTS = 400

export type ActivityKind =
  | 'funds-added' | 'request' | 'vote' | 'payment' | 'cancelled' | 'rejected'
  | 'schedule-payment' | 'schedule-failed' | 'paused' | 'resumed'

export interface ActivityItem {
  key: string
  kind: ActivityKind
  blockNumber: bigint
  logIndex: number
  txHash: Hex
  requestId?: number
  scheduleId?: number
  actor?: Address
  counterparty?: Address
  amount?: bigint
  detail?: string
  timestamp?: number
}

const treasuryEvents = [
  parseAbiItem('event Deposited(address indexed from, uint256 amount)'),
  parseAbiItem('event Proposed(uint256 indexed proposalId, uint256 indexed epoch, address indexed proposer, uint8 action, uint64 expiresAt, uint96 totalAmount, bytes32 payloadHash, bytes32 memoRef)'),
  parseAbiItem('event Voted(uint256 indexed proposalId, address indexed voter, uint8 vote, uint16 approvals, uint16 rejections)'),
  parseAbiItem('event Executed(uint256 indexed proposalId, uint8 action, uint96 totalAmount)'),
  parseAbiItem('event Cancelled(uint256 indexed proposalId, address indexed by)'),
  parseAbiItem('event Rejected(uint256 indexed proposalId)'),
  parseAbiItem('event Paused(address indexed by)'),
  parseAbiItem('event Unpaused(uint256 indexed proposalId)'),
] as const

const moduleEvents = [
  parseAbiItem('event ScheduleExecuted(uint256 indexed scheduleId, uint256 periodIndex, address indexed recipient, uint96 amount, uint64 dueAt, uint64 executedAt, address indexed executor, uint96 totalPaid)'),
  parseAbiItem('event ExecutionFailed(uint256 indexed scheduleId, uint256 periodIndex, uint8 reasonCode, uint8 failures, uint64 nextRetryAt)'),
] as const

export interface HistoryState {
  items: ActivityItem[]
  /** Total USDC paid out by confirmed payroll and recurring payments. */
  totalPaid: bigint
  scannedTo: bigint | null
  head: bigint | null
  complete: boolean
  limited: boolean
  error: string | null
}

const EMPTY: HistoryState = { items: [], totalPaid: 0n, scannedTo: null, head: null, complete: false, limited: false, error: null }

export function useHistory(): HistoryState {
  const client = usePublicClient({ chainId: TREASURY_CHAIN_ID })
  const [state, setState] = useState<HistoryState>(EMPTY)
  const store = useRef<{ items: Map<string, ActivityItem>; next: bigint | null; totalPaid: bigint }>({
    items: new Map(), next: null, totalPaid: 0n,
  })

  useEffect(() => {
    if (!isTreasuryConfigured || !client) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async () => {
      try {
        const head = await client.getBlockNumber()
        const limited = DEPLOY_BLOCK === null
        const start = DEPLOY_BLOCK ?? (head > RECENT_WINDOW ? head - RECENT_WINDOW : 0n)
        let from = store.current.next ?? start
        while (from <= head && !cancelled) {
          const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n
          const [tLogs, mLogs] = await Promise.all([
            client.getLogs({ address: TREASURY_ADDRESS!, events: treasuryEvents, fromBlock: from, toBlock: to }),
            RECURRING_MODULE_ADDRESS
              ? client.getLogs({ address: RECURRING_MODULE_ADDRESS, events: moduleEvents, fromBlock: from, toBlock: to })
              : Promise.resolve([]),
          ])
          for (const log of tLogs) ingest(store.current, log, 'treasury')
          for (const log of mLogs) ingest(store.current, log, 'module')
          store.current.next = to + 1n
          from = to + 1n
          if (!cancelled) publish(head, limited, to >= head)
        }
        if (!cancelled) {
          await attachTimestamps(client, store.current.items)
          publish(head, limited, true)
        }
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Could not read history.' }))
      }
      if (!cancelled) timer = setTimeout(() => void run(), POLL_MS)
    }

    const publish = (head: bigint, limited: boolean, complete: boolean) => {
      const items = [...store.current.items.values()]
        .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1))
        .slice(0, MAX_EVENTS)
      setState({
        items, totalPaid: store.current.totalPaid, scannedTo: store.current.next ? store.current.next - 1n : null,
        head, complete, limited, error: null,
      })
    }

    void run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [client])

  return state
}

type RawLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint; logIndex: number; transactionHash: Hex }

function ingest(store: { items: Map<string, ActivityItem>; totalPaid: bigint }, log: RawLog, source: 'treasury' | 'module') {
  const key = `${log.transactionHash}-${log.logIndex}`
  if (store.items.has(key)) return
  const a = log.args
  const base = { key, blockNumber: log.blockNumber, logIndex: log.logIndex, txHash: log.transactionHash }
  let item: ActivityItem | null = null
  switch (log.eventName) {
    case 'Deposited': item = { ...base, kind: 'funds-added', actor: a.from as Address, amount: a.amount as bigint }; break
    case 'Proposed': item = { ...base, kind: 'request', requestId: Number(a.proposalId), actor: a.proposer as Address, amount: a.totalAmount as bigint, detail: String(a.action) }; break
    case 'Voted': item = { ...base, kind: 'vote', requestId: Number(a.proposalId), actor: a.voter as Address, detail: Number(a.vote) === 1 ? 'approved' : 'rejected' }; break
    case 'Executed':
      if (Number(a.action) === 1) store.totalPaid += a.totalAmount as bigint
      item = { ...base, kind: 'payment', requestId: Number(a.proposalId), amount: a.totalAmount as bigint, detail: String(a.action) }
      break
    case 'Cancelled': item = { ...base, kind: 'cancelled', requestId: Number(a.proposalId), actor: a.by as Address }; break
    case 'Rejected': item = { ...base, kind: 'rejected', requestId: Number(a.proposalId) }; break
    case 'Paused': item = { ...base, kind: 'paused', actor: a.by as Address }; break
    case 'Unpaused': item = { ...base, kind: 'resumed', requestId: Number(a.proposalId) }; break
    case 'ScheduleExecuted':
      store.totalPaid += a.amount as bigint
      item = { ...base, kind: 'schedule-payment', scheduleId: Number(a.scheduleId), counterparty: a.recipient as Address, amount: a.amount as bigint, actor: a.executor as Address }
      break
    case 'ExecutionFailed': item = { ...base, kind: 'schedule-failed', scheduleId: Number(a.scheduleId), detail: String(a.reasonCode) }; break
    default: break
  }
  if (item && source) store.items.set(key, item)
}

async function attachTimestamps(client: NonNullable<ReturnType<typeof usePublicClient>>, items: Map<string, ActivityItem>) {
  const recent = [...items.values()].filter((i) => i.timestamp === undefined).sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1)).slice(0, 60)
  const blocks = [...new Set(recent.map((i) => i.blockNumber))]
  const stamps = new Map<bigint, number>()
  await Promise.all(blocks.map(async (n) => {
    try { stamps.set(n, Number((await client.getBlock({ blockNumber: n })).timestamp)) } catch { /* shown without a date */ }
  }))
  for (const item of recent) {
    const t = stamps.get(item.blockNumber)
    if (t !== undefined) item.timestamp = t
  }
}
