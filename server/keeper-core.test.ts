import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbiParameters, type Address, type Hash, type Hex } from 'viem'
import { MODULE_V2_ABI } from '../src/lib/v2/abi'
import { runOnce, summarize, withRetry, type KeeperClient, type KeeperConfig, type KeeperReceipt } from './keeper-core'

const TREASURY = '0x1000000000000000000000000000000000000001' as Address
const MODULE = '0x2000000000000000000000000000000000000002' as Address
const KEEPER = '0x3000000000000000000000000000000000000003' as Address
const OTHER = '0x4000000000000000000000000000000000000004' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const CODE = '0x6080604052' as Hex
const HASH = ('0x' + 'ab'.repeat(32)) as Hash

const cfg: KeeperConfig = { treasury: TREASURY, module: MODULE, keeper: KEEPER, maxSchedulesPerPoll: 20, maxScan: 500, retryMax: 1, receiptTimeoutMs: 50, retryBackoffMs: 1 }
const log = () => undefined

interface Sched { amount: bigint; executor?: Address; minAfter?: bigint; due?: boolean }
interface World {
  paused?: boolean; coolingEnd?: bigint; enabled?: boolean; codehash?: Hex; code?: Hex; balance?: bigint; perTxMax?: bigint; windowMax?: bigint
  windowSpent?: bigint; keeperIsApprover?: boolean; schedules: Sched[]
  receipt?: (id: bigint) => KeeperReceipt | 'timeout'; simulateFails?: boolean; readFailsTimes?: number
}

function receiptWith(name: 'ScheduleExecuted' | 'ExecutionFailed' | 'ScheduleAutoPaused' | 'ScheduleCompleted', id: bigint): KeeperReceipt {
  let topics: readonly Hex[]
  let data: Hex = '0x'
  if (name === 'ScheduleExecuted') {
    topics = encodeEventTopics({ abi: MODULE_V2_ABI, eventName: name, args: { scheduleId: id, recipient: OTHER, executor: KEEPER } })
    data = encodeAbiParameters(parseAbiParameters('uint256, uint96, uint64, uint64, uint96'), [0n, 5n, 1n, 2n, 5n])
  } else if (name === 'ExecutionFailed') {
    topics = encodeEventTopics({ abi: MODULE_V2_ABI, eventName: name, args: { scheduleId: id } })
    data = encodeAbiParameters(parseAbiParameters('uint256, uint8, uint8, uint64'), [0n, 1, 1, 10n])
  } else if (name === 'ScheduleAutoPaused') {
    topics = encodeEventTopics({ abi: MODULE_V2_ABI, eventName: name, args: { scheduleId: id } })
    data = encodeAbiParameters(parseAbiParameters('uint8'), [1])
  } else {
    topics = encodeEventTopics({ abi: MODULE_V2_ABI, eventName: name, args: { scheduleId: id } })
  }
  return { status: 'success', logs: [{ address: MODULE, data, topics }] }
}

function makeClient(w: World) {
  const calls = { writes: 0, simulations: 0, scheduleReads: 0 }
  let failures = w.readFailsTimes ?? 0
  const client: KeeperClient = {
    async readContract({ address, functionName, args }) {
      if (failures > 0) { failures--; throw new Error('rpc down') }
      if (functionName === 'paused') return w.paused ?? false
      if (functionName === 'coolingEnd') return w.coolingEnd ?? 0n
      if (functionName === 'modules') return [w.enabled ?? true, w.codehash ?? keccak256(CODE), w.perTxMax ?? 100n, w.windowMax ?? 1000n, 86400, 0n, w.windowSpent ?? 0n]
      if (functionName === 'balance') return w.balance ?? 10_000n
      if (functionName === 'isApprover') return w.keeperIsApprover ?? false
      if (functionName === 'scheduleCount') return BigInt(w.schedules.length)
      const id = args?.[0] as bigint
      const s = w.schedules[Number(id) - 1]!
      if (functionName === 'isDue') return s.due ?? true
      if (functionName === 'getSchedule') {
        calls.scheduleReads++
        return { recipient: OTHER, amount: s.amount, nextDue: 0n, nextRetryAt: 0n, status: 1, minTreasuryBalanceAfter: s.minAfter ?? 0n, executor: s.executor ?? ZERO, failures: 0 }
      }
      throw new Error(`unexpected read ${functionName} on ${address}`)
    },
    async simulateContract({ args }) {
      calls.simulations++
      if (w.simulateFails) throw new Error('execution reverted: NotDue')
      return { request: { id: args?.[0] } }
    },
    async writeContract() { calls.writes++; return HASH },
    async waitForTransactionReceipt() {
      const id = BigInt(calls.writes)
      const r = w.receipt?.(id) ?? receiptWith('ScheduleExecuted', id)
      if (r === 'timeout') throw new Error('timed out')
      return r
    },
    async getBlockTimestamp() { return 1_000n },
    async getCode() { return w.code ?? CODE },
  }
  return { client, calls }
}

