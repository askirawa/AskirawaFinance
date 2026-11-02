/**
 * Treasury v2 deployment configuration. Everything here is read from public build-time env vars and
 * from @/onchain-facts. Nothing is invented: when a value is unset the app says the treasury is not set up.
 */
import { isAddress, type Address } from 'viem'
import { buildAddressExplorerUrl, buildTxExplorerUrl, getUsdc, requireChain } from '../onchain-facts'

export type SupportedChainId = 5042 | 5042002

function parseChainId(raw: string | undefined): SupportedChainId {
  return Number(raw) === 5042 ? 5042 : 5042002
}

function parseAddress(raw: string | undefined): Address | null {
  const value = (raw ?? '').trim()
  return isAddress(value) ? (value) : null
}

function parseBlock(raw: string | undefined): bigint | null {
  const value = (raw ?? '').trim()
  return /^\d+$/.test(value) ? BigInt(value) : null
}

export const TREASURY_CHAIN_ID: SupportedChainId = parseChainId(import.meta.env.VITE_CHAIN_ID)
export const TREASURY_ADDRESS: Address | null = parseAddress(import.meta.env.VITE_TREASURY_ADDRESS)
export const RECURRING_MODULE_ADDRESS: Address | null = parseAddress(import.meta.env.VITE_RECURRING_MODULE_ADDRESS)
export const RECOVERY_ADDRESS: Address | null = parseAddress(import.meta.env.VITE_RECOVERY_ADDRESS)
/** First block to scan for history. Never scan from block zero. */
export const DEPLOY_BLOCK: bigint | null = parseBlock(import.meta.env.VITE_TREASURY_DEPLOY_BLOCK)

const chain = requireChain(TREASURY_CHAIN_ID)
const usdc = getUsdc(TREASURY_CHAIN_ID)
if (!usdc) throw new Error(`USDC is not registered for chain ${TREASURY_CHAIN_ID}`)

export const NETWORK = {
  id: TREASURY_CHAIN_ID,
  name: chain.isTestnet ? 'Arc Testnet' : 'Arc Mainnet',
  isTestnet: chain.isTestnet,
  explorerBase: chain.explorerBase,
  rpcUrl: chain.rpcUrls[0],
  usdcAddress: usdc.address as Address,
  usdcDecimals: usdc.decimals,
} as const

export const isTreasuryConfigured = TREASURY_ADDRESS !== null
export const isModuleConfigured = RECURRING_MODULE_ADDRESS !== null

export const txUrl = (hash: string) => buildTxExplorerUrl(TREASURY_CHAIN_ID, hash)
export const addressUrl = (address: string) => buildAddressExplorerUrl(TREASURY_CHAIN_ID, address)
