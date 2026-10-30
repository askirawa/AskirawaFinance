# Askirawa Finance — Technical Audit and Implementation Roadmap

> Read-only audit. No files were modified. No transactions were sent.
> Date: October 21, 2026

---

## 1. Current Architecture Summary

### Chain and token
| Fact | Value |
|---|---|
| Chain | Arc Mainnet, chain ID **5042** |
| USDC ERC-20 address | `0x3600000000000000000000000000000000000000` (6 decimals) |
| Native gas token | USDC (18 decimals native view; same pool as ERC-20) |
| RPC | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.arc.io` |

### Deployed contracts
| Contract | Address | Source |
|---|---|---|
| Automation Registry | `0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434` | Externally deployed; ABI in `src/lib/contract.ts` |
| USDC (ERC-20) | `0x3600000000000000000000000000000000000000` | Circle canonical; used via `erc20Abi` |
| Create2Factory | Not deployed to mainnet yet | Scaffold in `contracts/script/Create2Factory.sol` |

The `contracts/` directory contains only the Create2Factory scaffold and Foundry build tooling. No AskirawaFi-specific contracts are in source — the Automation Registry source is not available in this repository.

### Frontend stack
- React 18, Vite, TypeScript, Tailwind CSS
- wagmi v2 + viem v2 + ConnectKit (`injected()` connector only)
- Arc Mainnet wired in `src/config.ts`; Arc Testnet also present for ENS fallback
- All application data (batches, schedules, approvals, org, notifications, audit) stored in **browser localStorage**

---

## 2. Gap Analysis — All Nine Feature Areas

---

### Feature 1 — Payroll Management

**What works (real on-chain):**
- USDC ERC-20 balance reads via `useReadContract` → `balanceOf`
- Sequential individual `transfer()` calls, one per employee, each confirmed via `waitForTransactionReceipt`
- Transaction hashes stored per payment; Arc Explorer links generated
- Rejected vs reverted transactions distinguished correctly
- Insufficient-balance check before execution

**What is local-only:**
- Batch records stored in `askirawafi_payroll_batches_v1` (localStorage)
- "Batch" is a frontend concept — no on-chain batch object exists
- Batch status derived from individual payment states, not from a contract
- Scheduling UI (future date) has no enforcement mechanism

**Gaps:**
- No atomicity — partial completion is possible if balance runs dry or a transfer reverts
- Treasury wallet signs every transfer individually; N employees = N MetaMask prompts
- No pre-approved USDC allowance model — transfers come directly from the connected wallet
- Scheduled batches require manual execution; no keeper exists

**Files involved:** `src/lib/payroll.ts`, `src/hooks/usePayroll.ts`, `src/pages/Payroll.tsx`, `src/components/payroll/BatchDetail.tsx`, `src/components/payroll/CreateBatchModal.tsx`

**What a production system needs:**
- A `PayrollBatch.sol` contract with `batchTransfer(address[] recipients, uint256[] amounts)` that pulls USDC via `transferFrom` in a single transaction (requires prior `approve` from treasury wallet to contract)
- Optional: a `PayrollFactory` that creates per-batch escrow contracts for auditability
- USDC allowance management UI (approve contract → execute batch)

---

### Feature 2 — Recurring Payments

**What works (real on-chain):**
- Schedule creation, pause, resume, cancel stored locally with full lifecycle state machine
- Manual "Execute Now" sends a real `transfer()` and waits for receipt
- Month-end date clamping (`computeNthExecution`) is correct
- Duplicate-in-flight guard via `executionHistory.some(e => e.status === 'processing')`

**What is local-only:**
- All schedules in `askirawafi_recurring_v1` (localStorage)
- `nextExecutionDate` is a display computation — nothing polls it
- No background process, no on-chain scheduler

**Gaps:**
- True automation (daily/weekly/monthly without user action) requires external infrastructure:
  - **Option A (off-chain keeper):** A server-side cron job that holds a funded wallet, reads schedules from a backend DB, and calls `transfer()` on schedule. Requires the treasury wallet to pre-approve the keeper's address for the expected total via `USDC.approve(keeper, allowance)`.
  - **Option B (on-chain keeper):** Gelato Network, Chainlink Automation, or a custom keeper contract pre-approved for USDC pulls. The keeper reads schedule state from a `RecurringRegistry.sol` and calls `execute(scheduleId)`.
- The existing Automation Registry stores schedule rules but has no `execute()` function — confirmed by the ABI in `src/lib/contract.ts`

**Files involved:** `src/lib/recurring.ts`, `src/hooks/useRecurring.ts`, `src/pages/RecurringPayments.tsx`, `src/components/recurring/`

**Security risk:** If a keeper is added later, the USDC allowance granted to the keeper address must be the minimum required for the scheduled period — not `type(uint256).max`. Revocation (`approve(keeper, 0)`) must be possible without cancelling active schedules.

---

### Feature 3 — Treasury Approval Workflows

**What works (real on-chain):**
- Final `transfer()` after approval is a real on-chain USDC transfer with receipt confirmation
- Wrong-chain and insufficient-balance checks before execution

**What is local-only:**
- Approval records in `askirawafi_approvals_v1` (localStorage)
- Approval decisions are locally recorded consent — a wallet can call `USDC.transfer()` directly at any time, bypassing the UI entirely
- The `requiredApprovals` threshold is enforced by the frontend only
- Approver identity is a typed address — not verified via wallet signature
- Duplicate-approval prevention is UI-only (checks `decisions` array in localStorage)

**Gaps:**
- The Automation Registry contract has no approval logic whatsoever
- No contract prevents execution before quorum is reached
- No nonce prevents the same approved request from being executed twice

**Files involved:** `src/lib/approvals.ts`, `src/hooks/useApprovals.ts`, `src/pages/Approvals.tsx`, `src/components/approvals/`

**What production needs:**
- A `TreasuryApproval.sol` (or integration with an existing multisig like Safe) that:
  - Holds or controls USDC funds
  - Maps approver addresses to `APPROVER_ROLE` on-chain
  - Requires N-of-M signatures before releasing funds
  - Uses a request nonce to prevent replay
  - Emits `RequestCreated`, `Approved`, `Rejected`, `Executed` events for indexing
- Approver authentication: SIWE (Sign-In With Ethereum) to prove wallet ownership before recording a decision

---

### Feature 4 — Automations (Automation Registry)

**What works (real on-chain):**
- `createAutomation(name, recipient, amount, frequency, executionTime, note)` writes a record to the deployed registry at `0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434` — confirmed on-chain with `waitForTransactionReceipt`
- `automationCount()` reads the total count from the registry
- `getAutomation(id)` reads individual records
- `setAutomationStatus(id, active)` pauses/activates a rule

**What is local-only / not working:**
- The registry stores rules but has **no `execute()` function** — the ABI exposes only `createAutomation`, `getAutomation`, `setAutomationStatus`, `automationCount`
- Automatic execution at the configured `executionTime` does not happen

**Gaps:**
- No keeper or executor integrated with the registry
- The contract source is not in this repository — verifying the actual on-chain bytecode requires the Arc Explorer
- `setAutomationStatus` is callable by any address in the current ABI — no `onlyOwner` modifier is visible; this should be verified on-chain

**Files involved:** `src/lib/contract.ts` (ABI), `src/pages/Automations.tsx`, `src/hooks/useAutomations.ts`

**What production needs:**
- A keeper service (off-chain cron or Gelato) that:
  - Reads active automations from the registry
  - Checks `executionTime <= block.timestamp`
  - Calls USDC `transferFrom(treasury, recipient, amount)` (requires treasury to approve the keeper)
  - Updates the registry `executionTime` to the next interval after execution
  - Or: add an `execute(id)` function to the registry contract that does this atomically

---

### Feature 5 — Organization and Team Management

**What works:**
- Full CRUD for organizations and members in localStorage
- Role model (owner/admin/finance_manager/approver/viewer) with permission matrix
- Last-owner removal guard (`canRemoveMember`)
- Role assignment guard (`canAssignRole`) — no privilege escalation above own role
- `OrgContext` exposed app-wide via React context

**What is local-only:**
- Everything: `askirawafi_org_v1` (localStorage)
- A typed wallet address is not verified — anyone can type any address
- Invitations are local records; no email or push delivery exists
- Role checks are UI-gating only; no contract enforces them

**Gaps:**
- No SIWE authentication — any device can create a conflicting org record
- No shared state across devices or users
- No invitation delivery mechanism

**Files involved:** `src/lib/org.ts`, `src/hooks/useOrg.ts`, `src/context/OrgContext.tsx`, `src/pages/Organization.tsx`, `src/components/org/`

**What production needs:**
- A backend with SIWE authentication (e.g. `siwe` + Express + PostgreSQL)
- Org and membership tables in a database
- Invitation tokens delivered by email or shareable link
- Optional: an on-chain `OrgRegistry.sol` for treasury-enforced role verification

---

### Feature 6 — Analytics and Reports

**What works:**
- Live USDC balance read from Arc Mainnet ERC-20 (`balanceOf`)
- Aggregation of localStorage records (payroll batches, recurring executions, approval requests) into analytics totals
- Date-range filtering, category breakdown
- CSV export with formula-injection protection (RFC 4180)
- Confirmed transactions (those with `txHash`) are labeled "On-chain Confirmed"
- Records without `txHash` are labeled "Local record"

**What is local-only / incomplete:**
- All transaction data comes from localStorage — no on-chain event indexer
- Incoming USDC transfers are not tracked at all (would require `Transfer(to=treasury)` event indexing)
- Historical data is limited to what was created in the current browser

**Gaps:**
- No blockchain event indexer for `Transfer` events on the USDC contract
- Analytics totals therefore undercount real treasury activity

**Files involved:** `src/lib/analytics.ts`, `src/hooks/useAnalytics.ts`, `src/pages/Analytics.tsx`, `src/components/charts/`

**What production needs:**
- An event indexer (The Graph subgraph, Envio, or a custom `eth_getLogs` scanner) that:
  - Indexes `Transfer(address indexed from, address indexed to, uint256 value)` on the USDC contract
  - Filters by treasury wallet address as sender or receiver
  - Stores indexed events in a queryable database
  - Provides a REST or GraphQL API that the frontend queries

---

### Feature 7 — Activity Page

**Current state:**
- Entirely demo data — six hardcoded rows in `src/pages/Activity.tsx`
- A yellow warning banner clearly says "Activity shown is demo data"
- No connection to any on-chain or localStorage data source

**What production needs:**
- Same event indexer as Analytics (Feature 6)
- The Activity page can be rewritten to consume the indexer API

**Files involved:** `src/pages/Activity.tsx`

---

### Feature 8 — Transaction History

**Current state:**
- Entirely demo data — five hardcoded rows in `src/pages/Transactions.tsx`
- A yellow warning banner clearly says demo data and explains the indexer requirement
- No connection to any on-chain or localStorage data source

**What production needs:**
- Same event indexer as Analytics and Activity
- A "Roadmap" section in the page already describes the three things needed: on-chain indexer, USDC transfer tracking, cross-chain settlement

**Files involved:** `src/pages/Transactions.tsx`

---

### Feature 9 — Notifications and Audit Logs

**What works:**
- In-app notification center with unread badge in the header
- Notifications generated at action boundaries for payroll, recurring, approvals, org changes
- Audit log with search, filter, CSV export, and formula-injection protection
- Notifications are deduplicated by ID (no duplicates on rerender)
- localStorage is capped (2000 audit events, 500 notifications)

**What is local-only:**
- Everything stored in `askirawafi_notifications_v1` and `askirawafi_audit_v1` (localStorage)
- Not shared across devices or users
- Not tamper-proof — disclosed prominently in the Audit Log UI
- No email, push, or SMS delivery

**Gaps:**
- No external notification delivery
- Audit log is browser-local — not a compliance-grade immutable audit trail

**Files involved:** `src/lib/notifications.ts`, `src/lib/audit.ts`, `src/context/NotificationContext.tsx`, `src/pages/Notifications.tsx`, `src/pages/AuditLog.tsx`, `src/components/notifications/NotificationPanel.tsx`

---

## 3. Dependency-Ordered Implementation Roadmap

The nine gaps reduce to **five infrastructure layers**. Each layer unlocks the features above it.

```
Layer 0 (EXISTS)
  Arc Mainnet + USDC ERC-20 + wagmi/viem frontend
  Automation Registry (rule storage, no execution)

