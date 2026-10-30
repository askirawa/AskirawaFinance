# Askirawa Finance — Final Security and Verification Review

**Date:** October 19, 2026  
**Build result:** ✅ Zero errors, zero warnings (`bun run check` — oxlint + tsc --noEmit)  
**Dev server:** Running (PID 2192)

---

## 1. Checks Performed

| Check | Tool | Result |
|---|---|---|
| Lint (type-aware) | oxlint | ✅ 0 warnings, 0 errors |
| Lint (root) | oxlint | ✅ 0 warnings, 0 errors |
| TypeScript | tsc --noEmit | ✅ 0 errors |
| Unit tests | Not configured | N/A — no test runner set up |
| Static contract analysis | Slither | N/A — no new contracts deployed |

---

## 2. Code Review Findings

### 2A. Arc Mainnet Chain ID Consistency — PASS

- `ARC_MAINNET_CHAIN_ID = 5042` is defined once in `src/config.ts` and imported by all hooks.
- All transfer hooks (`useBatchRunner`, `useScheduleRunner`, `useRequestExecutor`) pass `chainId: CHAIN_ID` to `writeContractAsync`, ensuring wallet prompts specify Arc Mainnet.
- The wrong-chain guard `chainId !== CHAIN_ID` is checked before every execution path.
- `onchain-facts.ts` confirms chain ID 5042 = "Arc" (mainnet), USDC at `0x3600000000000000000000000000000000000000`, 6 decimals.
- The `config.ts` RPC matches the onchain-facts entry (`https://rpc.mainnet.arc.io`). ✅

### 2B. USDC Decimal Arithmetic — PASS

- Every amount field in every lib is stored as a decimal string, never a JS float.
- `parseUsdcString` uses pure integer BigInt arithmetic — no `parseFloat`, no `Number()` on amounts.
- `formatUsdcBigint` uses BigInt division and modulo, not floating-point.
- `sumBatchAmounts` accumulates as `bigint`.
- `USDC_DECIMALS = 6` is a constant; no literal `10 ** 6` on any transfer path.
- The `parseUsdcString` regex `/^\d+(\.\d+)?$/` correctly rejects scientific notation, negative values, and empty strings. ✅

### 2C. Transaction Confirmation — PASS

All three execution hooks follow the same safe pattern:
1. `writeContractAsync` — submits transaction, returns hash
2. `publicClient.waitForTransactionReceipt({ hash })` — waits for receipt
3. `receipt.status === 'success'` — determines outcome
4. Notification and audit event emitted **only after** the receipt check

A tx hash alone is **never** treated as success. ✅

### 2D. Duplicate Submission Guard — PASS

- `useBatchRunner`: `isRunning` state is set to `true` at start; the Execute button is disabled when `isRunning` is true.
- `useScheduleRunner`: checks `executionHistory.some(e => e.status === 'processing')` before proceeding.
- `useRequestExecutor`: `isExecuting` state guards the execute button.
- `useApprovalRequests.recordDecision`: checks `alreadyDecided` before recording a second decision from the same approver. ✅

### 2E. Stale-Closure Bug in `useApprovalRequests` — FIXED ✅

**Bug found:** `createRequest`, `recordDecision`, `cancelRequest`, and `updateRequest` all called `persist(upsertRequest(requests, ...))` using the `requests` value captured at callback creation time (a stale closure). Under React concurrent mode, rapid consecutive operations could cause earlier writes to overwrite later ones.

**Fix applied:** `persist` was changed to accept a functional updater `(prev: ApprovalRequest[]) => ApprovalRequest[]`, mirroring the correct pattern already in `usePayrollBatches.saveBatch`. All four call sites updated to use `persist(prev => upsertRequest(prev, ...))`. Side effects (notifications, audit logging) are extracted from the updater and run after state commit.

**File modified:** `src/hooks/useApprovals.ts`

### 2F. `useReadContract` with `undefined as never` — FIXED ✅

**Bug found:** `useApprovals.ts` `useUsdcBalance` passed `undefined as never` to bypass TypeScript when the wallet wasn't connected — a type-unsafe pattern that could cause runtime warnings.

**Fix applied:** Replaced with the `query: { enabled: !!usdcFact && !!address }` guard pattern, consistent with how the payroll and recurring hooks implement the same read.

**File modified:** `src/hooks/useApprovals.ts`

### 2G. `useSingleUsdcTransfer` — Dead Export

`usePayroll.ts` exports a `useSingleUsdcTransfer` hook that is defined but never imported anywhere. It is not a bug — it causes no harm — but it is unused code. Not removed to avoid any risk of breaking changes; documented here for cleanup in a future pass.

### 2H. User Rejection Handling — PASS

