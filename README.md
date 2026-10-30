# Askirawa Finance

Askirawa Finance — Programmable USDC Treasury built on Arc. Run payroll batches, approvals, recurring payments and team roles for your organization in USDC on Arc Mainnet.

Built with [Arc Studio](https://studio.arc.io)

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry
- Backend: Bun server, SQLite (`bun:sqlite`), SIWE authentication
- Chain: Arc Mainnet (chain ID 5042), USDC at `0x3600000000000000000000000000000000000000`

## Features

- **Payroll** — atomic USDC batch proposals; all recipients pay in a single transaction or nothing
- **Approvals** — on-chain multi-approver voting with configurable quorum, expiry, and cancellation
- **Schedules** — recurring daily/weekly/monthly USDC payments executed by the keeper worker
- **Automations** — keeper integration with the deployed Automation Registry (ABI verification required)
- **Team** — SIWE-authenticated organization management with roles stored in a SQLite database

## Development

### Prerequisites

- [Bun](https://bun.sh) 1.x
- [Foundry](https://book.getfoundry.sh/getting-started/installation)

### Install

```bash
bun install
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_WC_PROJECT_ID` | For mobile wallets | WalletConnect project ID from [cloud.reown.com](https://cloud.reown.com). Public identifier, read at build time |
| `VITE_TREASURY_ADDRESS` | After deploy | Deployed AskirawaFiTreasury contract address |
| `SESSION_SECRET` | Server | Random 32-byte hex string for session cookies |
| `DATABASE_URL` | No | SQLite file path (default: `./askira.db`) |
| `KEEPER_PRIVATE_KEY` | Keeper | Private key of the keeper EOA wallet |
| `POLL_INTERVAL_MS` | No | Keeper poll frequency in ms (default: 60000) |
| `MAX_SCHEDULES_PER_POLL` | No | Max schedules checked per round (default: 20) |
| `RETRY_MAX` | No | Max retries per failed schedule (default: 1) |
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
# Smart contract tests (Foundry)
bun run contracts:test

# Lint + typecheck
bun run check
```

## Wallet connection

Desktop browser wallets work without any setup. Phone wallet apps (MetaMask Mobile, Trust, Rainbow and others) connect through WalletConnect, which needs `VITE_WC_PROJECT_ID`.

1. Create a free project at [cloud.reown.com](https://cloud.reown.com) and copy its Project ID.
2. In Vercel open your project, go to **Settings > Environment Variables**, and add `VITE_WC_PROJECT_ID` for Production (and Preview).
3. **Redeploy.** Vite reads `VITE_` variables when the app is built, so changing the value has no effect until a new build runs.
4. In the Reown dashboard, add your site domain (for example `askirawa-finance.vercel.app`) to the project's allowed domains.

To test on a phone: open the live site in your phone browser, tap **Connect wallet**, choose your wallet app, approve the connection, then switch to Arc Mainnet (chain ID 5042) when asked. Also try opening the site from inside your wallet app's built-in browser.

## Contract Deployment

The `AskirawaFiTreasury` contract is not yet deployed. See `docs/deployment-checklist.md` for the full ordered process. Quick reference:

```bash
# 1. Build contracts
bun run contracts:build

# 2. Set your deployer wallet address, then run the deployment script
export DEPLOYER_PRIVATE_KEY=0x<your-private-key>   # set in shell — never commit
export DEPLOYER_ADDRESS=$(cast wallet address --private-key $DEPLOYER_PRIVATE_KEY)

# Approvers: at least 2 addresses (a proposer cannot approve their own request).
# Keep QUORUM below the approver count so a proposer can never lock the treasury.
export APPROVERS=0xApprover1,0xApprover2,0xApprover3
export QUORUM=2

DEPLOYER_ADDRESS=$DEPLOYER_ADDRESS \
forge script contracts/script/DeployTreasury.s.sol \
  --rpc-url https://rpc.mainnet.arc.io \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY \
  -vvvv

# 3. Record the deployed address, then add to .env
#    VITE_TREASURY_ADDRESS=0x<deployed-address>
```

The script deploys to Arc Mainnet (chain ID 5042), enforces this with a `require(block.chainid == 5042)` guard, and prints next steps. USDC is fixed in the script at `0x3600000000000000000000000000000000000000`; the owner, approvers and quorum come from the environment variables above.

## Recurring payments service (not current)

`server/keeper.ts` and `src/contracts.ts` were written for an earlier treasury design that had on-chain schedules and a keeper. The current `AskirawaFiTreasury` contract has no schedules and no keeper, so that service cannot work against it and recurring payments are run by hand in the app. Treat those two files as outdated until they are rewritten.

## Security Notes

- The treasury contract has NOT been independently audited. Foundry tests live under `contracts/test` (`bun run contracts:test`)
- On-chain proposal payloads are immutable once created
- SIWE nonces are single-use and expire after 5 minutes
- All backend role checks are server-side; frontend role values are never trusted