Layer 1 — Atomic batch payments (no external deps)
  PayrollBatch.sol — batchTransfer(address[], uint256[])
  Requires: USDC.approve(PayrollBatch, allowance) from treasury wallet
  Unblocks: Payroll atomicity, approval execution via batch contract

Layer 2 — On-chain approval enforcement (depends on Layer 1 or Safe)
  TreasuryApproval.sol — N-of-M approval gate before transfer release
  OR: integrate Gnosis Safe as the treasury wallet (existing protocol)
  Requires: treasury funds held in the approval contract / Safe
  Unblocks: real approval enforcement, keeper authorization

Layer 3 — Recurring payment automation (depends on Layer 1 or 2)
  RecurringRegistry.sol — adds execute(scheduleId) with keeper authorization
  Plus: a keeper service (off-chain cron or Gelato) with USDC allowance
  Unblocks: automatic daily/weekly/monthly payments without user action

Layer 4 — SIWE backend + database (independent of Layers 1-3)
  Express/Node backend + PostgreSQL
  SIWE (Sign-In With Ethereum) for wallet-authenticated sessions
  Org, member, invitation, role tables
  Unblocks: real multi-user organization management, shared state

Layer 5 — Blockchain event indexer (independent of Layers 1-4)
  The Graph subgraph or Envio indexer for USDC Transfer events
  Filters on treasury wallet address
  GraphQL or REST API consumed by Analytics, Activity, Transactions
  Unblocks: real transaction history, accurate analytics, real Activity feed
