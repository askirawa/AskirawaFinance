/**
 * Chain definitions and RPC resolution for server-side viem usage.
 * RPC URLs come from the Arc Studio proxy when it covers the chain; otherwise from the
 * public endpoint listed in the chain definition. Never hardcode a private endpoint.
 */
import { defineChain } from 'viem'
import { arcTestnet } from 'viem/chains'

export { arcTestnet }

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

/** Chain for a numeric id. Only Arc Testnet and Arc Mainnet are known. */
export function resolveChain(chainId: number) {
  if (chainId === arcMainnet.id) return arcMainnet
  if (chainId === arcTestnet.id) return arcTestnet
  throw new Error(`Unsupported chain id ${chainId}. Use ${arcTestnet.id} (Arc Testnet).`)
}

const PROXY_KEY: Record<number, string> = { [arcMainnet.id]: 'Arc', [arcTestnet.id]: 'Arc_Testnet' }

/** Provisioned proxy when it covers this chain, else the chain's public endpoint. */
export function resolveRpcUrl(chainId: number = arcTestnet.id): string {
  const base = process.env.RPC_PROXY_BASE_URL
  const token = process.env.RPC_PROXY_TOKEN
  const chains = (process.env.RPC_PROXY_CHAINS ?? '').split(',').map((s) => s.trim())
  const key = PROXY_KEY[chainId]
  if (base && token && key && chains.includes(key)) {
    return `${base}/api/rpc/${key}?_rpc_token=${token}`
  }
  return resolveChain(chainId).rpcUrls.default.http[0] as string
}
