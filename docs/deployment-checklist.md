# Askirawa Finance Deployment Checklist

Ordered steps to make all five Askirawa Finance features operational.
Complete steps 1–3 before any treasury funding.

---

## Step 1 — Deploy the treasury contract

**You must perform this step yourself. Arc Studio will not deploy, sign, or broadcast transactions.**

### Prerequisites
- A wallet you control on Arc Mainnet (chain ID 5042) with enough USDC for gas (~0.01 USDC covers most deployments).
- [Foundry](https://book.getfoundry.sh/getting-started/installation) installed locally.
- This repository cloned locally (or available in Arc Studio).

### Build first
```bash
cd /path/to/app
forge build
```
Expected: compiles without errors (warnings about timestamps are expected and safe).

### Deploy command

```bash
DEPLOYER_ADDRESS=<YOUR_WALLET_ADDRESS> \
forge script contracts/script/DeployTreasury.s.sol \
  --rpc-url https://rpc.mainnet.arc.io \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY \
  -vvvv
```

**Placeholders — replace before running:**
| Placeholder | What to put |
|---|---|
| `<YOUR_WALLET_ADDRESS>` | The wallet address you are deploying from (becomes the treasury owner and first approver) |
| `$DEPLOYER_PRIVATE_KEY` | Set this in your shell environment: `export DEPLOYER_PRIVATE_KEY=0x...` — never paste the value directly |

**Constructor arguments (hardcoded in the script):**
| Argument | Value | Meaning |
|---|---|---|
| `initialOwner` | Your wallet address | Becomes `owner` and the sole approver; can add approvers and call admin functions |
| `usdcToken` | `0x3600000000000000000000000000000000000000` | Arc Mainnet USDC (ERC-20, 6 decimals) |
| `initialKeeper` | `address(0)` | Keeper disabled at deployment; safe default |
| `initialQuorum` | `1` | One approver (you) can approve proposals; raise later with `setQuorum()` if needed |

### After deployment
1. Note the deployed address from the script output.
2. Verify it on the Arc explorer: `https://explorer.arc.io/address/<deployed-address>`
3. Do NOT fund the treasury yet — wait until VITE_TREASURY_ADDRESS is set and the frontend is deployed.

---

## Step 2 — Set VITE_TREASURY_ADDRESS and deploy the frontend

1. In the project `.env`, add:
   ```
   VITE_TREASURY_ADDRESS=0x<deployed-treasury-address>
   ```
2. Restart the Vite dev server (env vars require a restart): `bun run dev`
3. Confirm the Dashboard shows the treasury address and USDC balance (will be 0 until funded).
4. For production: `bun run build` — serve `dist/` from any static host (Netlify, Vercel, Hugging Face Spaces, Cloudflare Pages).

---

## Step 3 — Deploy the backend and set SESSION_SECRET

The backend (`server/index.ts`) provides SIWE authentication and SQLite-based organisation management for the Team tab.

### Required env vars
| Variable | How to get it |
|---|---|
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `VITE_TREASURY_ADDRESS` | From Step 1 |
| `DATABASE_URL` | Optional — defaults to `./askira.db` in the working directory |
| `PORT` | Optional — defaults to `3001` |

### Start
```bash
# Development
SESSION_SECRET=<random-hex> bun run server:dev

# Production
NODE_ENV=production SESSION_SECRET=<random-hex> bun run server:start
```

The server exits immediately if `SESSION_SECRET` is unset in production mode.

### Hosting options
- **Railway / Render / Fly.io**: set env vars in the platform dashboard, run `bun run server:start` as the start command.
- **VPS with systemd**: see `docs/keeper-setup.md` for a systemd unit template.

### Persistence
The SQLite database (`askira.db`) stores organisations, members, sessions, and audit logs. Back it up regularly. On restart, the database survives as long as the file persists — do not run the server on an ephemeral filesystem (e.g. a container without a volume mount).

---

## Step 4 — Configure the keeper wallet and gas

The keeper (`server/keeper.ts`) is the automation worker that executes recurring payment schedules.

1. Create a dedicated EOA for the keeper (do not reuse the deployer wallet).
2. Transfer a small amount of USDC to the keeper EOA on Arc Mainnet for gas (0.1–1 USDC is enough for many months of execution at current Arc gas prices).
3. Note the keeper EOA address.

---

## Step 5 — Owner calls setKeeper()

**You must perform this step yourself from the owner wallet.**

Call `setKeeper(keeperEOAAddress)` on the deployed treasury. You can do this from any wallet UI that supports custom contract calls (Metamask + Arc network, Rabby, etc.), or via `cast`:

```bash
cast send <TREASURY_ADDRESS> \
  "setKeeper(address)" <KEEPER_EOA_ADDRESS> \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $DEPLOYER_PRIVATE_KEY
```

After this call, `getDueSchedules()` polling by the keeper will trigger live `executeSchedule` transactions.

### Start the keeper
```bash
KEEPER_PRIVATE_KEY=0x<keeper-eoa-key> \
VITE_TREASURY_ADDRESS=0x<treasury-address> \
bun run keeper:start
```

See `docs/keeper-setup.md` for full keeper documentation including systemd and platform hosting.

---

## Step 6 — Verify the Automation Registry integration

The existing Automation Registry at `0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434` is preserved and displayed in the Automations tab.

Full integration (rule execution via the keeper) requires the registry ABI. Two paths:

**Option A — Verify source on Arc explorer:**
1. Go to `https://explorer.arc.io/address/0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434`
2. Submit source code verification using the original deployment source.
3. Once verified, the ABI is public — add it to `src/contracts.ts` as `AUTOMATION_REGISTRY_ABI`.

**Option B — Provide the ABI directly:**
If you have the original ABI JSON, add it to `src/contracts.ts` and extend the keeper to call `executeRule(ruleId)`.

Until one of these steps is completed, registered rules are displayed but not automatically executed.

---

## Step 7 — Test with small amounts before meaningful funding

Before funding the treasury with production amounts:

1. Create a test payroll proposal with a small amount (e.g. 1 USDC) to a wallet you control.
2. Approve and execute the proposal.
3. Verify the USDC arrives in the recipient wallet and `ProposalExecuted` appears on the explorer.
4. Create a test recurring schedule (daily, small amount).
5. Wait for the keeper to execute it (or advance time manually in a fork test).
6. Only after confirming all flows work end-to-end, fund the treasury with meaningful amounts.

---

## Environment variables summary

| Variable | Required for | Where to set |
|---|---|---|
| `VITE_TREASURY_ADDRESS` | Frontend + keeper | `.env`, platform env |
| `SESSION_SECRET` | Backend | Platform secrets manager |
| `KEEPER_PRIVATE_KEY` | Keeper | Platform secrets manager — never commit |
| `DATABASE_URL` | Backend (optional) | Platform env |
| `PORT` | Backend (optional) | Platform env |
| `POLL_INTERVAL_MS` | Keeper (optional) | Platform env |
| `MAX_SCHEDULES_PER_POLL` | Keeper (optional) | Platform env |
| `RETRY_MAX` | Keeper (optional) | Platform env |
| `RPC_PROXY_BASE_URL` | Auto (Arc Studio) | Auto-provisioned |
| `RPC_PROXY_TOKEN` | Auto (Arc Studio) | Auto-provisioned |
| `RPC_PROXY_CHAINS` | Auto (Arc Studio) | Auto-provisioned |

---

## What is NOT live until these steps are complete

| Feature | Blocked by |
|---|---|
| Payroll batches, approvals, execution | Step 1 + Step 2 (VITE_TREASURY_ADDRESS) |
| Recurring schedules (creation) | Step 1 + Step 2 |
| Recurring schedules (auto-execution) | Step 4 + Step 5 (keeper configured) |
| Team / org management | Step 3 (backend running) |
| Automation Registry rule execution | Step 6 (ABI confirmed) |