```

---

## 4. Recommended First Implementation: Layer 1 — PayrollBatch Contract

### Why this first

1. **Highest user-visible impact.** A single wallet confirmation for N employees is dramatically better UX than N separate confirmations. This is the most common complaint users will have when trying payroll.
2. **No external dependencies.** It is pure Solidity + the existing USDC ERC-20 — no keeper, no backend, no indexer required.
3. **Self-contained.** The frontend change is small: replace N sequential `transfer()` calls with one `approve()` + one `batchTransfer()` call.
4. **Enables Layer 2.** Once USDC is flowing through a treasury contract, adding an approval gate in Layer 2 is a straightforward extension.
5. **Testable without mainnet funds.** The contract can be unit-tested with Foundry against a fork of Arc Mainnet USDC.

### Recommended contract interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Askirawa Finance PayrollBatch
/// @notice Atomically transfers USDC to multiple recipients in a single transaction.
/// @dev Treasury wallet must call USDC.approve(address(this), totalAmount) first.
contract PayrollBatch is Ownable {
    IERC20 public immutable usdc;

    event BatchExecuted(
        bytes32 indexed batchId,
        address indexed executor,
        uint256 recipientCount,
        uint256 totalAmount
    );

    event PaymentSent(
        bytes32 indexed batchId,
        address indexed recipient,
        uint256 amount
    );

    constructor(address _usdc, address _owner) Ownable(_owner) {
        usdc = IERC20(_usdc);
    }

    /// @notice Execute a payroll batch.
    /// @param batchId     Off-chain batch ID for event correlation.
    /// @param recipients  Array of recipient addresses.
    /// @param amounts     Array of USDC amounts (6 decimals) matching recipients.
    /// @dev Reverts the entire batch if any transfer fails (atomicity).
    function executeBatch(
        bytes32 batchId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner {
        require(recipients.length == amounts.length, "Length mismatch");
        require(recipients.length > 0, "Empty batch");

        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }

        // Pull full amount from caller first (fails fast if allowance insufficient)
        bool ok = usdc.transferFrom(msg.sender, address(this), total);
        require(ok, "USDC transferFrom failed");

        // Distribute to recipients
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Zero address recipient");
            bool sent = usdc.transfer(recipients[i], amounts[i]);
            require(sent, "USDC transfer failed");
            emit PaymentSent(batchId, recipients[i], amounts[i]);
        }

        emit BatchExecuted(batchId, msg.sender, recipients.length, total);
    }
}
```

