# Keeper setup (Treasury v2)

The keeper is a small worker that calls `RecurringPaymentModule.execute(id)` for schedules that are due.
It needs gas only. It has **no governance role**, cannot approve, cannot move funds by itself, and every payment it
triggers is still limited by the schedule terms and the treasury's module budget.

## Requirements
- Treasury v2 and the module deployed and the module **enabled by governance** (see the testnet checklist).
- A dedicated wallet with a small gas balance (Arc Testnet USDC). Never reuse an approver or deployer key.

## Environment
| Variable | Required | Purpose |
|---|---|---|
| `KEEPER_PRIVATE_KEY` | yes | the keeper's key. Secret: private `.env` only |
| `VITE_TREASURY_ADDRESS` | yes | deployed treasury |
| `VITE_RECURRING_MODULE_ADDRESS` | yes | deployed module |
| `VITE_CHAIN_ID` | no | default 5042002 (Arc Testnet). 5042 is refused unless `KEEPER_ALLOW_MAINNET=yes` |
| `POLL_INTERVAL_MS`, `MAX_SCHEDULES_PER_POLL`, `MAX_SCAN`, `RETRY_MAX`, `RECEIPT_TIMEOUT_MS` | no | tuning |

## Run
```
bun run keeper:start        # or keeper:dev to watch
bun run test:server         # unit tests (and the anvil rehearsal when anvil and artifacts exist)
```

## What each round does
1. Stops if the treasury is paused, if the 7 day post-recovery spending cooling period is active (`coolingEnd`), the module is not enabled, or the module code no longer matches the code pinned by the treasury.
2. Finds due schedules (`isDue`). Skips any restricted to another executor (the keeper is not authorized).
3. Skips, **without sending a transaction**, any schedule that would exceed the per-payment limit or the remaining window budget,
   or whose payment (plus its minimum-balance condition) the treasury balance cannot cover. This matters: the module records a
   failed payment as a soft failure instead of reverting, and too many failures auto-pause the schedule until governance resumes it.
4. Simulates, sends, and waits for the receipt. A schedule is reported **paid** only if the confirmed receipt contains the
   module's `ScheduleExecuted` event. Soft failures, auto-pause, completion, reverts and missing receipts are reported separately.
5. Never resends a submitted transaction automatically; an unconfirmed one is re-evaluated in the next round from chain state.

RPC failures are retried for reads; if the first reads fail the round is skipped and nothing is sent.
Provisioned `RPC_PROXY_*` variables are used when they cover the chain, otherwise the chain's public endpoint.