describe('keeper global gates', () => {
  test('does nothing while the treasury is paused', async () => {
    const { client, calls } = makeClient({ paused: true, schedules: [{ amount: 5n }] })
    expect(await runOnce(client, cfg, log)).toEqual([])
    expect(calls.writes).toBe(0)
  })
  test('does nothing during the post-recovery cooling period, and resumes after it', async () => {
    const during = makeClient({ coolingEnd: 2_000_000_000n, schedules: [{ amount: 5n }] })
    expect(await runOnce(during.client, cfg, log)).toEqual([])
    expect(during.calls.writes).toBe(0)
    expect(during.calls.simulations).toBe(0)
    const after = makeClient({ coolingEnd: 1n, schedules: [{ amount: 5n }] })
    expect((await runOnce(after.client, cfg, log)).length).toBe(1)
  })
  test('does nothing while the module is disabled', async () => {
    const { client, calls } = makeClient({ enabled: false, schedules: [{ amount: 5n }] })
    expect(await runOnce(client, cfg, log)).toEqual([])
    expect(calls.writes).toBe(0)
  })
  test('refuses to execute when module code differs from the pinned code', async () => {
    const { client, calls } = makeClient({ code: '0xdeadbeef', schedules: [{ amount: 5n }] })
    expect(await runOnce(client, cfg, log)).toEqual([])
    expect(calls.writes).toBe(0)
  })
  test('survives an RPC outage on the first read without sending anything', async () => {
    const { client, calls } = makeClient({ readFailsTimes: 99, schedules: [{ amount: 5n }] })
    expect(await runOnce(client, cfg, log)).toEqual([])
    expect(calls.writes).toBe(0)
  })
  test('recovers from a transient RPC failure by retrying reads', async () => {
    const { client } = makeClient({ readFailsTimes: 1, schedules: [{ amount: 5n }] })
    const r = await runOnce(client, cfg, log)
    expect(r[0]?.outcome).toBe('paid')
  })
})

describe('keeper execution outcomes', () => {
  test('reports paid only for a confirmed ScheduleExecuted event', async () => {
    const { client, calls } = makeClient({ schedules: [{ amount: 5n }] })
    const r = await runOnce(client, cfg, log)
    expect(r).toEqual([{ scheduleId: 1n, outcome: 'paid', txHash: HASH }])
    expect(calls.writes).toBe(1)
  })
  test('a soft failure is not reported as paid', async () => {
    const { client } = makeClient({ schedules: [{ amount: 5n }], receipt: (id) => receiptWith('ExecutionFailed', id) })
    const r = await runOnce(client, cfg, log)
    expect(r[0]?.outcome).toBe('soft-failed')
  })
  test('reports auto-pause and completion distinctly', async () => {
    const a = makeClient({ schedules: [{ amount: 5n }], receipt: (id) => receiptWith('ScheduleAutoPaused', id) })
    expect((await runOnce(a.client, cfg, log))[0]?.outcome).toBe('auto-paused')
    const b = makeClient({ schedules: [{ amount: 5n }], receipt: (id) => receiptWith('ScheduleCompleted', id) })
    expect((await runOnce(b.client, cfg, log))[0]?.outcome).toBe('completed')
  })
  test('an onchain revert is reported as reverted', async () => {
    const { client } = makeClient({ schedules: [{ amount: 5n }], receipt: () => ({ status: 'reverted', logs: [] }) })
    expect((await runOnce(client, cfg, log))[0]?.outcome).toBe('reverted')
  })
  test('a missing receipt is unconfirmed, never paid, and the transaction is not resent', async () => {
    const { client, calls } = makeClient({ schedules: [{ amount: 5n }], receipt: () => 'timeout' })
    const r = await runOnce(client, cfg, log)
    expect(r[0]?.outcome).toBe('unconfirmed')
    expect(calls.writes).toBe(1)
  })
  test('a confirmed transaction with no module event is not paid', async () => {
    const { client } = makeClient({ schedules: [{ amount: 5n }], receipt: () => ({ status: 'success', logs: [] }) })
    expect((await runOnce(client, cfg, log))[0]?.outcome).toBe('error')
  })
  test('a failing simulation sends nothing', async () => {
    const { client, calls } = makeClient({ simulateFails: true, schedules: [{ amount: 5n }] })
    expect((await runOnce(client, cfg, log))[0]?.outcome).toBe('error')
    expect(calls.writes).toBe(0)
  })
})

