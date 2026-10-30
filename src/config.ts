/**
 * wagmi configuration for Askirawa Finance.
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig, type CreateConnectorFn } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors'
import { registerChain } from './tracing'

export const APP_NAME = 'Askirawa Finance'
export const APP_DESCRIPTION = 'Askirawa Finance — Programmable USDC Treasury built on Arc.'

// Arc Mainnet (chain ID 5042) — where the Askirawa Finance contracts are deployed
export const arcMainnet = {
  id: 5042 as const,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
} as const

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

export const ARC_MAINNET_CHAIN_ID = arcMainnet.id
export const ARC_TESTNET_CHAIN_ID = arcTestnet.id

/**
 * WalletConnect project ID. Vite inlines `VITE_*` variables at BUILD time, so on
 * Vercel the variable must exist before the build runs (then redeploy).
 * Public identifier, not a secret.
 */
export const WALLETCONNECT_PROJECT_ID: string =
  ((import.meta.env.VITE_WC_PROJECT_ID) ?? '').trim()

export const isWalletConnectConfigured = WALLETCONNECT_PROJECT_ID.length > 0

const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://askirawa-finance.vercel.app'
const appIcon = `${appUrl}/favicon.svg`

// One connector per wallet family. Registering each family once avoids duplicate
// entries in the wallet list.
//  - injected(): browser extensions and in-app wallet browsers (MetaMask Mobile,
//    Trust, Rabby, Coinbase and any other EIP-1193 / EIP-6963 wallet)
//  - coinbaseWallet(): Coinbase Wallet app and Smart Wallet
//  - walletConnect(): QR code on desktop, deep links to installed wallet apps on mobile
const connectors: CreateConnectorFn[] = [
  injected(),
  coinbaseWallet({ appName: APP_NAME, appLogoUrl: appIcon }),
]

if (isWalletConnectConfigured) {
  connectors.push(
    walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: false, // ConnectKit renders the QR code and mobile deep links
      metadata: {
        name: APP_NAME,
        description: APP_DESCRIPTION,
        url: appUrl,
        icons: [appIcon],
      },
    }),
  )
} else if (import.meta.env.DEV) {
  console.warn(
    '[Askirawa Finance] VITE_WC_PROJECT_ID is not set. Mobile wallet apps cannot connect until it is configured.',
  )
}

export const config = createConfig({
  chains: [arcMainnet, arcTestnet, mainnet],
  connectors,
  transports: {
    [arcMainnet.id]: http(),
    [arcTestnet.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
