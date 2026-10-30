# Askirawa Finance — Agent Notes

> Built with Arc Studio - money-powered apps in minutes

## What This App Does

Askirawa Finance is a programmable USDC treasury on Arc Mainnet. It supports atomic on-chain payroll batches, multi-approver proposal workflows, recurring automated payment schedules, automation registry integration, and persistent cross-device organization management with SIWE authentication.

## Network

- Chain: Arc Mainnet (chain ID 5042)
- USDC: `0x3600000000000000000000000000000000000000`
- Explorer: https://explorer.arc.io

## Deployed Contracts

| Contract | Address | Status |
|---|---|---|
| AskirawaFiTreasury | NOT DEPLOYED | Source ready — owner must deploy via `forge script` and set VITE_TREASURY_ADDRESS in .env |
| Automation Registry | `0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434` | Deployed on Arc Mainnet, ABI unverified |

## Implementation Status

### Feature 1: On-chain Payroll (IMPLEMENTED — deployment required)
- `createPayrollBatch(address[], uint256[], string)` creates atomic batch proposals
- Payroll is stored entirely on-chain; recipients and amounts are immutable once proposal is created
- Execution transfers all recipients atomically — if any transfer fails, entire tx reverts
- Proposal lifecycle: Pending → Approved (quorum met) → Executed / Rejected / Cancelled / Expired
- UI: Payroll tab with multi-recipient form, batch preview, on-chain history

### Feature 2: Enforced On-chain Approvals (IMPLEMENTED — deployment required)
- Treasury contract enforces quorum, expiry, cancellation, rejection, double-execution prevention
- UI: Approvals tab showing real proposal state from `getProposal()` and `getProposalRecipients()`
- Each action (approve/reject/execute/cancel) is a real on-chain transaction
- No localStorage used for security-relevant approval state

### Feature 3: Automatic Recurring Payments (IMPLEMENTED — keeper deployment required)
- `createSchedule()` stores recipient, amount, frequency (daily/weekly/monthly) and nextExecTime on-chain
- `executeSchedule()` is keeper-only; updates nextExecTime BEFORE transfer (duplicate prevention)
- `getDueSchedules(maxCount)` returns IDs where `active && !cancelled && nextExecTime <= block.timestamp`
- Keeper worker: `server/keeper.ts` — polls getDueSchedules, calls executeSchedule, retries with RETRY_MAX limit
- Failure-safe: on transfer failure, increments failCount and emits ScheduleFailed without reverting the keeper call
- **Remaining**: Deploy keeper with a funded EOA + KEEPER_PRIVATE_KEY; set that EOA as treasury's keeper address via `setKeeper()`

### Feature 4: Programmable Automations (INTEGRATED — registry ABI required for full activation)
- Automation Registry at `0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434` is preserved and linked in UI
- Registry ABI is unknown (source not verified on-chain); cannot safely call it without verified interface
- Keeper worker is designed to also process registry rule callbacks once ABI is available
- UI: Automations tab explains status, shows keeper architecture, and documents the activation steps
- **Remaining**: Verify registry source on Arc explorer, or provide ABI JSON to enable `executeRule()` calls

### Feature 5: Organization and Team Management (IMPLEMENTED — server startup required)
- Backend: `server/index.ts` — Express-style Bun server on port 3001
- Database: `server/db.ts` — SQLite via `bun:sqlite` with WAL mode for durability
- Auth: SIWE (Sign-In With Ethereum) with nonce-based replay prevention and server-side ecrecover via viem
- Routes: `/api/auth/nonce`, `/api/auth/verify`, `/api/auth/logout`, `/api/org`, `/api/org/members`, `/api/profile`
- All protected routes enforce server-side role checks; frontend role values are never trusted
- UI: Team tab with SIWE login, org creation, member invite, role display, display name
- **Remaining**: Start backend with `bun run server:dev`; set `SESSION_SECRET` env var for production

## Contract Notes

- 94/94 Foundry unit tests pass (see `contracts/test/`)
- 3 low-severity findings from tests:
  1. `constructor`: `ZeroAddress()` check for `initialOwner` is dead code (OZ fires first)
  2. `approve`: wrong error when double-approving after quorum=1 (status guard runs before hasApproved check)
  3. `resumeSchedule`: reuses `InvalidProposalStatus()` for schedule state — informational only
- block.timestamp warnings in forge-lint are expected for time-based treasury logic

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_TREASURY_ADDRESS` | Yes (after deploy) | Deployed AskirawaFiTreasury address |
| `SESSION_SECRET` | Yes (server) | Random secret for session cookies |
| `DATABASE_URL` | No | SQLite path (default: `./askira.db`) |
| `KEEPER_PRIVATE_KEY` | Yes (keeper) | Private key of the keeper EOA |
| `POLL_INTERVAL_MS` | No | Keeper poll frequency in ms (default: 60000) |
| `MAX_SCHEDULES_PER_POLL` | No | Max schedules per keeper round (default: 20) |
| `RETRY_MAX` | No | Max retries per failed schedule (default: 1) |
| `RPC_PROXY_BASE_URL` | No | Arc Studio RPC proxy (auto-provisioned) |
| `RPC_PROXY_TOKEN` | No | Arc Studio RPC proxy token |
| `RPC_PROXY_CHAINS` | No | Comma-separated proxy chain keys |

## Key Files

- `contracts/AskirawaFiTreasury.sol` — Treasury contract
- `contracts/IAutomationRegistry.sol` — Minimal keeper interface for the registry
- `contracts/test/` — 94-test Foundry suite
- `server/index.ts` — SIWE + SQLite backend (port 3001)
- `server/keeper.ts` — Recurring payment keeper worker
- `server/db.ts` — SQLite schema and query helpers
- `server/chain.ts` — Arc Mainnet chain definition + RPC resolver
- `src/contracts.ts` — Treasury ABI and addresses
- `src/components/` — Dashboard, Payroll, Approvals, Schedules, Automations, Team

## Deployment Script

`contracts/script/DeployTreasury.s.sol` — verified Forge script for Arc Mainnet deployment.

```bash
DEPLOYER_ADDRESS=<YOUR_WALLET_ADDRESS> \
forge script contracts/script/DeployTreasury.s.sol \
  --rpc-url https://rpc.mainnet.arc.io \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY \
  -vvvv
```

See `docs/deployment-checklist.md` for the full ordered checklist.

## What Requires External Setup

1. **Deploy AskirawaFiTreasury** — run `DeployTreasury.s.sol` script; set `VITE_TREASURY_ADDRESS` in .env
2. **Deploy the keeper** — any host that can run a persistent Bun process (Railway, Render, Fly.io, VPS)
3. **Verify Automation Registry ABI** — verify source at 0x5E13...1F434 on Arc explorer, or provide ABI
4. **Start the backend** — `SESSION_SECRET=<hex> bun run server:start` (exits on startup if SESSION_SECRET unset in NODE_ENV=production)
5. **Set keeper address** — call `setKeeper(keeperEOA)` on the treasury after deploying the keeper
