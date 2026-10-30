/**
 * Treasury v2 keeper core: one polling round against RecurringPaymentModule.
 *
 * The keeper holds NO special authority. It only calls the module's public `execute(id)`, which pays
 * through the treasury's codehash-pinned, budget-limited `payFromModule`. Quorum, timelocks, budgets and
 * the pause switch are enforced by the contracts; this code only avoids wasting gas and, importantly,
 * avoids provoking "soft failures" (the module records a failed payment instead of reverting, and too many
 * failures auto-pause a schedule that then needs a governance vote to resume).
 *
 * A schedule is reported "paid" only when a confirmed receipt contains the module's ScheduleExecuted event.
 * Dependencies are injected so every branch is unit tested without a network.
 */
import { keccak256, parseEventLogs, type Address, type Hash, type Hex, type PublicClient, type WalletClient } from 'viem'
import { MODULE_V2_ABI, TREASURY_V2_ABI } from '../src/lib/v2/abi'

export type Outcome = 'paid' | 'skipped' | 'soft-failed' | 'completed' | 'auto-paused' | 'reverted' | 'unconfirmed' | 'error'

export interface RunReport {
  scheduleId: bigint
  outcome: Outcome
  reason?: string
  txHash?: Hash
}

export interface KeeperReceipt { status: 'success' | 'reverted'; logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] }

/** The slice of a viem client the keeper uses. */
export interface KeeperClient {
  readContract(args: { address: Address; abi: unknown; functionName: string; args?: readonly unknown[]; account?: Address }): Promise<unknown>
  simulateContract(args: { address: Address; abi: unknown; functionName: string; args?: readonly unknown[]; account: Address }): Promise<{ request: unknown }>
  writeContract(request: unknown): Promise<Hash>
  waitForTransactionReceipt(args: { hash: Hash; timeout: number }): Promise<KeeperReceipt>
  getBlockTimestamp(): Promise<bigint>
  getCode(address: Address): Promise<Hex | undefined>
}

export interface KeeperConfig {
  treasury: Address
  module: Address
  keeper: Address
  maxSchedulesPerPoll: number
  maxScan: number
  retryMax: number
  receiptTimeoutMs: number
  retryBackoffMs: number
}

export type Logger = (level: 'info' | 'warn' | 'error', msg: string) => void

const ZERO = '0x0000000000000000000000000000000000000000'
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface ScheduleData {
  recipient: Address; amount: bigint; nextDue: bigint; nextRetryAt: bigint; status: number
  minTreasuryBalanceAfter: bigint; executor: Address; failures: number
}
interface ModuleBudget { enabled: boolean; codehash: Hex; perTxMax: bigint; windowMax: bigint; windowLength: number; windowStart: bigint; windowSpent: bigint }

/** Retries transient RPC failures with linear backoff. Never used for transaction submission. */
export async function withRetry<T>(fn: () => Promise<T>, retries: number, backoffMs: number): Promise<T> {
  let last: unknown
  for (let i = 0; i <= retries; i++) {
    try { return await fn() } catch (err) {
      last = err
      if (i < retries) await sleep(backoffMs * (i + 1))
    }
  }
  throw last
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] ?? 'error' : String(e))

