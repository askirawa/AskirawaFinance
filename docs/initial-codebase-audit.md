# Askirawa Finance: Initial Codebase Audit

Date: 2026-10-30. Scope: read-only audit. No contract was deployed, no transaction was sent or signed, and no application source was changed. The only things written were this report and the standard build and test output (forge cache and artifacts, a throwaway Vite build in /tmp).

Status labels used throughout:

- **VERIFIED ONCHAIN**: I read it from Arc Mainnet myself.
- **CODE ONLY**: written and unit-tested, not deployed.
- **PARTIAL**: some pieces exist, the feature does not work end to end.
- **BROWSER-LOCAL**: stored in this browser only (localStorage), not enforced by any contract or server.
- **NOT IMPLEMENTED**: no code.

I did not sign any transaction, so no write path (payments, approvals, registry writes) has been verified at runtime.

---

## 1. Architecture and key paths

| Area | Path | Notes |
|---|---|---|
| App shell | `src/App.tsx`, `src/main.tsx` | Page switching by `useState` (no router, no URLs, no deep links, browser back does nothing). 11 pages. |
| Navigation | `src/components/layout/navItems.tsx`, `Sidebar.tsx`, `MobileNav.tsx`, `Topbar.tsx` | Single nav config. Groups: Overview, Treasury, Team, Insights, Records. |
| Pages | `src/pages/*.tsx` | Dashboard, Payroll, RecurringPayments, Approvals, Automations, Organization, Analytics, Activity, Transactions, Notifications, AuditLog. No Escrow or Vesting page. |
| Shared UI | `src/components/ui/` (Button, Card, StatCard, Badge, PageHeader, SectionCard, EmptyState) | Small kit, used unevenly. |
| Feature components | `src/components/{payroll,approvals,recurring,org,charts,notifications}` | Several 600 to 850 line files (`ScheduleDetail` 845, `BatchDetail` 799, `CreateScheduleModal` 752). |
| Hooks | `src/hooks/use{Payroll,Approvals,Recurring,Org,Treasury,Automations,Analytics}.ts` | |
| Local data layer | `src/lib/{payroll,approvals,recurring,org,audit,notifications,analytics}.ts` | All persist to localStorage. |
| Contract ABIs and addresses | `src/lib/contract.ts` (current), `src/contracts.ts` (outdated) | Two ABI files that disagree. |
| Chain and wallet config | `src/config.ts` | wagmi: injected, Coinbase, WalletConnect (optional). Chains: Arc Mainnet 5042, Arc Testnet, Ethereum mainnet (ENS). |
| Generated facts | `src/onchain-facts.ts`, `onchain-money.ts`, `onchain-wait.ts` | Arc Studio modules. Mostly not used by app code (13 imports). |
| Contracts | `contracts/AskirawaFiTreasury.sol` (606 lines), `PayrollBatch.sol` (190), `IAutomationRegistry.sol`, `script/DeployTreasury.s.sol` | |
| Tests | `contracts/test/*.t.sol` (8 files) | |
| Backend | `server/index.ts` (SIWE and org API, port 3001), `server/db.ts` (SQLite), `server/keeper.ts`, `server/chain.ts` | |
| Docs | `docs/*.md`, `README.md`, `AGENTS.md` | Several contradict the code (section 8). |

Repository hygiene: `AskirawaFi/` at the repo root is a stale nested copy of the whole project (181 tracked files, including 24 forge build artifacts). It is not used by the app but is linted, and it differs from the root `src` and `contracts`. The root is the real project.

## 2. Contracts and addresses