**Security properties:**
- `onlyOwner` ensures only the treasury wallet (the deployer or a transferred owner) can execute batches
- Full revert on any failure — no partial execution
- `transferFrom` pull model requires explicit `approve()` — no standing unlimited allowance needed
- `batchId` links the on-chain event to the frontend localStorage record for audit correlation
- No stored state — the contract is stateless and redeployable without migrating data

### Frontend changes required

| File | Change |
|---|---|
| `contracts/PayrollBatch.sol` | **New** — contract above |
| `contracts/test/PayrollBatch.t.sol` | **New** — Foundry unit tests |
| `src/lib/contract.ts` | Add `PAYROLL_BATCH_ADDRESS` and `PAYROLL_BATCH_ABI` |
| `src/hooks/usePayroll.ts` | Replace `useBatchRunner` sequential `transfer()` loop with `approve()` + `executeBatch()` |
| `src/components/payroll/BatchDetail.tsx` | Update execution flow to show single approval step |
| `.env` | Add `VITE_PAYROLL_BATCH_ADDRESS=0x...` after deployment |
| `AGENTS.md` | Record deployed address and deployment tx hash |

**No other pages or features are affected.** The payroll lib types, validation, localStorage schema, notification and audit hooks, and all other pages remain unchanged.

---

## 5. Files and Contracts Requiring Change for Layer 1