All three execution hooks correctly distinguish user wallet rejection from network/contract errors:
- Rejection: `msg.includes('user rejected') || msg.includes('user denied')` — payment reverts to `pending` / `skipped` status; no failure notification emitted (the user deliberately cancelled).
- Other errors: payment marked `failed`; failure notification and audit event emitted.  ✅

### 2I. Notification Deduplication — PASS

- `appendNotification` in `notifications.ts` checks `existing.some(n => n.id === notif.id)` before persisting.
- `appendAuditEntry` in `audit.ts` does the same.
- IDs are generated with `Date.now() + Math.random()` — collision probability is negligible.
- Notifications are emitted at action boundaries (not in `useEffect` or on render), preventing duplicate generation on rerender. ✅

### 2J. localStorage Error Handling — PASS

- Every `localStorage.getItem` is wrapped in `try/catch` returning a safe default.
- Every `localStorage.setItem` is wrapped in `try/catch` with silent skip (handles quota exceeded).
- Array bounds are checked with `Array.isArray(parsed)` guards on load.
- Audit log and notification stores are capped (2000 and 500 entries respectively) to prevent unbounded growth. ✅

### 2K. Organization Isolation — ACCEPTABLE WITH KNOWN LIMITATION

Organization data is stored per browser origin. All records belong to a single org per browser. There is no cross-organization leakage possible in the current single-org localStorage model. Legacy records (payroll batches, recurring schedules, approval requests) have no `orgId` field and display in the personal/unassigned view — they are preserved, not silently reassigned. ✅

---

## 3. Critical / High-Risk Issues That Remain

These are **architectural** limitations, not code defects introduced this turn. They are all clearly documented in the UI and in source code comments.

### HIGH: All authorization is UI-only

The approval threshold, approver role restrictions, and organization roles are enforced only by the frontend. Any user with a wallet connected to Arc Mainnet can call `USDC.transfer()` directly from their wallet without going through the approval workflow. **There is no on-chain enforcement.** This requires:
- A treasury multisig or smart contract that holds funds and only releases on quorum (e.g. Gnosis Safe or custom `TreasuryApproval.sol`)
- On-chain role registry

### HIGH: Payroll execution is not atomic

Payroll batches execute as sequential individual `transfer()` calls. If a wallet runs out of USDC mid-batch, or a user rejects one transaction, earlier payments are already confirmed while later ones are pending. A dedicated `batchTransfer(address[], uint256[])` contract would solve this.

### MEDIUM: No wallet signature authentication

Organization membership, invitations, and roles are identified only by wallet address strings. Anyone can type any address. Production deployment requires SIWE (Sign-In With Ethereum) so that wallet ownership is cryptographically verified before any role action.

### MEDIUM: All records are browser-local only

No data survives if the user clears their browser storage, switches browsers, or uses a different device. A backend database with authenticated sessions is required for production multi-user use.

### LOW: RPC endpoint is public (no API key)

The `https://rpc.mainnet.arc.io` endpoint is used without an authentication key. Under high load this may rate-limit. The app should be wired through the Arc Studio RPC proxy (`RPC_PROXY_BASE_URL`) for production.

---

## 4. Features That Work Only as Local Simulations or Manual Workflows

| Feature | Status |
|---|---|
| Payroll execution | Real on-chain USDC transfers, sequential, confirmed by receipt |
| Recurring payment execution | Real on-chain USDC transfer when manually triggered; **no automatic scheduling** |
| Approval workflow enforcement | UI-only gate; execution is still a direct wallet `transfer()` |
| Organization roles | UI-only visibility controls; not enforced on-chain |
| Member invitations | Local record only; no email or notification delivered |
| USDC balance | Live read from Arc Mainnet ERC-20 contract |
| Automation registry (`createAutomation`) | Real on-chain call to `0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434`; no keeper, no auto-execution |
| Audit log | Browser localStorage only; not tamper-proof |
| Analytics incoming transfers | Not available; requires event indexer |

---

## 5. Behaviors That Remain Unverified Without Live Infrastructure

- Whether Arc Mainnet RPC (`https://rpc.mainnet.arc.io`) returns correct receipts under load
- Whether the Automation Registry contract at `0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434` functions as documented (cannot be verified without a connected wallet and mainnet USDC)
- Whether `receipt.status === 'success'` correctly reflects ERC-20 revert cases on Arc Mainnet (wagmi behavior on this chain variant)
- Whether monthly schedule date math handles all timezone edge cases at midnight in non-UTC timezones

---

## 6. Files Modified This Turn

| File | Change |
|---|---|
| `src/hooks/useApprovals.ts` | Fixed stale-closure bug in all four `persist` call sites; fixed `useReadContract` `undefined as never` pattern |

---

## 7. Final Build Result

```
oxlint (type-aware): 0 warnings, 0 errors
oxlint (root):       0 warnings, 0 errors
tsc --noEmit:        0 errors
```