| Contract | Address | Status | Purpose |
|---|---|---|---|
| USDC (ERC-20 view) | `0x3600000000000000000000000000000000000000` | VERIFIED ONCHAIN | `symbol()` = USDC, `decimals()` = 6. |
| Automation Registry | `0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434` | VERIFIED ONCHAIN (deployed). Source NOT verified on the explorer. | Record store for single-recipient "automations" (see 2.1). |
| AskirawaFiTreasury | none | CODE ONLY | `VITE_TREASURY_ADDRESS` is unset. |
| PayrollBatch | none | CODE ONLY | `VITE_PAYROLL_BATCH_ADDRESS` is unset. |
| "Old Mainnet Treasury v1" | not found | n/a | No address or reference to a prior treasury exists in the repo, docs or env. I treat none as reusable. If you have its address, send it and I will inspect it read-only. |

### 2.1 Automation Registry (read-only inspection)

- Deployed, 5,542 bytes of runtime code, `automationCount()` = 4.
- Functions present (from the dispatcher selectors and successful calls): `automationCount()`, `createAutomation(string,address,uint256,uint256,uint256,string)`, `getAutomation(uint256)`, `setAutomationStatus(uint256,bool)`, and an `automations(uint256)` getter.
- Not present: `registerRule`, `executeRule`, `isEligible`, `executeAutomation`, `owner()`, and none of the ERC-20 selectors (`transfer`, `transferFrom`, `approve`, `balanceOf`). Its USDC balance is 0. This is a heuristic read of the bytecode, not a proof, but it points to a pure record store that cannot move funds and has no execution function. The source is unverified, so access control on `setAutomationStatus` is unknown.
- 4 records exist, all `active`, each with recipient, 6-decimal amount (0.10 and 0.01 USDC), daily frequency (86400) and an execution timestamp. Records 1 and 2 have `executionTime` of 2026-10-02, now past, and nothing has executed them, because the registry has no execution function.
- **Interface mismatch**: `contracts/IAutomationRegistry.sol` (registerRule/executeRule) does not describe this contract. The ABI in `src/lib/contract.ts` has the right function names, but `getAutomation` is declared with nine flat outputs while the contract returns a single struct. Calling it with that shape fails to decode (I reproduced this with the same output shape). The Automations page list is therefore likely broken in the browser. I have not confirmed this in a rendered session.

### 2.2 AskirawaFiTreasury (code only)

Single-outflow USDC treasury. Approver set plus quorum. Proposals for transfer, payroll batch (max 200 recipients) and config change. Content-hash binding of recipients, amounts and expiry. Owner can cancel and deposit. There are no schedules, no keeper, no escrow, no vesting and no upgrade path.

### 2.3 PayrollBatch (code only)

Owner-only atomic `executeBatch` that pulls USDC from the owner with `transferFrom` and distributes it. Replay-protected by `batchId`. Not a treasury: it has no approvals.

## 3. Feature status

| Feature | Status | Detail |
|---|---|---|
| Payroll batch (atomic, treasury proposal) | CODE ONLY | Contract and hooks exist, tested in Foundry, not deployed, UI path inactive (`isTreasuryDeployed` is false). |
| Payroll batch (atomic, PayrollBatch) | CODE ONLY | Not deployed. |
| Payroll as used today | BROWSER-LOCAL plus PARTIAL | Batch record lives in localStorage. Execution is one USDC `transfer()` per employee from the connected wallet. Not atomic. Real transactions would result, but I have not executed any. |
| Approvals | BROWSER-LOCAL | Decisions are localStorage records. Nothing prevents the requester from paying directly. If the approver list is empty, `isAuthorizedApprover` returns true for everyone. On-chain approvals exist only in the undeployed treasury. |
| Recurring payments | BROWSER-LOCAL, manual | Schedules are localStorage. Each run is a manual wallet-signed transfer. No on-chain schedules, no allowance, no executor. |
| Keeper / executor | NOT IMPLEMENTED (obsolete code present) | `server/keeper.ts` calls `getDueSchedules` and `executeSchedule`. The current treasury has neither, so it cannot work. It was never run against a deployment. |
| Automation Registry | PARTIAL | Deployed record store, UI read path likely broken (2.1), no executor, docs claim "registry rule callbacks" that the contract does not offer. |
| Team and roles (UI) | BROWSER-LOCAL | Five roles in localStorage. A typed address is not proof of identity. UI-enforced only. |
| Team and roles (backend) | PARTIAL, unwired | SIWE login and SQLite org API exist and run, but the frontend makes no `/api` calls. Server roles (owner/admin/member) do not match the UI roles (five). |
| Escrow | NOT IMPLEMENTED | No page, hook or contract. The word appears only in comments. |
| Vesting | NOT IMPLEMENTED | Same. |
| Notifications, audit log | BROWSER-LOCAL | Editable by the user, not tamper-evident. |
| Analytics | BROWSER-LOCAL | Derived from local records. No event scanning exists. |
| Dashboard feed, Activity, Transactions | SIMULATED | Labeled "sample data". Not connected to chain. |