export async function runOnce(client: KeeperClient, cfg: KeeperConfig, log: Logger): Promise<RunReport[]> {
  const read = <T>(address: Address, abi: unknown, functionName: string, args?: readonly unknown[]) =>
    withRetry(() => client.readContract({ address, abi, functionName, args }), cfg.retryMax, cfg.retryBackoffMs) as Promise<T>

  // 1. Global gates: nothing can be paid while paused or while the module is not enabled.
  let paused: boolean
  let budget: ModuleBudget
  let treasuryBalance: bigint
  let now: bigint
  let keeperIsApprover: boolean
  try {
    paused = await read<boolean>(cfg.treasury, TREASURY_V2_ABI, 'paused')
    if (paused) { log('warn', 'treasury is paused: no schedules will be executed'); return [] }
    const m = await read<readonly [boolean, Hex, bigint, bigint, number, bigint, bigint]>(cfg.treasury, TREASURY_V2_ABI, 'modules', [cfg.module])
    budget = { enabled: m[0], codehash: m[1], perTxMax: m[2], windowMax: m[3], windowLength: m[4], windowStart: m[5], windowSpent: m[6] }
    if (!budget.enabled) { log('warn', 'module is not enabled by governance: nothing to execute'); return [] }
    treasuryBalance = await read<bigint>(cfg.treasury, TREASURY_V2_ABI, 'balance')
    keeperIsApprover = await read<boolean>(cfg.treasury, TREASURY_V2_ABI, 'isApprover', [cfg.keeper])
    now = await withRetry(() => client.getBlockTimestamp(), cfg.retryMax, cfg.retryBackoffMs)
    // After a council recovery the treasury blocks module draws for 7 days. Sending now would only record failures.
    const coolingEnd = await read<bigint>(cfg.treasury, TREASURY_V2_ABI, 'coolingEnd')
    if (coolingEnd > now) { log('warn', `spending cooling period active until ${coolingEnd}: no schedules will be executed`); return [] }
  } catch (err) {
    log('error', `RPC failure while reading treasury state, round skipped: ${errMsg(err)}`)
    return []
  }

  // Pinned code must still match, otherwise the treasury would record a soft failure for every draw.
  const code = await withRetry(() => client.getCode(cfg.module), cfg.retryMax, cfg.retryBackoffMs).catch(() => undefined)
  if (!code || code === '0x' || keccak256(code) !== budget.codehash) {
    log('error', 'module code does not match the code registered with the treasury: refusing to execute')
    return []
  }

  let count: bigint
  try { count = await read<bigint>(cfg.module, MODULE_V2_ABI, 'scheduleCount') } catch (err) {
    log('error', `RPC failure reading schedule count: ${errMsg(err)}`)
    return []
  }
  if (count === 0n) { log('info', 'no schedules'); return [] }
  const first = count > BigInt(cfg.maxScan) ? count - BigInt(cfg.maxScan) + 1n : 1n
  if (first > 1n) log('warn', `only the newest ${cfg.maxScan} of ${count} schedules are scanned`)

  // 2. Discover due schedules.
  const reports: RunReport[] = []
  const due: { id: bigint; s: ScheduleData }[] = []
  for (let id = first; id <= count; id++) {
    try {
      const isDue = await read<boolean>(cfg.module, MODULE_V2_ABI, 'isDue', [id])
      if (!isDue) continue
      const s = await read<ScheduleData>(cfg.module, MODULE_V2_ABI, 'getSchedule', [id])
      const allowed = s.executor === ZERO || same(s.executor, cfg.keeper) || keeperIsApprover
      if (!allowed) {
        reports.push({ scheduleId: id, outcome: 'skipped', reason: `restricted executor ${s.executor}; this keeper is not authorized` })
        continue
      }
      due.push({ id, s })
    } catch (err) {
      reports.push({ scheduleId: id, outcome: 'error', reason: `RPC failure while reading schedule: ${errMsg(err)}` })
    }
  }

  // 3. Execute each due schedule, tracking budget and balance consumed within this round.
  let spent = now >= budget.windowStart + BigInt(budget.windowLength) ? 0n : budget.windowSpent
  let balance = treasuryBalance
  for (const { id, s } of due.slice(0, cfg.maxSchedulesPerPoll)) {
    if (s.amount > budget.perTxMax || spent + s.amount > budget.windowMax) {
      reports.push({ scheduleId: id, outcome: 'skipped', reason: 'module budget exhausted for this window' })
      continue
    }
    if (balance < s.amount + s.minTreasuryBalanceAfter) {
      reports.push({ scheduleId: id, outcome: 'skipped', reason: 'treasury balance too low (or below the schedule minimum)' })
      continue
    }
    const report = await executeOne(client, cfg, id, log)
    reports.push(report)
    if (report.outcome === 'paid') { spent += s.amount; balance -= s.amount }
  }
  if (due.length > cfg.maxSchedulesPerPoll) log('warn', `${due.length - cfg.maxSchedulesPerPoll} due schedule(s) deferred to the next round`)
  return reports
}

