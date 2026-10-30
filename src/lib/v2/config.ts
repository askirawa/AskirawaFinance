/**
 * Treasury v2 deployment configuration, read from Vite env at build time.
 * All values are public identifiers (addresses, chain id, block number), never secrets.
 *
 *   VITE_CHAIN_ID                   target chain, default 5042002 (Arc Testnet)
 *   VITE_TREASURY_ADDRESS           deployed AskirawaTreasury
 *   VITE_RECURRING_MODULE_ADDRESS   deployed RecurringPaymentModule
 *   VITE_RECOVERY_ADDRESS           deployed TreasuryRecovery (the treasury's fixed recovery contract)
 *   VITE_TREASURY_DEPLOY_BLOCK      block of the treasury deployment receipt (event scans start here)
 */
import { isAddress, getAddress, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { arcMainnet } from '../../config'
import { getUsdc } from '../../onchain-facts'

function cleanAddress(raw: string | undefined): Address | null {
  const v = (raw ?? '').trim()
  return v && isAddress(v, { strict: false }) ? getAddress(v) : null
}

const chainRaw = Number((import.meta.env.VITE_CHAIN_ID ?? '').trim() || arcTestnet.id)

export const V2_CHAIN_ID: number = chainRaw === arcMainnet.id ? arcMainnet.id : arcTestnet.id
export const V2_CHAIN = V2_CHAIN_ID === arcMainnet.id ? arcMainnet : arcTestnet
export const V2_IS_TESTNET = V2_CHAIN_ID !== arcMainnet.id

export const TREASURY_V2_ADDRESS = cleanAddress(import.meta.env.VITE_TREASURY_ADDRESS)
export const MODULE_V2_ADDRESS = cleanAddress(import.meta.env.VITE_RECURRING_MODULE_ADDRESS)
export const RECOVERY_V2_ADDRESS = cleanAddress(import.meta.env.VITE_RECOVERY_ADDRESS)

const blockRaw = (import.meta.env.VITE_TREASURY_DEPLOY_BLOCK ?? '').trim()
export const DEPLOY_BLOCK: bigint | null = /^\d+$/.test(blockRaw) ? BigInt(blockRaw) : null

export const isTreasuryV2Configured = TREASURY_V2_ADDRESS !== null

const usdcFact = getUsdc(V2_CHAIN_ID)
export const V2_USDC_ADDRESS = (usdcFact?.address ?? null) as Address | null
export const V2_USDC_DECIMALS = usdcFact?.decimals ?? 6

export const EXPLORER_URL = V2_CHAIN.blockExplorers?.default.url ?? 'https://explorer.arc.io'
export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`
export const addressUrl = (addr: string) => `${EXPLORER_URL}/address/${addr}`
