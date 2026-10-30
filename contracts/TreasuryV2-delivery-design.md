# Askirawa Treasury v2: Delivery (Part 4 of 4, rev 2)

Parts: [1 Core](./TreasuryV2-design.md) | [2 Modules](./TreasuryV2-modules-design.md) | [3 Security](./TreasuryV2-security-design.md) | **4 Delivery (this file)**

Covers frontend integration, the Foundry test plan, the testnet plan, migration from the current app, open decisions and risks.

## 1. Frontend integration

### 1.1 Principle: three kinds of data, never mixed

| Kind | Examples | Where | Authority |
|---|---|---|---|
| Onchain fact | proposals, payloads, votes, approver set, quorum, balances, schedules, payments, failures | contract state and events | the only proof of an approval, payment or execution |
| Off-chain metadata | recipient names, notes, invoice files, team labels, notification preferences | optional backend (SIWE) or browser | descriptive only; shown with an "off-chain label" marker; never gates an action |
| Local draft or cache | unsent proposal forms, pending tx hashes, last indexed block, decoded-event cache | localStorage or IndexedDB, versioned keys | none; always re-derivable or discardable |

Rules that follow:
- A payment is "Paid" only when a confirmed receipt exists and the `PaymentSent` or `ScheduleExecuted` event decodes to the expected values. Nothing in localStorage can display "Approved", "Executed" or "Paid".
- Before the wallet prompt for any vote or execution, the UI reads the proposal from the chain and shows recipients, amounts, total, expiry, executable time and the epoch check. It never signs from cached data.
- The existing role model (owner, admin, finance manager, approver, viewer) maps to onchain authority only for approver, proposer and guardian. Other roles remain off-chain labels with no authority.

### 1.2 Module layout (extends the current architecture, same pages and visual system)

| New or changed file | Purpose |
|---|---|
| `src/lib/treasuryV2.ts` (new) | ABIs, addresses from `VITE_TREASURY_ADDRESS`, `VITE_RECURRING_MODULE_ADDRESS`, `VITE_TREASURY_DEPLOY_BLOCK`; chain ids and USDC from `@/onchain-facts`; amounts only via `@/onchain-money` |
| `src/lib/chainState.ts` (new) | typed readers: `getProposal`, `getPayroll(page)`, `getEpoch`, `getSchedule`, multicall batching |
| `src/lib/chainEvents.ts` (new) | event decoding, log paging, cache keyed by chain, contract and block |
| `src/lib/txErrors.ts` (new) | custom-error decoding to plain messages |
| `src/hooks/useProposals.ts`, `useGovernance.ts`, `useSchedulesOnchain.ts`, `useTxTracker.ts` (new) | replace the authority role of `usePayroll`, `useApprovals`, `useRecurring`, `useTreasury` |
| `src/lib/payroll.ts`, `approvals.ts`, `recurring.ts` | shrink to draft shapes and form validation; remove status logic |
| `src/pages/Payroll.tsx`, `Approvals.tsx`, `RecurringPayments.tsx`, `Dashboard.tsx`, `Activity.tsx`, `Transactions.tsx`, `Analytics.tsx`, `AuditLog.tsx` | same layout, data from the new hooks; the sample-data feeds are removed |
| `src/pages/Automations.tsx` | becomes "Rules" over the schedule module; legacy registry shown read-only in a Legacy panel (with the corrected tuple decoding) |
| `src/pages/Organization.tsx` | approver, proposer and guardian lists read from chain; "Change team" opens a governance proposal; labels stay off-chain |
| `server/*` | optional: SIWE for metadata only; no authority |

Existing shared components, tokens, navigation and page structure are kept. New screens reuse `PageHeader`, `SectionCard`, `StatCard`, `Badge`, `Button`.

### 1.3 Event indexing

