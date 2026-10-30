# Treasury v2 migration and testnet readiness report

Nothing was deployed, broadcast or funded. No mainnet configuration was written. Both Automation Registry
addresses (`0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434`, `0x9b91860D5cb9A0CFCAA306B3DbA135a1E68336d3`) are
untouched. The contracts are unaudited and this report is not an audit or a production-readiness claim.

## 1. Results actually run

| Check | Command | Result |
|---|---|---|
| Solidity build | `forge build` (after `bun install --frozen-lockfile`) | succeeded from the repository itself, no external remapping flags |
| All Foundry tests | `forge test` | **731 passed, 0 failed** (38 suites: v1, v2, deploy script, invariants, fuzz) |
| Previously failing test | `test_PAY12_NoAbiFunctionOrEventNamedSkipPartialAtomicOrForce` | **passed**, run with the build artifacts present |
| Invariants | included above | 16 v2 invariants at 256 runs x 25,600 calls each, all passed |
| Keeper unit tests | `bun test server` | 22 tests passed |
| Frontend helper tests | `bun test server` | 8 tests passed |
| Local rehearsal on anvil | `bun test server` | 12 tests passed (see section 6). This is NOT the Arc Testnet rehearsal |
| Frontend typecheck | `tsc --noEmit` | 0 errors |
| Frontend lint | `oxlint --type-aware src scripts` | 0 warnings, 0 errors |
| Keeper typecheck and lint | temp tsconfig for `server/keeper*.ts`, `server/chain.ts`; `oxlint` on new server files | 0 errors |
| Production bundle | `vite build` (output to /tmp) | succeeded |
| Static analysis | Slither 0.11.6 on v2 contracts, `docs/static-analysis-slither.txt` | 32 results, no reentrancy, access-control, arbitrary-send or fund-loss detectors. See section 7 |

Not done: no run in a real browser with a wallet (the UI was compiled, type-checked and linted, never viewed);
no Arc Testnet deployment or rehearsal; the repository's own `bun run lint` was not run because it uses `--fix`
across every tracked file; existing type-aware lint errors in `server/db.ts` and `server/index.ts` were not
touched; no independent audit.

## 2. Files changed

Contracts and deployment
- `contracts/script/DeployConfigValidator.sol`: policy floors (3+ approvers, quorum between 2 and approvers - 1, min config delay >= 1h, payroll delay >= 5m, separate guardian or explicit opt-out).
- `contracts/script/DeployTreasuryV2.s.sol`: reads `GUARDIAN_DISABLED`; prints predicted treasury and module addresses when `DEPLOYER_ADDRESS` is set.
- `contracts/script/deploy-v2.env.example`: testnet-only template with the new variables.
- `contracts/test/v2/Deploy*.t.sol`: updated for the stricter policy; new cases for each new rule.
- `foundry.toml`: `arc_testnet` RPC alias. `package.json`: `contracts:setup`, `contracts:test:v2`, `contracts:slither`, `test:server`.
- The core contracts `AskirawaTreasury` and `RecurringPaymentModule` are **unchanged**.

Frontend (new: `src/lib/v2/`, `src/hooks/v2/`, `src/components/v2/`, `src/pages/Governance.tsx`)
- Pages rewritten to read and write Treasury v2: Dashboard (overview section added), Payroll, Approvals, Recurring Payments, Activity, Transactions. New Governance page, nav item and route.
- `src/vite-env.d.ts`, `env.example`: new public variables.

Keeper: `server/keeper-core.ts` (new, tested), `server/keeper.ts`, `server/chain.ts`, tests `server/*.test.ts`.

Docs: `docs/recovery-design.md`, `docs/testnet-deployment-checklist.md`, `docs/keeper-setup.md`, `docs/static-analysis-slither.txt`, this report, `README.md`, `AGENTS.md`.

## 3. Final Treasury v2 architecture
- `AskirawaTreasury`: immutable, no owner. Approvers vote; minimum quorum 2; proposals snapshot the epoch's quorum; timelocks (payroll/module action/rescue use the payroll delay, governance/module config/unpause use the config delay); a governance change starts a new epoch and voids older pending proposals; guardian can pause and cancel non-governance proposals only; every outflow is balance-checked; every mutator is non-reentrant.
- `RecurringPaymentModule`: separate contract, bound to one treasury, starts disabled. It can only draw through `payFromModule`, which enforces a codehash pin, a per-payment cap and a per-window cap set by governance. Its own funds can only return to the treasury.
- Deployment policy lives in the script and validator. Anyone who deploys the core directly bypasses it, so the checklist requires the script.

