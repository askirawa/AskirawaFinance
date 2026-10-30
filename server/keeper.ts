/**
 * Askirawa Finance Keeper Worker
 *
 * Polls AskirawaFiTreasury for due recurring schedules and executes them on-chain.
 * Must be run with a funded EOA whose address is set as the treasury's keeper.
 *
 * Required env vars:
 *   KEEPER_PRIVATE_KEY       — 0x... private key of the keeper EOA
 *   VITE_TREASURY_ADDRESS    — deployed AskirawaFiTreasury address
 *
 * Optional env vars:
 *   POLL_INTERVAL_MS         — poll frequency in ms (default: 60000)
 *   MAX_SCHEDULES_PER_POLL   — max schedules per poll round (default: 20)
 *   RETRY_MAX                — max retries per schedule per round (default: 1)
 *   RPC_PROXY_BASE_URL       — Arc Studio provisioned RPC proxy base
 *   RPC_PROXY_TOKEN          — Arc Studio provisioned RPC proxy token
 *   RPC_PROXY_CHAINS         — comma-separated proxy chain keys (e.g. "Arc,Arc_Testnet")
 *
 * See docs/keeper-setup.md for full deployment instructions.
 */

import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcMainnet, resolveRpcUrl } from './chain.js'

const TREASURY_ADDRESS = (process.env.VITE_TREASURY_ADDRESS ?? '') as Hex
const KEEPER_PRIVATE_KEY = (process.env.KEEPER_PRIVATE_KEY ?? '') as Hex
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000)
const MAX_SCHEDULES_PER_POLL = Number(process.env.MAX_SCHEDULES_PER_POLL ?? 20)
const RETRY_MAX = Number(process.env.RETRY_MAX ?? 1)

if (!TREASURY_ADDRESS) {
  console.error('[keeper] VITE_TREASURY_ADDRESS not set — exiting')
  process.exit(1)
}
if (!KEEPER_PRIVATE_KEY) {
  console.error('[keeper] KEEPER_PRIVATE_KEY not set — exiting')
  process.exit(1)
}

const rpcUrl = resolveRpcUrl()
const account = privateKeyToAccount(KEEPER_PRIVATE_KEY)

const publicClient = createPublicClient({ chain: arcMainnet, transport: http(rpcUrl) })
const walletClient = createWalletClient({ chain: arcMainnet, transport: http(rpcUrl), account })

const TREASURY_ABI = parseAbi([
  'function getDueSchedules(uint256 maxCount) view returns (uint256[])',
  'function executeSchedule(uint256 scheduleId)',
  'event ScheduleExecuted(uint256 indexed scheduleId, address indexed recipient, uint256 amount, uint64 nextExecTime, uint256 execCount)',
  'event ScheduleFailed(uint256 indexed scheduleId, address indexed recipient, uint256 amount, uint256 failCount)',
])

/**
 * In-process duplicate prevention.
 * Key: `${scheduleId}-${windowIndex}` where windowIndex = floor(now / 2*POLL_INTERVAL_MS).
 * This prevents the keeper from calling executeSchedule twice for the same schedule in the
 * same time window. The contract itself also enforces this via nextExecTime, but defence-in-depth.
 */
const recentlyExecuted = new Set<string>()

async function pollAndExecute() {
  const ts = new Date().toISOString()
  try {
    const dueIds = await publicClient.readContract({
      address: TREASURY_ADDRESS,
      abi: TREASURY_ABI,
      functionName: 'getDueSchedules',
      args: [BigInt(MAX_SCHEDULES_PER_POLL)],
    })

    if (dueIds.length === 0) {
      console.log(`[keeper] ${ts} — no due schedules`)
      return
    }

    console.log(`[keeper] ${ts} — ${dueIds.length} due schedule(s): ${dueIds.join(', ')}`)

    for (const scheduleId of dueIds) {
      const windowIndex = Math.floor(Date.now() / (POLL_INTERVAL_MS * 2))
      const key = `${scheduleId}-${windowIndex}`

      if (recentlyExecuted.has(key)) {
        console.log(`[keeper]   skipping schedule ${scheduleId} — already executed this window`)
        continue
      }

      let attempt = 0
      let succeeded = false

      while (attempt <= RETRY_MAX && !succeeded) {
        try {
          const hash = await walletClient.writeContract({
            address: TREASURY_ADDRESS,
            abi: TREASURY_ABI,
            functionName: 'executeSchedule',
            args: [scheduleId],
          })

          const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })

          if (receipt.status === 'success') {
            recentlyExecuted.add(key)
            succeeded = true
            console.log(`[keeper]   executed schedule ${scheduleId} — tx ${hash}`)
          } else {
            console.warn(`[keeper]   schedule ${scheduleId} tx reverted — tx ${hash} (not retrying)`)
            break // Contract-level revert — don't retry
          }
        } catch (err: unknown) {
          attempt++
          const msg = err instanceof Error ? err.message : String(err)
          if (attempt > RETRY_MAX) {
            console.error(`[keeper]   schedule ${scheduleId} failed after ${RETRY_MAX + 1} attempt(s): ${msg}`)
          } else {
            console.warn(`[keeper]   schedule ${scheduleId} attempt ${attempt} failed, retrying in 3s: ${msg}`)
            await new Promise<void>(r => setTimeout(r, 3000))
          }
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[keeper] ${ts} poll error: ${msg}`)
  }
}

// Prune old duplicate-prevention keys hourly
setInterval(() => {
  const currentWindow = Math.floor(Date.now() / (POLL_INTERVAL_MS * 2))
  for (const key of recentlyExecuted) {
    const parts = key.split('-')
    const keyWindow = Number(parts[parts.length - 1])
    if (keyWindow < currentWindow - 10) recentlyExecuted.delete(key)
  }
}, 3_600_000)

console.log(`[keeper] Starting Askirawa Finance Keeper`)
console.log(`[keeper] Treasury: ${TREASURY_ADDRESS}`)
console.log(`[keeper] Keeper wallet: ${account.address}`)
console.log(`[keeper] Poll interval: ${POLL_INTERVAL_MS}ms`)
console.log(`[keeper] RPC: ${rpcUrl.includes('_rpc_token') ? '(proxied)' : rpcUrl}`)

await pollAndExecute()
setInterval(pollAndExecute, POLL_INTERVAL_MS)