## 4. Security and authorization weaknesses

### 4.1 Treasury contract (before any deployment)

1. **Proposal payload is not readable onchain (High).** Only a hash is stored and the `Proposed` event omits recipients and amounts. Approvers cannot verify what they approve from contract state. The frontend keeps the payload in localStorage, so a second device or a cleared browser cannot execute. The data is recoverable only from propose-transaction calldata.
2. **Votes are not snapshotted (High).** `approvalCount` is compared with the current `quorum`. A removed approver's earlier vote still counts, and a lowered quorum applies to proposals already pending.
3. **Owner can veto (Medium).** One owner key can cancel any proposal, including config changes, with no timelock. `transferOwnership` is direct although the header comment says it is governed by proposal.
4. **Proposer cannot vote (Medium, documented).** Needs at least quorum + 1 approvers.
5. **One bad recipient blocks the whole batch (Medium).** All-or-nothing: if USDC rejects any recipient (for example a blocklisted address), execution reverts and the proposal must be recreated.
6. **Config proposal can be approved but never executable (Low).** Quorum is validated on the raw list at proposal time and on the deduplicated list at execution.
7. No pause, no token rescue, no upgradeability; funds are unrecoverable if quorum becomes unreachable (disclosed in the contract). The contract itself is labeled unaudited.

### 4.2 Backend

1. **SIWE binding is incomplete (High).** The server consumes a nonce from the request body but never checks that the signed message contains that nonce. `verifySiweMessage` only requires some `Nonce:` line. Expiration is optional, and domain, URI and chain are not checked. A previously signed message can be replayed with a fresh server nonce.
2. CORS reflects any `Origin` with `Allow-Credentials: true`. `SameSite=Strict` limits the impact, but this is still too open.
3. Session cookie lacks `Secure`. `SESSION_SECRET` is only a startup gate and is never used. No rate limiting on the nonce route.
4. Server role set (3 roles) differs from the UI role set (5), so the two cannot be reconciled as is.

### 4.3 Frontend

1. All approval, role and audit state is client-side and bypassable. UI labels say so, but README and AGENTS.md describe them as enforced.
2. Money math is hand-rolled in places (`BigInt(10 ** decimals)` in `lib/contract.ts` and `useRecurring.ts`, `parseUnits(…, 6)` in `Automations.tsx`) instead of using `@/onchain-money`.

## 5. Missing keeper / executor infrastructure

- No contract exposes due-schedule discovery or keeper-only execution.
- No funded keeper EOA, no `setKeeper`, no hosting for a persistent process. The sandbox is not a place to run a production keeper.
- The Registry cannot be the executor (no execute function, no token authority).
- Any automatic recurring payment needs: an onchain schedule or pull allowance, an executor with a bounded role, duplicate-execution protection, failure handling, and monitoring.

## 6. UI consistency issues

