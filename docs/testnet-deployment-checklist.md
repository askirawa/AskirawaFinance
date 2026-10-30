# Treasury v2: Arc Testnet deployment checklist

Target: **Arc Testnet, chain ID 5042002**, test funds only. Contracts are unaudited. Nothing here applies to mainnet.
The deploy script refuses any chain other than 5042002 and 31337 (local).

USDC on Arc Testnet: `0x3600000000000000000000000000000000000000`, `symbol()` = USDC, `decimals()` = 6
(verified with a read-only call to the testnet this session; the script re-checks decimals before deploying).

## 0. Preconditions (all must be true)
- [ ] `bun install --frozen-lockfile`, then `forge build` succeeds from this folder.
- [ ] `forge test` passes with no failures (record the counts), and `bun test server` passes.
- [ ] Three **independently controlled** approver wallets exist (different people or devices). Optional separate guardian.
- [ ] Three **independent recovery council** wallets exist (not approvers, not the guardian). Threshold 2 of 3.
- [ ] You can sign with a keystore or hardware wallet. Never paste keys in chat or commit them.
- [ ] The shared Arc Studio platform wallet is not used for any role (the script rejects it).
- [ ] Each approver wallet has Arc Testnet USDC for gas (use the Arc Studio sidebar "Get test USDC").

## 1. Constructor arguments (what the script passes)
| Contract | Argument | Source (env) | Rule enforced |
|---|---|---|---|
| AskirawaTreasury | `usdc_` | `USDC_ADDRESS` | has code, `decimals()` is exactly 6 |
| | `minConfigDelay` | `MIN_CONFIG_DELAY` | >= 3600 s, <= 14 days, immutable |
| | `approvers_` | `APPROVERS` | 3 to 20, distinct, nonzero, no placeholders |
| | `proposers_` | `PROPOSERS` | optional, distinct |
| | `quorum_` | `QUORUM` | >= 2 and <= approvers - 1 (3 approvers: exactly 2) |
| | `guardian_` | `GUARDIAN` or `GUARDIAN_DISABLED=yes` | separate from approvers, or explicitly disabled |
| | `payrollDelay_` | `PAYROLL_DELAY` | >= 300 s, <= 14 days |
| | `configDelay_` | `CONFIG_DELAY` | >= `MIN_CONFIG_DELAY`, <= 14 days |
| TreasuryRecovery (deployed FIRST) | `councilMembers_` | `RECOVERY_COUNCIL` | exactly 3, distinct, nonzero, no placeholders, not approvers, not the guardian |
| | `threshold_` | `RECOVERY_THRESHOLD` | exactly 2 |
| AskirawaTreasury (extra last argument) | `recovery_` | the recovery contract just deployed | has code; the treasury's constructor binds it (`bindTreasury`) |
| RecurringPaymentModule | `treasury_` | the treasury just deployed | has code |
| | `retryDelay_` | `RETRY_DELAY` | 3600 s to 7 days (testnet: 3600) |
| | `maxFailures_` | `MAX_FAILURES` | 1 to 10 (testnet: 3) |

`PER_TX_MAX`, `WINDOW_MAX`, `WINDOW_LENGTH` are not constructor arguments. They are the planned budget for the later
module-enable proposal (testnet: 10 USDC, 50 USDC, 86400 s). The module starts **disabled**.

## 2. Prepare the inputs
1. `cp contracts/script/deploy-v2.env.example .env.deploy-v2` (`.env.*` is git-ignored).
2. Replace every `<...>` placeholder with real addresses. Do not hardcode addresses anywhere else.
3. Import your deployer key into a keystore: `cast wallet import deployer --interactive`.