- **Start block.** Always `VITE_TREASURY_DEPLOY_BLOCK`, taken from the deployment receipt. Never block 0. If it is missing, the UI states that history cannot be loaded and offers state reads only.
- **Reads for state, events for history.** Current state (open proposals, schedules, approver set) comes from view calls (multicall) so the UI works even with no log history. Events fill timelines, receipts, analytics and the audit log.
- **Paging.** Logs are fetched in bounded block ranges forward from the last cached block; the cache stores `lastScannedBlock` per chain and contract.
- **Progress as facts.** The Activity and Audit screens show "scanned block X of head Y, Z blocks remaining". They never say "up to date" while behind the head.
- **Reorg safety.** The last `N` blocks scanned are re-read on each pass (N from Arc finality documentation, to be confirmed). Cached events older than that are treated as final.
- **RPC.** Reads use the wagmi/viem transports; limits are unknown until measured on testnet (R6). If scanning proves slow, an optional server-side indexer (decision D14) writes the same decoded rows to SQLite; the browser still verifies the state it is about to sign.

### 1.4 Transaction lifecycle in the UI

| State | Trigger | UI |
|---|---|---|
| Draft | form filled | local only, labelled "Not submitted" |
| Awaiting signature | wallet prompt open | button disabled, cancel allowed |
| Submitted | hash returned | hash saved to the pending list (local) so it can be resumed after reload |
| Pending | no receipt yet | spinner, explorer link, elapsed time |
| Confirmed | receipt `status == success` and expected event decoded | green state, shows decoded values from the event, not from the form |
| Reverted | receipt `status == reverted` | error decoded from custom error data (simulate the call first to get the reason) |
| Dropped or replaced | hash not found after timeout, nonce used by another tx | "Not confirmed" with retry guidance; state re-read from chain |
| Rejected in wallet | user denied | neutral message, no error styling |