- Styling is split: about 1,211 inline `style={{…}}` blocks against 331 `className` uses, with 45 CSS variables in `src/index.css` and 19 hard-coded hex colors in pages and components.
- The `ui/` kit exists but large feature components and modals bypass it, and modals are duplicated (batch, approval request, schedule, invite).
- No router: no shareable URLs, back button does nothing.
- Dashboard, Activity and Transactions show sample data next to real controls.
- Unused `Users` import in `MobileNav.tsx` and `Sidebar.tsx`.
- Main bundle is 1.77 MB (522 KB gzipped), with no code splitting.
- Hand-rolled chain config in `src/config.ts` duplicates `onchain-facts`.

## 7. Test and build status (run in this session)

| Check | Result |
|---|---|
| `forge test` | 220 tests passed, 0 failed (includes fuzz and invariant suites; PayrollBatch 18, Treasury suites 59 + 14 + others). |
| `bun run check` (lint + typecheck) | 0 errors; 2 warnings (unused `Users` imports). Lint also scans the stale `AskirawaFi/` copy. |
| `vite build` | Succeeds; one chunk over 500 kB. |
| Backend | Starts; `/api/health` returns ok. Auth and org routes not exercised. |
| Frontend tests | None. No component or hook tests. |
| Integration or fork tests | None. `contracts/test-integration/` is empty. |
| Tests for stale-vote, payload-availability or keeper behaviour | Not found. |

Test counts quoted in docs (45, 94) do not match the actual 220.

## 8. Documentation that contradicts the code

- AGENTS.md says schedules, keeper, SIWE-backed Team tab and registry callbacks are implemented. The code shows: no onchain schedules, an obsolete keeper, a Team tab that uses localStorage, and a registry with no execution.
- README correctly flags the keeper as outdated and the treasury as undeployed, but still lists keeper scripts as a normal workflow.
- `src/lib/contract.ts` comments cite "45/45 tests".

## 9. Recommended implementation order

1. Cleanup (no behaviour change): remove the stale nested copy, reconcile README and AGENTS.md with what is true, delete or archive the obsolete keeper and `src/contracts.ts`.
2. Fix the Registry read path (tuple decoding), label the Registry as a record store, and drop the wrong `IAutomationRegistry.sol`.
3. Write a Treasury v2 design doc: payload emitted in events, per-proposal approver snapshot, owner veto removed or timelocked, optional skip-on-failure payroll, onchain schedules with a bounded executor role, then escrow and vesting modules.
4. Implement v2 contracts, extend the Foundry suite, run an independent audit.
5. Deploy v2 to Arc Testnet and run integration tests against it.
6. Rewire the frontend so onchain state is authoritative (events indexed from the deployment block), with localStorage as cache only.
7. Build and host the executor for recurring payments.
8. Add Escrow and Vesting pages.
9. Harden or retire the backend (fix SIWE binding, CORS, cookie flags, unify roles, then wire it up).
10. UI consistency pass: router, tokens, shared modal pattern, code splitting.
11. Mainnet: deployed by you, outside Arc Studio, after an independent audit.

## 10. External actions that will eventually be required

- Treasury v2 deploy: signature and gas (USDC) from the owner wallet, with the approver addresses and quorum you choose. Testnet first.
- Funding: USDC `approve` then `deposit` from a funding wallet.
- Every proposal, vote and execution: a wallet signature from the relevant approver.
- PayrollBatch (if kept): deploy, plus an exact-amount `approve` before each batch.
- Executor: a dedicated EOA, funded with USDC for gas, authorized by one owner transaction, and a persistent host. Its key goes into `.env` as `KEEPER_PRIVATE_KEY`, never into chat.
- Registry: any new automation record is a user-signed `createAutomation`.
- Backend: `SESSION_SECRET` in `.env`, SIWE signatures from users, and a persistent host.
- WalletConnect project ID for phone wallets.
- Independent security audit before mainnet.
- Mainnet: you deploy and operate it yourself. Arc Studio can write the code and configuration but does not deploy to, sign for or fund mainnet.