## 3. Preview (no transaction)
```
set -a; . ./.env.deploy-v2; set +a
DEPLOYER_ADDRESS=<your deployer address> forge script contracts/script/DeployTreasuryV2.s.sol --rpc-url arc_testnet
```
Check: chain 5042002, USDC address, every approver, quorum 2, delays, guardian, and the **predicted treasury and
module addresses** (CREATE from the deployer's current nonce, treasury first, then module). The script stops
with `DeploymentNotConfirmed` until you set `CONFIRM_DEPLOY=yes`.

## 4. Deploy (needs explicit authorization)
```
CONFIRM_DEPLOY=yes forge script contracts/script/DeployTreasuryV2.s.sol --rpc-url arc_testnet --account deployer --broadcast
```
Order: recovery contract, then treasury (its constructor binds the recovery contract to itself), then module (three transactions). If one fails, inspect receipts before re-running. The recovery contract binds to the first treasury that calls it, so a recovery contract that failed to bind must be replaced, not reused.

## 5. Read back before funding or enabling anything
- [ ] Both addresses match the preview prediction; record both deployment tx hashes and the **treasury receipt block**.
- [ ] `currentEpoch()` = 1, `approvers()`, `quorum()` = 2, `payrollDelay()`, `configDelay()`, `MIN_CONFIG_DELAY()`, `guardian()`, `usdc()`.
- [ ] `modules(<module>)` shows `enabled = false`; module `treasury()` equals the treasury; module `retryDelay()` / `maxFailures()`.
- [ ] No one but the listed approvers/proposers has a role (`isApprover`, `isProposer` on the deployer return false).
- [ ] Recovery wiring, both directions: treasury `recovery()` equals the recovery contract and recovery `treasury()` equals the treasury (the script also asserts this).
- [ ] Recovery `councilMembers()` and `councilThreshold()` = 2; `isApprover(member)` is false for every member; `recoveryEligibleAt()` is 30 days after deployment; treasury `coolingEnd()` = 0 and `lastActivityAt()` = deployment time.

## 6. Configure the app
Add to your private `.env` (public values only), then **restart the dev server** (Vite reads env at startup):
```
VITE_CHAIN_ID=5042002
VITE_TREASURY_ADDRESS=<treasury>
VITE_RECURRING_MODULE_ADDRESS=<module>
VITE_RECOVERY_ADDRESS=<recovery>
VITE_TREASURY_DEPLOY_BLOCK=<treasury receipt block>
```
Record the addresses, tx hashes and block in `AGENTS.md`.

## 7. Rehearsal (each result confirmed from chain state, not from the UI alone)
1. Connect a wallet; the dashboard shows the treasury balance read from the contract.
2. Deposit test USDC. Balance increases by exactly the amount.
3. Create a payroll proposal. Approve with two distinct approvers. Execute is **blocked** before the timelock, allowed after.
4. Recipient balances rise by the paid amounts; treasury balance falls by the same total.
5. Pause (guardian or approver); payroll execution is blocked. Propose unpause, approve, wait the config delay, execute.
6. Propose an approver rotation; after it executes, pending proposals show as voided.
7. Lost-key drill: with 3 approvers and quorum 2, rotate out one approver while two keys still work.
8. Propose enabling the module (10 / 50 USDC / 86400 s), approve, wait, execute.
9. Propose a schedule; approve and execute. Run the keeper (see `docs/keeper-setup.md`); verify `ScheduleExecuted` and the recipient balance.
10. Exercise failure limits (pause, then a manual run records a failure), budget exhaustion (keeper skips, no failure recorded), cancellation, and return of module funds.

11. Recovery rehearsal (the local anvil rehearsal covers the logic; repeat on testnet with real wallets because the gates are time based):
    - Council member tries to start a recovery before 30 days of inactivity: must revert (`InactivityNotMet`). A non-council wallet must revert (`NotCouncilMember`).
    - After 30 days without an executed proposal: council member starts a recovery, a second member approves. Read `executableAt` = approval time + 14 days.
    - Execution before the delay reverts (`DelayNotElapsed`). Two approvers veto: status becomes Vetoed and the gate restarts.
    - Repeat to a successful execution on a throwaway deployment: epoch increments, new approvers/council installed, pending proposals show Fenced, `coolingEnd` is 7 days out.
    - During cooling: payroll execute reverts (`SpendingCoolingOff`), module draws revert, the keeper stands down; deposits, governance proposals and unpause still work. Proposals made during cooling need an expiry later than `coolingEnd`.
    - After cooling: call `completeCooling()` once (emits `CoolingPeriodCompleted`), then payroll executes.

Recovery (council of 3, threshold 2, 30 day gate, 14 day timelock with approver-quorum veto, 7 day cooling) is implemented and tested locally.
It is not independently reviewed. See `docs/recovery-design.md` for the architecture and the residual risks.