Pre-flight on every write: connected chain equals the configured chain (offer `switchChain`), caller has the needed role (read `isApprover`/`isProposer` for the proposal's epoch), proposal is in the right state, and `simulateContract` succeeds. After confirmation, state is re-read and invalidated in the query cache.

Error mapping covers at least: `NotApprover`, `AlreadyVoted`, `WrongEpoch`, `Expired`, `QuorumNotReached`, `DelayNotElapsed`, `Paused`, `InsufficientBalance(have, need)`, `BudgetExceeded`, `NotDue`, `ModuleDisabled`, USDC transfer failures (generic), and user rejection.

### 1.5 Screens, what changes

- **Payroll.** Create flow builds a proposal draft (recipients, amounts, expiry, memo). Submit sends `proposePayroll`. The list shows onchain status, approvals versus quorum, executable time, and the decoded recipient table (paged). Execute button appears only when the chain says it is executable.
- **Approvals.** Inbox of Pending proposals in the current epoch that the connected wallet may vote on, with full contents; fenced and expired items appear under History with the reason.
- **Recurring / Rules.** Schedule list from the module; next due, last receipt, failure count, pause state. Actions: pause and cancel (single signer), resume and create (open a proposal).
- **Team.** Approver, proposer, guardian, quorum, delays, current epoch. Changing them creates a governance proposal and warns that pending proposals will be voided.
- **Dashboard and Analytics.** Balance, open proposals, due schedules, module budget use, all from chain.

## 2. Required Foundry test cases

Run all with `forge test`; fuzz and invariant runs at 1,000+ for CI. Targets: 100 percent branch coverage on governance, voting, execution and budget code; Slither clean or each finding justified. Mocks: a standard USDC mock, a mock with blocklist and pause, a reentrant token, a reentrant recipient (to prove no hook exists), a hostile module, a non-ERC-165 contract.

| Group | Cases |
|---|---|
| G-GOV | 01 constructor stores epoch 1; 02 constructor rejects zero or duplicate approvers, fewer than 2 approvers, quorum 0, quorum 1, quorum above count, more than 20 approvers; 03 governance proposal rejects duplicates; 04 governance proposal rejects quorum below 2, fewer than 2 approvers, or quorum above count; 05 same validation re-runs at execution; 06 governance execution creates a new epoch and never edits the old one; 07 `MIN_QUORUM` equals 2 and no function can lower it (selector scan, fuzz over quorum and approver-count pairs) |
| G-EPOCH | 01 proposal stores epoch and quorum; 02 approver of epoch N cannot vote on a proposal from epoch N+1 unless in that set; 03 removed approver cannot vote; 04 pending proposal cannot execute after epoch change; 05 two governance proposals: second is fenced; 06 old epochs remain readable and unchanged |
| G-VOTE | 01 proposer who is approver auto-approves once; 02 non-approver proposer does not count; 03 double vote reverts; 04 non-approver reverts; 05 reject path reaches Rejected at the right threshold; 06 vote after expiry, cancel or execute reverts |
| G-PAY | 01 `getPayroll` returns every item; 02 totals equal sum, stored `totalAmount` matches; 03 payload hash matches payload; 04 events carry every item; 05 execute takes no arrays, pays exactly stored items; 06 expiry bounds, delay and `minWindow` enforced; 07 one reverting recipient reverts the whole execution and leaves status Pending; 08 insufficient balance reverts with `have` and `need`; 09 zero amount, zero or self address, empty or oversized batch revert; 10 execute twice reverts; 11 balance-delta equals total; 12 no partial path exists: no skip or partial function or flag in the ABI, and fuzzing the index of a failing recipient always leaves every balance unchanged and the proposal Pending (D5) |
| G-CANCEL | 01 proposer cancels own; 02 other proposer cannot; 03 guardian cancels payroll, module and rescue proposals; 04 guardian cannot cancel governance or unpause; 05 no one cancels after execution; 06 no owner function exists (selector scan) |
| G-PAUSE | 01 guardian and any approver can pause; 02 non-role cannot; 03 paused blocks payroll execute, `payFromModule`, `fundModule`; 04 governance and unpause still execute while paused; 05 unpause needs quorum and `configDelay` |
| G-RESCUE | 01 rescue other token succeeds only by proposal; 02 USDC rescue reverts; 03 rescue executes once |
| G-MOD | 01 enable requires ERC-165, code, matching `treasury()`; 02 `perTxMax` and `windowMax` enforced, window rolls over; 03 codehash change reverts draws; 04 disabled module cannot draw; 05 hostile module cannot exceed budget; 06 non-module caller of `payFromModule` reverts; 07 `onApproved` callable only by core |
| M-SCHED | 01 create via proposal only; 02 validation of every field; 03 execute before due reverts; 04 execute pays once per period, `executedCount` increments; 05 second call same period reverts; 06 restricted executor honored, approver always allowed; 07 pause, resume with and without `skipMissed`, cancel terminal; 08 `maxExecutions`, `maxTotal`, `endTime` complete the schedule; 09 `minTreasuryBalanceAfter` soft-fails; 10 backlog above 3 auto-pauses; 11 start in the past clamps to now |
| M-MATH | 01 daily and weekly exact; 02 every reference vector in Part 2 section 2.4 (31 Jan, 30 Jan, 29 Jan, leap and non-leap February, 29 Feb anchor, 2100 and 2400 century rules, year carry, last second of day); 03 no drift or clamp accumulation over 120 monthly periods for every anchor day 1 to 31; 04 fuzz against an independent reference implementation; 05 overflow bounds and year-9999 limit; 06 skip-missed finds the first period after now for monthly schedules within one correction step; 07 anchor taken from the execution time when the approved start is in the past |
| S-FAIL | 01 empty treasury soft-fails and records `ExecutionFailed`; 02 retry gated by `retryDelay`; 03 auto-pause after `maxFailures`; 04 deposit then retry succeeds and resets failures; 05 blocklisted recipient classified `TOKEN_REVERT`; 06 USDC paused mock; 07 budget exhausted mid-window then next window pays; 08 third-party caller cannot exceed one failure per `retryDelay` |
| S-REENT | 01 reentrant token cannot reenter `execute`; 02 hostile module reentering core entry points reverts; 03 reentry into `execute(scheduleId)` reverts |
| INV | 01 USDC conservation: treasury balance change equals deposits minus executed payroll minus module draws; 02 an executed proposal never returns to Pending; 03 schedule `totalPaid` equals sum of `ScheduleExecuted.amount`; 04 module window spend never exceeds `windowMax`; 05 no function moves USDC without an event; 06 `executedCount` never decreases |
| FORK | 01 real Arc Testnet USDC address, decimals 6; 02 deposit, propose, vote, execute against the real token; 03 transfer to a contract recipient; 04 gas cost of 1, 50 and `MAX_PAYMENTS` recipient batches recorded; 05 behavior with the real token's blocklist if the testnet token exposes one |
| DEP | deploy script rejects zero, duplicate, malformed and documented-placeholder addresses, fewer than 2 approvers, quorum below 2, and any role equal to the shared platform wallet; prints the resolved configuration before broadcasting (D15) |
| REC | reserved: recovery test group, written only if D9 selects a mechanism (veto by quorum only, guardian has no recovery power, pause does not block recovery, set suspension after veto, delay enforced, recovery installs governance only) |
| Static | Slither on all contracts; storage layout snapshot; selector clash check; `forge fmt` and lint |

## 3. Testnet integration plan (Arc Testnet)

Preconditions: design approved, contracts written and unit-tested, independent review done (Arc Studio's contract audit passes), no open High findings.

1. **Build and gate.** `forge build`, `forge test`, Slither. Gas report for batch sizes; set `MAX_PAYMENTS` from the measurement (D8).
2. **Parameters.** Roles are deployment inputs (Part 1, section 11). You provide at least 2 approver wallets (recommended 3), optional proposers, an optional guardian and the quorum (2 or more). Nothing is invented, defaulted, or taken from the shared platform wallet; examples use labelled placeholders such as `<APPROVER_1_ADDRESS>` only. If you want throwaway testnet wallets for the scripted scenario run, Arc Studio can generate them, label them test-only and keep them out of any later deployment. Testnet values from Part 3, section 7.
3. **Deploy.** Treasury, then `RecurringPaymentModule(treasury, retryDelay, maxFailures)`. The first governance proposals enable the module with a small budget. Record addresses and the deploy block in `AGENTS.md` and `.env` (`VITE_TREASURY_ADDRESS`, `VITE_RECURRING_MODULE_ADDRESS`, `VITE_TREASURY_DEPLOY_BLOCK`).
4. **Verify.** Read back owner-less config, epoch 1, quorum, approver list, USDC address, module codehash.
5. **Fund.** Test USDC to approver wallets through the in-app "Get test USDC" action; deposit to the treasury.
6. **Scenario run** (each step verified from receipts and events, not from the UI):
   - payroll of 3 recipients: propose, 2 votes, delay, execute; check balances and `PaymentSent`;
   - single transfer; expiry without execution; cancel by proposer; guardian cancel;
   - governance: rotate one approver; confirm a pending payroll is fenced;
   - pause by a single approver; payroll blocked; unpause by proposal;
   - module: enable with budget, create a daily schedule, execute from a fresh keeper wallet and from a non-approver wallet, try a duplicate, try early execution;
   - failure path: drain balance, observe `ExecutionFailed`, deposit, observe success;
   - backlog: leave a schedule untouched past `MAX_BACKLOG`, observe auto-pause, resume with `skipMissed`;
   - rescue a test ERC-20.
7. **Keeper.** Run the keeper against testnet for several days, tracking lag, failures and gas.
8. **Frontend pass.** Walk every page against the deployed contracts; confirm the pending, confirmed, reverted and dropped states with real transactions.
9. **Exit criteria.** All scenarios pass, no unexplained event or balance difference, indexer resumes correctly after restart, an auditor signs off.

Required external actions at this stage (not performed by Arc Studio on your behalf without your wallets): signatures from the approver wallets for every vote and execution, funding of the keeper wallet, and your confirmation of every parameter.

Mainnet is a separate decision after an independent audit. You deploy and operate it yourself; Arc Studio will not deploy to, sign for or fund mainnet. Arc Studio will give the standard mainnet warning before any mainnet configuration is written.

## 4. Migration from the current implementation

State today: v1 treasury and `PayrollBatch` are not deployed; payroll, approvals, schedules and team data are localStorage records; the legacy registry holds 4 records and moves no money.

| Phase | Change | Reversible |
|---|---|---|
| 0 | Remove the stale nested `AskirawaFi/` copy; correct README and AGENTS.md; delete the obsolete `server/keeper.ts` and `src/contracts.ts` | yes (git) |
| 1 | Add the v2 contracts and tests (no frontend change) | yes |
| 2 | Add `src/lib/treasuryV2.ts`, chain readers and event decoder behind `VITE_TREASURY_ADDRESS`; with the variable unset the app shows clear read-only "Treasury not configured" states | yes |
| 3 | Switch Payroll and Approvals to onchain proposals. Existing local payroll batches and approval requests become read-only history labelled "Local record, not onchain"; their recipient lists can be copied into a new draft. Their local "approved" statuses are never carried over | yes (flag) |
| 4 | Switch Team to onchain roles. Local role assignments are shown as off-chain labels | yes |
| 5 | Recurring: local schedules are listed as drafts with "Create onchain" (opens a schedule proposal). The keeper service goes live on testnet | yes |
| 6 | Legacy panel: read-only view of the four registry records with "Recreate as schedule" (Part 2, section 3) | yes |
| 7 | Remove authority logic from `lib/payroll.ts`, `approvals.ts`, `recurring.ts`; remove sample-data feeds; localStorage keys bumped to `_v2` for drafts and cache only | partially (export first) |
| 8 | Optional: SIWE metadata backend fixed and wired (nonce bound into the signed message, origin allow-list, `Secure` cookie, role model aligned) | yes |
| 9 | Escrow and Vesting modules and pages | yes |

A one-time "Export local data" button downloads the old localStorage records before phase 7. No funds exist in any v1 contract, so no fund migration is needed. Future treasury replacement uses a payroll proposal that moves the balance (Part 3, section 5).

## 5. Decisions

### 5.1 Resolved in review round 1

| ID | Decision | Resolution | Effect |
|---|---|---|---|
| D1 | Minimum quorum | **2.** Compile-time constant `MIN_QUORUM = 2` on every network, including testnet. At least 2 approvers always. | Part 1: constants, constructor, governance validation, tests G-GOV-02/04/07. Testnet needs at least 2 approver wallets. Single-person teams cannot use the treasury (accepted). |
| D5 | Payroll execution | **All-or-nothing.** One path, no flags, no partial statuses. | Part 1 section 10.4; Part 3 sections 1 and 4; tests G-PAY-07 and G-PAY-12. |
| D6 | Monthly schedules | **Calendar months**, anchored to the effective start's day and time, with the last-day clamp, no clamp accumulation, Gregorian leap rule, UTC only. | Part 2 section 2.4 with reference vectors; tests M-MATH-02/03/06/07. |
| D15 | Wallet addresses | **None invented.** Roles are deployment inputs; labelled placeholders only in docs and tests; the deploy script rejects placeholders; the shared platform wallet is never a role holder. | Part 1 section 11; test group DEP; testnet plan step 2. |

### 5.2 Open and evaluated, not decided

| ID | Decision | Status |
|---|---|---|
| D9 | Recovery from lost approver keys | **Open, no recommendation made.** Six options compared in Part 3 section 11 (none; none plus procedure; council with onchain votes; external Safe; with or without inactivity gate; rate-limited module). Blocks implementation because the contracts are immutable. Needs your answers to the seven questions in Part 3 section 11.8. |

### 5.3 Still at proposed defaults, awaiting your approval

These were recommendations in the first draft and are unchanged. Reply "approved" or change any of them.

| ID | Decision | Proposed default |
|---|---|---|
| D2 | Separate proposer role, or approvers only | Keep proposer role (matches the finance manager) |
| D3 | Epoch fence (void pending) versus honoring old snapshots | Fence; keep snapshots for audit |
| D4 | Payroll delay flat or tiered by amount | Flat first |
| D7 | Executor default open or restricted | Open |
| D8 | Payload in storage versus events only; `MAX_PAYMENTS` | Storage; set the cap after testnet gas measurement |
| D10 | Per-proposer open-proposal cap | Not in v2.0 |
| D11 | Guardian identity: single wallet or Safe | Safe (a configuration choice; the contract treats it as one address) |
| D12 | Gasless EIP-712 voting | Defer to v2.1 |
| D13 | Escrow and vesting scope and timing | After core and schedules are proven |
| D14 | Server-side indexer | Only if browser scanning proves too slow |

## 6. Risk register

| ID | Risk | Status and mitigation |
|---|---|---|
| R1 | Contracts unaudited until review and independent audit complete | No mainnet use before audit |
| R2 | USDC issuer can pause or blocklist, freezing funds | Documented; moderate balances; monitoring; no option in Part 3 section 11 changes this |
| R3 | Schedules created in an earlier epoch survive approver rotation | Rotation runbook lists schedules to review; any approver can pause or cancel |
| R4 | Gas and block-limit for large batches on Arc not yet measured | Measure on testnet before fixing `MAX_PAYMENTS` |
| R5 | Loss of approver keys below quorum locks funds | **Depends on D9.** Under option A it is accepted permanent loss; A+ lowers likelihood only procedurally; B, C and F trade it for a new takeover path (R12) |
| R6 | Browser log scanning speed and RPC limits unknown | Measure; fall back to a server indexer (D14) |
| R7 | Legacy registry frequency 2592000 (30 days) differs from v2 calendar months | Resolved by D6 as a semantic difference; the recreate flow shows the actual UTC due dates so approvers confirm them |
| R8 | Finality and reorg assumptions for confirmation display | Confirm against Arc documentation before choosing the rescan depth |
| R9 | Single hot keeper key | Holds only gas; open execution means it is replaceable at any time |
| R10 | Hostile guardian can stall payroll and module proposals | Replaceable by quorum through governance it cannot cancel |
| R11 | D9 undecided | Blocks contract implementation; every recovery option changes the core spec |
| R12 | If a recovery mechanism is adopted: a new path to control funds (recovery signers collude, approvers unreachable within the delay) | Mitigations per option in Part 3 section 11; only exists if D9 selects one |
| R13 | All-or-nothing payroll: one unreceivable recipient blocks a batch and forces a new proposal and new votes | Accepted under D5; pre-flight checks and simulation in the UI |
| R14 | `MIN_QUORUM = 2` blocks a solo operator and needs two wallets even on testnet | Accepted under D1; documented in the testnet plan |
| R15 | Calendar-month anchored on day 29 to 31 pays earlier in shorter months | Explicit in D6 and in the UI's next-three-due-dates preview |
| R16 | Test placeholders could leak into a real deployment | Deploy script rejects placeholder and invalid addresses and requires confirmation of the resolved config (D15) |

## 7. Approval requested

1. Confirm the four resolutions in section 5.1 are recorded correctly.
2. Answer the seven questions in Part 3 section 11.8 so D9 can be decided, or tell me which option you choose.
3. Approve or change the proposed defaults in section 5.3.

Nothing has been written, deployed or broadcast. Contract implementation starts only after D9 is decided and the remaining defaults are approved.