## 4. Recovery mechanism
**Not implemented.** The treasury exposes no hook for any recovery contract, so recovery has to be added to the core before deployment, which changes the security architecture. `docs/recovery-design.md` gives the recommended design (recovery council in the core, installs governance only, cannot move funds, long delay, quorum veto, inactivity gate, cooling-off), attack scenarios, trade-offs and the exact core changes needed. The anvil rehearsal's last test shows that with two of three approver keys lost nothing can execute. Decision needed from you: option A, B-a, B-b or B-c, plus council size/threshold, delay, inactivity period and cooling-off.

## 5. Frontend migration
Done and compiling: balance and deposits (approve then deposit), payroll proposals, approve/reject, quorum progress, timelock countdown, expiry, cancel, execute, governance rotation with lockout warnings, pause and unpause proposal, module configuration, schedule/resume/return-funds proposals, schedule list with execute/pause/cancel, event history with scan progress.
- A write shows success only after a mined receipt with status success. Reverts, wallet rejections and timeouts show an explicit failed state with a decoded reason.
- Recurring execution is additionally checked against the receipt logs, because the module records a failed payment as a soft failure instead of reverting.
- States shown: pending, approved, executable, executed, cancelled, rejected, expired, voided (epoch changed).

Still not migrated: Analytics, Audit Log and Notifications read browser-local records and do not reflect chain state; the old v1 components/hooks (`useTreasury`, `ApprovalDetail`, `BatchDetail`, ...) remain in the repository unused; token rescue has no UI.

## 6. Keeper migration
`server/keeper-core.ts` targets `RecurringPaymentModule.execute(id)`. It stops when the treasury is paused, the module is disabled or its code no longer matches the pinned hash; skips schedules restricted to another executor; skips (without sending) payments that exceed the per-payment cap, the remaining window budget (tracked within the round) or the treasury balance; simulates before sending; never resends a submitted transaction; and reports **paid** only when the confirmed receipt contains `ScheduleExecuted`. Soft failures, auto-pause, completion, reverts and unconfirmed transactions are reported separately. Mainnet is refused unless `KEEPER_ALLOW_MAINNET=yes`.

Local rehearsal (`server/v2-rehearsal.anvil.test.ts`, throwaway anvil chain, same ABIs and keeper code as the app): deployment read-back, deposit, payroll quorum and timelock, insufficient balance, pause/unpause, guardian cancel limits, approver rotation and voiding, governance-enabled module, schedule creation, keeper payment, budget exhaustion skip with zero recorded failures, soft failure reporting, keeper idle while paused, cancellation, return of module funds, one-lost-key survival and two-lost-keys lock.

## 7. Static analysis (Slither)
No high-impact detectors fired. Findings and my reading of them:
- `incorrect-equality` (3): enum comparisons and `amount == 0` before reverting `NothingToRecover`; no exploitable effect found.
- `uninitialized-local` (5): counters that intentionally start at zero.
- `unused-return` (2): `ScheduleMath.add(...)` used only for its overflow revert; a tuple read that needs one field.
- `calls-loop` (1): in a view function (`dueSchedules`).
- `timestamp`, `cyclomatic-complexity`, `naming-convention`: informational. Timestamp use is the intended timelock mechanism.
These readings are mine and are not a substitute for an independent audit.

## 8. Issues that still block deployment
1. **Testnet deployment itself** needs your explicit authorization, your approver/guardian addresses and a signer. None was provided or used.
2. **Browser rehearsal on Arc Testnet** (section 10 of your plan) has not happened. The local anvil rehearsal does not replace it.
3. **Recovery (D9)** is undecided and unimplemented: mainnet blocker, acceptable for testnet with the interim controls in `docs/recovery-design.md`.
4. **Independent audit** not done: mainnet blocker.
5. Single compromised approver can pause the treasury or cancel a recurring schedule; recipients that cannot receive USDC block an entire payroll batch (all-or-nothing by design); a schedule can be auto-paused by repeated failures while the treasury is paused. These are documented design properties, not fixed.
6. The core does not enforce the deploy-policy floors, only the script does.
7. Unmigrated local-only pages and unused v1 code listed in section 5.

## 9. Recommendation
Testnet deployment is appropriate once you authorize it and supply the three approver addresses, the guardian address (or the explicit opt-out) and a signer, following `docs/testnet-deployment-checklist.md`. Mainnet is not appropriate until recovery is decided and implemented, an independent audit is complete, and the remaining items above are closed.
