/**
 * Askirawa Finance Keeper (Treasury v2)
 *
 * Executes due recurring payments through RecurringPaymentModule.execute(id).
 * The keeper wallet needs only gas; it has no role in governance and cannot move funds on its own.
 *
 * Required env:
 *   KEEPER_PRIVATE_KEY               0x… key of a dedicated, low-balance gas wallet (never commit it)
 *   VITE_TREASURY_ADDRESS            deployed AskirawaTreasury
 *   VITE_RECURRING_MODULE_ADDRESS    deployed RecurringPaymentModule
 * Optional env:
 *   VITE_CHAIN_ID (default 5042002, Arc Testnet), POLL_INTERVAL_MS (60000), MAX_SCHEDULES_PER_POLL (20),
 *   MAX_SCAN (500), RETRY_MAX (2), RECEIPT_TIMEOUT_MS (90000), KEEPER_ALLOW_MAINNET (must be "yes" for 5042)
 *   RPC_PROXY_BASE_URL / RPC_PROXY_TOKEN / RPC_PROXY_CHAINS (provisioned by Arc Studio)
 *
 * See docs/keeper-setup.md.
 */
import { createPublicClient, createWalletClient, getAddress, http, isAddress, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcMainnet, resolveChain, resolveRpcUrl } from './chain.js'
import { runOnce, summarize, viemKeeperClient, type KeeperConfig, type Logger } from './keeper-core'

function fail(msg: string): never {
  console.error(`[keeper] ${msg}`)
  process.exit(1)
}

const env = (k: string) => (process.env[k] ?? '').trim()
const num = (k: string, d: number) => {
  const v = env(k)
  if (!v) return d
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) fail(`${k} must be a non-negative number`)
  return n
}

const chainId = num('VITE_CHAIN_ID', 5042002)
if (chainId === arcMainnet.id && env('KEEPER_ALLOW_MAINNET') !== 'yes') {
  fail('Mainnet is disabled for this keeper. Treasury v2 is unaudited; use Arc Testnet (5042002).')
}
const chain = (() => { try { return resolveChain(chainId) } catch (e) { return fail(e instanceof Error ? e.message : String(e)) } })()

const treasuryRaw = env('VITE_TREASURY_ADDRESS')
const moduleRaw = env('VITE_RECURRING_MODULE_ADDRESS')
if (!isAddress(treasuryRaw)) fail('VITE_TREASURY_ADDRESS is missing or not a valid address')
if (!isAddress(moduleRaw)) fail('VITE_RECURRING_MODULE_ADDRESS is missing or not a valid address')
const keyRaw = env('KEEPER_PRIVATE_KEY')
if (!/^0x[0-9a-fA-F]{64}$/.test(keyRaw)) fail('KEEPER_PRIVATE_KEY is missing or malformed (expected 0x + 64 hex characters)')

const account = privateKeyToAccount(keyRaw as Hex)
const rpcUrl = resolveRpcUrl(chainId)
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account })

const client = viemKeeperClient(publicClient, walletClient)

const cfg: KeeperConfig = {
  treasury: getAddress(treasuryRaw) as Address,
  module: getAddress(moduleRaw) as Address,
  keeper: account.address,
  maxSchedulesPerPoll: num('MAX_SCHEDULES_PER_POLL', 20),
  maxScan: num('MAX_SCAN', 500),
  retryMax: num('RETRY_MAX', 2),
  receiptTimeoutMs: num('RECEIPT_TIMEOUT_MS', 90_000),
  retryBackoffMs: 2_000,
}
const POLL_INTERVAL_MS = num('POLL_INTERVAL_MS', 60_000)

const log: Logger = (level, msg) => console[level === 'info' ? 'log' : level](`[keeper] ${new Date().toISOString()} ${msg}`)

let running = false
async function tick() {
  if (running) return // never overlap rounds: nonces and budget tracking assume one round at a time
  running = true
  try {
    const reports = await runOnce(client, cfg, log)
    for (const r of reports) log(r.outcome === 'paid' ? 'info' : 'warn', `schedule ${r.scheduleId}: ${r.outcome}${r.reason ? ` (${r.reason})` : ''}${r.txHash ? ` tx ${r.txHash}` : ''}`)
    log('info', `round complete: ${summarize(reports)}`)
  } catch (err) {
    log('error', `unexpected error, round abandoned: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    running = false
  }
}

log('info', `Askirawa keeper starting on ${chain.name} (${chain.id})`)
log('info', `treasury ${cfg.treasury} · module ${cfg.module} · keeper ${cfg.keeper}`)
log('info', `poll every ${POLL_INTERVAL_MS}ms · RPC ${rpcUrl.includes('_rpc_token') ? '(proxied)' : rpcUrl}`)
void publicClient.getBalance({ address: account.address }).then((b) => { if (b === 0n) log('warn', 'keeper wallet has no gas balance') }).catch(() => undefined)

await tick()
setInterval(() => { void tick() }, POLL_INTERVAL_MS)
