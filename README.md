# Askirawa Finance

Askirawa Finance — Programmable USDC Treasury built on Arc. Run payroll batches, approvals, recurring payments and team roles for your organization in USDC. The Treasury v2 contracts are unaudited and are prepared for Arc Testnet only.

Built with [Arc Studio](https://studio.arc.io)

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry
- Backend (optional, not used by the treasury screens): Bun server, SQLite (`bun:sqlite`), SIWE authentication
- Chain: Arc Testnet (chain ID 5042002, the default) for Treasury v2, USDC at `0x3600000000000000000000000000000000000000` (6 decimals). The existing Automation Registry reads use Arc Mainnet (5042)

## Features

- **Dashboard**: available treasury balance, pending approvals, upcoming payments, total paid, recent transactions, Add funds
- **Payroll**: step-by-step batches (names, wallet addresses, USDC amounts, CSV paste or file import), a dry run against the contract, then a request for approval. The whole batch is paid together or not at all
- **Recurring Payments**: daily, weekly or calendar-month schedules created through an approval request. A registered schedule pays only when its due payment is triggered; automatic triggering needs the keeper
- **Approvals**: one place to review, approve, reject, pay, start or cancel requests, with every status read from the treasury contract
- **Team**: approvers, initiators, emergency pause contact and recovery contract read from the contract; display names are saved in this browser only
- **Governance**: rotate approvers, change the approval rule and delays, pause and unpause (quorum proposals)
- **Activity**: history read from contract events, starting at the deployment block, with CSV export
- **Settings**: network, contracts, treasury rules, wallet. A read-only viewer for the legacy Automation Registry is reachable from here
- **Escrow and Vesting**: Coming Soon. Not built, not deployed

Lost approver keys can be recovered by an independent council (3 members, 2 needed) after 30 days of inactivity, a 14 day timelock the approvers can veto, and a 7 day spending cooling period afterwards (see `docs/recovery-design.md`). This is not independently audited.

## Development

### Prerequisites

- [Bun](https://bun.sh) 1.x
- [Foundry](https://book.getfoundry.sh/getting-started/installation)

### Install

```bash
bun install --frozen-lockfile   # also provides @openzeppelin/contracts, which the Foundry remappings use
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_WC_PROJECT_ID` | For mobile wallets | WalletConnect project ID from [cloud.reown.com](https://cloud.reown.com). Public identifier, read at build time |
| `VITE_CHAIN_ID` | No | Target chain for Treasury v2: `5042002` Arc Testnet (default) or `5042` Arc Mainnet (only when set explicitly) |
| `VITE_TREASURY_ADDRESS` | After deploy | Deployed AskirawaTreasury (v2) address |
| `VITE_RECURRING_MODULE_ADDRESS` | After deploy | Deployed RecurringPaymentModule address |
| `VITE_RECOVERY_ADDRESS` | After deploy | Deployed TreasuryRecovery address |
| `VITE_TREASURY_DEPLOY_BLOCK` | After deploy | Block of the treasury deployment receipt; history scans start here |
| `SESSION_SECRET` | Server | Random 32-byte hex string; signs the session cookie. Required in production |
| `ALLOWED_ORIGINS` | Server | Comma list of browser origins allowed to call the backend with credentials. No cross-origin access when empty in production |
| `SIWE_ALLOWED_DOMAINS` | Server | Comma list of hosts allowed in sign-in messages (for example `app.example.com`). Required in production |
| `SIWE_CHAIN_IDS` | No | Chain IDs accepted in sign-in messages (default `5042,5042002`) |
| `DATABASE_URL` | No | SQLite file path (default: `./askira.db`) |
| `KEEPER_PRIVATE_KEY` | Keeper | Key of a dedicated gas-only keeper wallet. Secret: private `.env` only |
| `POLL_INTERVAL_MS` | No | Keeper poll frequency in ms (default: 60000) |
| `MAX_SCHEDULES_PER_POLL` | No | Max schedules checked per round (default: 20) |
| `MAX_SCAN` | No | Newest schedules scanned per round (default: 500) |
| `RETRY_MAX` | No | RPC read retries (default: 2) |
| `RECEIPT_TIMEOUT_MS` | No | Wait for a transaction receipt (default: 90000) |
| `RPC_PROXY_BASE_URL` | No | Arc Studio provisioned RPC proxy (optional outside Arc Studio) |
| `RPC_PROXY_TOKEN` | No | Arc Studio RPC proxy token |
| `RPC_PROXY_CHAINS` | No | Comma-separated proxy chain keys |

### Run

```bash
# Frontend (port 5173)
bun run dev

# Backend server — SIWE auth + org management (port 3001)
bun run server:dev

# Keeper worker — recurring payment automation
bun run keeper:dev
```

### Build

```bash
bunx vite build
```

### Test

```bash
# Smart contract tests (Foundry): all, or Treasury v2 only
bun run contracts:test
bun run contracts:test:v2

# Keeper and frontend-helper tests, plus a local anvil rehearsal (needs anvil and `forge build`)
bun run test:server

# Static analysis (needs Slither)
bun run contracts:slither

# Lint + typecheck
bun run check
```

## Wallet connection

Desktop browser wallets work without any setup. Phone wallet apps (MetaMask Mobile, Trust, Rainbow and others) connect through WalletConnect, which needs `VITE_WC_PROJECT_ID`.

1. Create a free project at [cloud.reown.com](https://cloud.reown.com) and copy its Project ID.
2. In Vercel open your project, go to **Settings > Environment Variables**, and add `VITE_WC_PROJECT_ID` for Production (and Preview).
3. **Redeploy.** Vite reads `VITE_` variables when the app is built, so changing the value has no effect until a new build runs.
4. In the Reown dashboard, add your site domain (for example `askirawa-finance.vercel.app`) to the project's allowed domains.

To test on a phone: open the live site in your phone browser, tap **Connect wallet**, choose your wallet app, approve the connection, then approve the network switch the app asks for (it shows which network it needs). Also try opening the site from inside your wallet app's built-in browser.

## Contract Deployment (Treasury v2, Arc Testnet only)

Follow `docs/testnet-deployment-checklist.md`. In short: copy `contracts/script/deploy-v2.env.example` to a private
`.env.deploy-v2`, fill in three distinct approvers, quorum 2, a separate guardian (or `GUARDIAN_DISABLED=yes`),
delays of at least 1 hour (minimum configuration) and 5 minutes (payroll), preview with
`forge script contracts/script/DeployTreasuryV2.s.sol --rpc-url arc_testnet`, then deploy with `CONFIRM_DEPLOY=yes`
and a keystore or hardware signer. The script refuses any chain other than Arc Testnet and local anvil.
The older `AskirawaFiTreasury` (v1) and its scripts remain in the repository but are not used by the app.

## Recurring payments keeper

`server/keeper.ts` executes due schedules through `RecurringPaymentModule`. See `docs/keeper-setup.md`.

## Security Notes

- The contracts have NOT been independently audited. Foundry tests live under `contracts/test` (`bun run contracts:test`)
- On-chain proposal payloads are immutable once created
- Sign-in messages must contain the nonce the server issued, an allowed domain and chain, and a short validity window. Nonces are single-use. The session cookie is signed, HttpOnly and SameSite=Strict (Secure in production). Sign-in and nonce requests are rate limited
- Backend roles are labels. The treasury app does not call the backend, and no backend role grants any on-chain permission
- Display names and unsent form drafts live in this browser only. They are never proof of identity, approval or payment
