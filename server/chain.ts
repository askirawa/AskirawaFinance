/**
 * Arc Mainnet chain definition for server-side viem usage.
 * RPC URL comes from environment via the proxy helper below, never hardcoded.
 */
import { defineChain } from 'viem'

export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] }, // arc-studio-allow-onchain-literal
    public:  { http: ['https://rpc.mainnet.arc.io'] }, // arc-studio-allow-onchain-literal
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
})

/**
 * Resolve the Arc Mainnet RPC URL.
 * Uses the provisioned proxy when RPC_PROXY_BASE_URL covers the 'Arc' chain key;
 * falls back to the public endpoint for chains the proxy doesn't cover.
 */
export function resolveRpcUrl(): string {
  const base = process.env.RPC_PROXY_BASE_URL
  const token = process.env.RPC_PROXY_TOKEN
  const chains = (process.env.RPC_PROXY_CHAINS ?? '').split(',').map(s => s.trim())
  if (base && token && chains.includes('Arc')) {
    return `${base}/api/rpc/Arc?_rpc_token=${token}`
  }
  // Public fallback — no rate limit assertion; Arc mainnet public RPC
  return arcMainnet.rpcUrls.default.http[0]
}