### New files
- `contracts/PayrollBatch.sol`
- `contracts/test/PayrollBatch.t.sol`

### Modified files
- `src/lib/contract.ts` — add PayrollBatch ABI and address constant
- `src/hooks/usePayroll.ts` — rewrite `useBatchRunner` execution loop
- `src/components/payroll/BatchDetail.tsx` — update execution UI (one-step approve + batch)
- `.env` — add `VITE_PAYROLL_BATCH_ADDRESS` after deployment
- `AGENTS.md` — record deployment

### Unchanged by this feature
Everything else: recurring payments, approvals, organization, analytics, audit log, notifications, activity, transactions, automations, dashboard, config, wagmi setup, USDC address, chain ID.

---

## 6. Summary of Authorization Boundaries

| Feature | UI-enforced | On-chain enforced |
|---|---|---|
| Payroll batch execution | Wallet connection, chain, balance check | Only the ERC-20 `transfer()` itself |
| Recurring manual execution | Same | Same |
| Approval threshold | ✓ Frontend only | ✗ None |
| Approver identity | ✓ Frontend only | ✗ None |
| Automation pause/activate | `setAutomationStatus` — but caller restriction unverified | Unknown (source unavailable) |
| Organization roles | ✓ Frontend only | ✗ None |
| Notification/audit integrity | ✓ No | ✗ localStorage, mutable |

---

*This audit is read-only. No files were modified and no transactions were sent.*
*Awaiting approval before any implementation begins.*
