# Askirawa Finance Keeper Setup

The keeper worker (`server/keeper.ts`) is a long-running Bun process that polls the treasury on-chain, detects due recurring payment schedules, and executes them without requiring the user to open the application.

## What the keeper does

1. Calls `getDueSchedules(maxCount)` on the treasury — a gas-free view.
2. For each due schedule ID, submits a `executeSchedule(id)` transaction.
3. Advances `nextExecTime` on-chain before the transfer (duplicate prevention in the contract).
4. Emits `ScheduleExecuted` on success or `ScheduleFailed` on insufficient balance.
5. Retries transient RPC failures up to `RETRY_MAX` times; skips contract-level reverts immediately.
6. Prunes its in-process duplicate-prevention set hourly.

## Prerequisites

- A funded EOA wallet whose address will be set as the treasury's keeper.
- `USDC` (6 dec) in the treasury contract itself — the keeper triggers transfers FROM the contract balance.
- The treasury owner must call `setKeeper(keeperEOA)` once after deployment.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `KEEPER_PRIVATE_KEY` | **Yes** | `0x...` private key of the keeper EOA. Keep this secret — never commit it. |
| `VITE_TREASURY_ADDRESS` | **Yes** | Deployed `AskirawaFiTreasury` address. |
| `POLL_INTERVAL_MS` | No | Poll frequency in milliseconds. Default: `60000` (1 minute). |
| `MAX_SCHEDULES_PER_POLL` | No | Max schedules checked per poll round. Default: `20`. |
| `RETRY_MAX` | No | Max RPC retries per schedule per round. Default: `1`. |
| `RPC_PROXY_BASE_URL` | No | Arc Studio provisioned RPC proxy base URL. Auto-detected. |
| `RPC_PROXY_TOKEN` | No | Arc Studio provisioned RPC proxy token. Auto-detected. |
| `RPC_PROXY_CHAINS` | No | Comma-separated proxy chain keys. Auto-detected. |

## Running the keeper

```bash
# Development (auto-restarts on file change)
KEEPER_PRIVATE_KEY=0x... VITE_TREASURY_ADDRESS=0x... bun run keeper:dev

# Production
KEEPER_PRIVATE_KEY=0x... VITE_TREASURY_ADDRESS=0x... bun run keeper:start
```

## Security notes

- `KEEPER_PRIVATE_KEY` is a hot wallet key. Fund it with only enough USDC gas for transaction fees.
- The keeper EOA can ONLY call `executeSchedule` — it cannot create proposals, add approvers, or move USDC freely.
- On Arc Mainnet, native gas IS USDC (18-decimal view). Keep a small USDC balance on the keeper EOA for gas.
- Never set `KEEPER_PRIVATE_KEY` in `.env` in the repository. Use a secrets manager or environment injection.

## Deployment options

### Fly.io / Railway / Render
Set environment variables as secrets in the platform dashboard. Run:
```
bun run keeper:start
```

### Systemd (VPS)
```ini
[Unit]
Description=Askirawa Finance Keeper
After=network.target

[Service]
ExecStart=/usr/local/bin/bun /path/to/app/server/keeper.ts
EnvironmentFile=/etc/askirawaFi/keeper.env
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### After deployment
1. Confirm the keeper address logs at startup.
2. Call `setKeeper(keeperAddress)` on the treasury from the owner wallet.
3. Watch logs for `[keeper] executed schedule N — tx 0x...` messages.

## Automation Registry integration

The existing Automation Registry at `0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434` is preserved. Its source is not verified on-chain. To enable full integration:

1. Verify the contract source on the Arc explorer at `https://explorer.arc.io`.
2. Or provide the ABI JSON — add it to `src/contracts.ts` as `AUTOMATION_REGISTRY_ABI`.
3. The keeper can then call `executeRule(ruleId)` for eligible rules and route them to the treasury.

Rules registered in the registry are displayed in the Automations tab with integration status.