describe('keeper safeguards', () => {
  test('skips schedules restricted to another executor', async () => {
    const { client, calls } = makeClient({ schedules: [{ amount: 5n, executor: OTHER }] })
    const r = await runOnce(client, cfg, log)
    expect(r[0]?.outcome).toBe('skipped')
    expect(calls.writes).toBe(0)
  })
  test('executes schedules restricted to the keeper itself', async () => {
    const { client } = makeClient({ schedules: [{ amount: 5n, executor: KEEPER }] })
    expect((await runOnce(client, cfg, log))[0]?.outcome).toBe('paid')
  })
  test('skips a payment above the per-payment limit without provoking a failure', async () => {
    const { client, calls } = makeClient({ perTxMax: 4n, schedules: [{ amount: 5n }] })
    const r = await runOnce(client, cfg, log)
    expect(r[0]?.outcome).toBe('skipped')
    expect(calls.writes).toBe(0)
  })
  test('tracks the window budget across schedules within one round', async () => {
    const { client, calls } = makeClient({ windowMax: 12n, schedules: [{ amount: 5n }, { amount: 5n }, { amount: 5n }] })
    const r = await runOnce(client, cfg, log)
    expect(r.map((x) => x.outcome)).toEqual(['paid', 'paid', 'skipped'])
    expect(calls.writes).toBe(2)
  })
  test('skips when the treasury balance cannot cover the payment plus its minimum', async () => {
    const { client, calls } = makeClient({ balance: 100n, schedules: [{ amount: 60n, minAfter: 50n }] })
    expect((await runOnce(client, cfg, log))[0]?.outcome).toBe('skipped')
    expect(calls.writes).toBe(0)
  })
  test('does not touch schedules that are not due', async () => {
    const { client, calls } = makeClient({ schedules: [{ amount: 5n, due: false }] })
    expect(await runOnce(client, cfg, log)).toEqual([])
    expect(calls.scheduleReads).toBe(0)
  })
  test('caps executions per round', async () => {
    const { client, calls } = makeClient({ schedules: [{ amount: 1n }, { amount: 1n }, { amount: 1n }] })
    await runOnce(client, { ...cfg, maxSchedulesPerPoll: 2 }, log)
    expect(calls.writes).toBe(2)
  })
  test('an approver keeper may execute restricted schedules', async () => {
    const { client } = makeClient({ keeperIsApprover: true, schedules: [{ amount: 5n, executor: OTHER }] })
    expect((await runOnce(client, cfg, log))[0]?.outcome).toBe('paid')
  })
})

describe('helpers', () => {
  test('withRetry retries then throws the last error', async () => {
    let n = 0
    await expect(withRetry(async () => { n++; throw new Error('x') }, 2, 1)).rejects.toThrow('x')
    expect(n).toBe(3)
  })
  test('summarize counts outcomes', () => {
    expect(summarize([{ scheduleId: 1n, outcome: 'paid' }, { scheduleId: 2n, outcome: 'paid' }, { scheduleId: 3n, outcome: 'skipped' }])).toBe('paid=2 skipped=1')
    expect(summarize([])).toBe('nothing due')
  })
})