async function executeOne(client: KeeperClient, cfg: KeeperConfig, id: bigint, log: Logger): Promise<RunReport> {
  // Simulation catches reverts (not due, unauthorized, unknown schedule) before spending gas.
  let request: unknown
  try {
    request = (await withRetry(
      () => client.simulateContract({ address: cfg.module, abi: MODULE_V2_ABI, functionName: 'execute', args: [id], account: cfg.keeper }),
      cfg.retryMax, cfg.retryBackoffMs,
    )).request
  } catch (err) {
    return { scheduleId: id, outcome: 'error', reason: `simulation rejected: ${errMsg(err)}` }
  }

  // Submission is never retried automatically: a lost response could otherwise double-send.
  let hash: Hash
  try { hash = await client.writeContract(request) } catch (err) {
    return { scheduleId: id, outcome: 'error', reason: `could not submit transaction: ${errMsg(err)}` }
  }

  let receipt: KeeperReceipt
  try { receipt = await client.waitForTransactionReceipt({ hash, timeout: cfg.receiptTimeoutMs }) } catch (err) {
    log('warn', `schedule ${id}: no confirmation for ${hash} (${errMsg(err)}); it is NOT counted as paid`)
    return { scheduleId: id, outcome: 'unconfirmed', txHash: hash, reason: 'no receipt before timeout' }
  }
  if (receipt.status !== 'success') return { scheduleId: id, outcome: 'reverted', txHash: hash, reason: 'transaction reverted onchain' }

  const events = parseEventLogs({ abi: MODULE_V2_ABI, logs: receipt.logs as never, strict: false })
    .filter((l) => (l.args as { scheduleId?: bigint }).scheduleId === id)
  if (events.some((e) => e.eventName === 'ScheduleExecuted')) return { scheduleId: id, outcome: 'paid', txHash: hash }
  const failed = events.find((e) => e.eventName === 'ExecutionFailed')
  if (failed) {
    const a = failed.args as { reasonCode?: number; failures?: number }
    return { scheduleId: id, outcome: 'soft-failed', txHash: hash, reason: `payment failed (reason ${a.reasonCode}, failure ${a.failures}); retries after the module retry delay` }
  }
  if (events.some((e) => e.eventName === 'ScheduleAutoPaused')) return { scheduleId: id, outcome: 'auto-paused', txHash: hash, reason: 'schedule auto-paused; governance must resume it' }
  if (events.some((e) => e.eventName === 'ScheduleCompleted')) return { scheduleId: id, outcome: 'completed', txHash: hash, reason: 'schedule reached its limit; no payment made' }
  return { scheduleId: id, outcome: 'error', txHash: hash, reason: 'confirmed but no module event was emitted; nothing was paid' }
}

export function summarize(reports: RunReport[]): string {
  const c: Partial<Record<Outcome, number>> = {}
  for (const r of reports) c[r.outcome] = (c[r.outcome] ?? 0) + 1
  return Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ') || 'nothing due'
}

/** Adapts viem clients to the KeeperClient slice. The same adapter is used in production and in the anvil integration test. */
export function viemKeeperClient(publicClient: PublicClient, walletClient: WalletClient): KeeperClient {
  return {
    readContract: (a) => publicClient.readContract(a as never),
    simulateContract: (a) => publicClient.simulateContract(a as never) as never,
    writeContract: (r) => walletClient.writeContract(r as never),
    waitForTransactionReceipt: async (a) => {
      const r = await publicClient.waitForTransactionReceipt(a)
      return { status: r.status, logs: r.logs }
    },
    getBlockTimestamp: async () => (await publicClient.getBlock()).timestamp,
    getCode: (address) => publicClient.getCode({ address }),
  }
}
