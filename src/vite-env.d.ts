/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WalletConnect (Reown) project ID. Public identifier, inlined at build time. */
  readonly VITE_WC_PROJECT_ID?: string
  readonly VITE_TREASURY_ADDRESS?: string
  /** Target chain id for Treasury v2. Defaults to 5042002 (Arc Testnet). */
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
