/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WalletConnect (Reown) project ID. Public identifier, inlined at build time. */
  readonly VITE_WC_PROJECT_ID?: string
  readonly VITE_TREASURY_ADDRESS?: string
  readonly VITE_PAYROLL_BATCH_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
