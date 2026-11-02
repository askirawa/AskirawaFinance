/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WalletConnect (Reown) project ID. Public identifier, inlined at build time. */
  readonly VITE_WC_PROJECT_ID?: string
  /** Deployed Treasury v2 (AskirawaTreasury) address on the chain below. Unset = treasury not set up. */
  readonly VITE_TREASURY_ADDRESS?: string
  /** Chain the treasury lives on: 5042002 (Arc Testnet, default) or 5042 (Arc Mainnet, only when set explicitly). */
  readonly VITE_CHAIN_ID?: string
  readonly VITE_RECURRING_MODULE_ADDRESS?: string
  readonly VITE_RECOVERY_ADDRESS?: string
  /** Block of the treasury deployment receipt; event scans start here. */
  readonly VITE_TREASURY_DEPLOY_BLOCK?: string
  readonly VITE_PAYROLL_BATCH_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
