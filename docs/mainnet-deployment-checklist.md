# Askirawa Finance — Mainnet Deployment Readiness Checklist

**Status as of October 22, 2026: AWAITING AUTHORIZATION — do not deploy until explicitly instructed.**

This document is the single reference for every step required before and after deploying
`AskirawaFiTreasury` to Arc Mainnet. It is not an authorization to deploy. It documents
what must happen when authorization is given.

---

## Part 1 — Pre-deployment requirements (must all be satisfied before deploying)

### 1.1 Mandatory blockers

| # | Requirement | Satisfied? |
|---|---|---|
| B-1 | Independent professional security audit of `AskirawaFiTreasury.sol` completed and all findings resolved | **No** |
| B-2 | Explicit written authorization from repository owner to deploy to mainnet | **No** |
| B-3 | Approver private-key infrastructure decided and in place (hardware wallets, backup procedures) | **No — not reviewed** |
| B-4 | `VITE_TREASURY_ADDRESS` unset — no deployment address exists yet | **Not applicable until B-2 satisfied** |

### 1.2 Code-level readiness (satisfied)

| # | Item | Status |
|---|---|---|
| C-1 | `forge build` compiles without errors | **Pass** |
| C-2 | AskirawaFiTreasury Foundry tests: 59/59 pass | **Pass** |
| C-3 | PayrollBatch Foundry tests: 18/18 pass | **Pass** |
| C-4 | Frontend lint (oxlint): 0 errors, 0 warnings | **Pass** |
| C-5 | Frontend typecheck (tsc): 0 errors | **Pass** |
| C-6 | Production build (`vite build`): success | **Pass** |
| C-7 | Chain ID 5042 consistent across all source files | **Pass** |
| C-8 | USDC address `0x3600000000000000000000000000000000000000` consistent across all source files | **Pass** |
| C-9 | Malformed `VITE_TREASURY_ADDRESS` (wrong length or no 0x prefix) produces `isTreasuryDeployed = false` | **Pass** |
| C-10 | Wrong-network banner shown when wallet is on any chain other than 5042 | **Pass** |

---

## Part 2 — Constructor arguments

**Contract:** `AskirawaFiTreasury.sol`  
**Chain:** Arc Mainnet, chain ID **5042**

```solidity
constructor(
    address       usdcAddress,       // (1) Arc Mainnet USDC ERC-20
    address       initialOwner,      // (2) Treasury admin wallet
    address[] memory initialApprovers,  // (3) Approver addresses
    uint8         initialQuorum      // (4) Votes required to pass a proposal
)
```

### Argument specifications

**(1) `usdcAddress`**
Must be exactly: `0x3600000000000000000000000000000000000000`

This is the Circle-issued USDC ERC-20 on Arc Mainnet (chain ID 5042). Verified on-chain in
a previous session via `read_contract`: `symbol = "USDC"`, `decimals = 6`. Passing any
other address will cause all deposits and transfers to interact with the wrong token — this
error cannot be fixed without redeployment.

**(2) `initialOwner`**
A hardware-wallet-secured address. The owner can:
- Cancel proposals
- Deposit USDC
- Transfer ownership to another address

The owner **cannot** move treasury funds without a quorum-approved proposal. A compromised
owner cannot drain the treasury, but can cancel legitimate proposals and disrupt operations.

**(3) `initialApprovers`**
Minimum recommended: 3 addresses for a 2-of-3 configuration.
- Each address must be unique (duplicates are silently deduplicated).
- Each address must be non-zero.
- All three should be hardware-wallet-secured with offline backups.
- The approver set can be changed later via a CONFIG_CHANGE proposal.

**(4) `initialQuorum`**
Must satisfy: `0 < initialQuorum < initialApprovers.length` (strictly less than, not equal).

Setting `quorum == approverCount` creates an unresolvable condition: any proposer is
excluded from voting on their own proposal, so quorum can never be reached.

**Recommended starting configuration:** 2-of-3 (`quorum = 2`, 3 approvers).

### Example constructor call (documentation only — do not execute)

```
usdcAddress:       0x3600000000000000000000000000000000000000
initialOwner:      <YOUR_OWNER_WALLET>
initialApprovers:  [<APPROVER_1>, <APPROVER_2>, <APPROVER_3>]
initialQuorum:     2
```

Replace all `<...>` placeholders with real addresses before any deployment attempt.
**Do not invent or reuse placeholder addresses on mainnet.**

---

## Part 3 — Post-deployment verification steps

After deployment (when authorized), verify every item below before configuring the frontend
or depositing any funds.

### 3.1 On-chain state verification

Read each of the following from the deployed contract on chain ID 5042:

| Read call | Expected value | How to verify |
|---|---|---|
| `usdc()` (immutable) | `0x3600000000000000000000000000000000000000` | `cast call <address> "usdc()(address)" --rpc-url https://rpc.mainnet.arc.io` |
| `owner()` | The address passed as `initialOwner` | Same pattern with `"owner()(address)"` |
| `quorum()` | The `uint8` value passed as `initialQuorum` | `"quorum()(uint8)"` |
| `approverCount()` | `initialApprovers.length` (after dedup) | `"approverCount()(uint256)"` |
| `approvers()` | Array matching `initialApprovers` (deduplicated) | `"approvers()(address[])"` |
| `balance()` | `0` (no funds deposited yet) | `"balance()(uint256)"` |
| `isApprover(<addr>)` | `true` for each approver, `false` for others | `"isApprover(address)(bool)"` |

### 3.2 Bytecode verification

Recompile the contract from the exact source commit used for deployment and verify that the
deployed bytecode matches. Use Foundry's `forge verify-contract` targeting the Arc Mainnet
explorer (`https://explorer.arc.io`), or verify manually by comparing `eth_getCode` output
to the compiled artifact at `contracts/out/AskirawaFiTreasury.sol/AskirawaFiTreasury.json`.

### 3.3 Chain ID verification

Confirm the transaction deploying the contract is on chain ID 5042:
- Block explorer: `https://explorer.arc.io/tx/<deploy_tx_hash>`
- RPC: `eth_chainId` against `https://rpc.mainnet.arc.io` must return `0x13B2` (= 5042)

### 3.4 Test deposit (before committing real funds)

1. Approve a small test amount: `USDC.approve(<treasury>, 1_000000)` (1 USDC = 1,000,000 raw)
2. Call `treasury.deposit(1_000000)`
3. Confirm `balance()` returns `1_000000`
4. Create a test proposal, collect quorum votes, execute, and verify the recipient balance increases
5. Only after this end-to-end test passes, consider depositing operational funds

---

## Part 4 — Frontend configuration

After deployment is verified and the test deposit passes:

### 4.1 Set the environment variable

```bash
# Append to .env — do not hardcode in source files
printf 'VITE_TREASURY_ADDRESS=0x<DEPLOYED_ADDRESS>\n' >> /home/user/app/.env
```

`VITE_` prefix is required. Vite exposes it to browser code as `import.meta.env.VITE_TREASURY_ADDRESS`.
The address is public (it is a smart contract on a public chain) — using `VITE_` for a public address
is correct. Private keys and secrets must never use `VITE_` prefix.

### 4.2 Restart the dev server

Vite reads `.env` only at startup. After editing `.env`, restart the dev server:

```bash
# Kill the running server, then:
bun run dev
```

Hot-module reload does NOT pick up `.env` changes.

### 4.3 Verify frontend recognizes the deployment

- Open the app
- `isTreasuryDeployed` in `useTreasury.ts` should now be `true`
- The Approvals page should show a green "On-chain enforcement" banner
- `BatchDetail` should show treasury mode controls
- `ScheduleDetail` should show treasury propose controls
- `useTreasuryConfig()` reads should return the correct `quorum`, `approverCount`, and `owner`

### 4.4 Required environment variables — complete list

| Variable | Required for | Where used |
|---|---|---|
| `VITE_TREASURY_ADDRESS` | Treasury contract integration | `src/lib/contract.ts` → all treasury hooks |
| `VITE_PAYROLL_BATCH_ADDRESS` | PayrollBatch direct execution (personal-wallet mode) | `src/lib/contract.ts` → `usePayroll.ts` |

Neither variable is currently set. The app operates in localStorage-only mode until they are set.
`VITE_PAYROLL_BATCH_ADDRESS` is optional when the treasury is configured — payroll runs through
the treasury. It is only needed when using the PayrollBatch contract for personal-wallet payroll.

---

## Part 5 — Remaining risks and open items

### 5.1 Unresolvable fund-lock conditions (by design — disclosed in contract header)

These are not bugs. They are unavoidable consequences of a no-bypass design. Organizations
must maintain operational hygiene to avoid them.

| Condition | How it happens | Mitigation |
|---|---|---|
| Key loss below quorum | Approver loses private key; remaining signers cannot reach quorum | Deploy 2-of-3 minimum; hardware wallets + offline backups; rotate keys proactively |
| Self-vote lockout | `quorum == approverCount`; proposer excluded from voting on own proposals | Always maintain `quorum < approverCount` |
| Governance CONFIG_CHANGE expires during rotation | Key goes offline before replacement CONFIG_CHANGE proposal reaches quorum | Initiate rotation before the key is suspected compromised; short expiry windows during rotation |
| Zero approvers (theoretical) | Blocked at constructor and `_setApprovers` — cannot happen via normal paths | N/A |

**There is deliberately no emergency bypass.** Adding one would be a governance bypass.
If funds become permanently inaccessible due to key loss, they cannot be recovered.

### 5.2 Open technical items

| Item | Severity | Notes |
|---|---|---|
| Independent security audit not completed | **Critical blocker** | Contract header explicitly states "UNAUDITED — HACKATHON DEMONSTRATION ONLY." Do not hold substantial production funds without an independent audit. |
| No keeper service for recurring payments and expiring proposals | Medium | All executions require manual initiation. Do not represent automatic execution as available. A keeper requires separate design, security review, and deployment. |
| Mobile wallet support (WalletConnect) not configured | Low | Only injected (MetaMask) connector is configured. Mobile users cannot connect. |
| Quorum progress from a second device | Informational | Fixed: `ApprovalDetail` reads on-chain `approvalCount` via `useTreasuryProposal`. Accurate across devices when treasury is deployed. |
| Duplicate period prevention cross-device | Informational | localStorage guard is device-local. On-chain: same `proposalId` from a second device reverts with `ProposalAlreadyExists`. On-chain protection is sufficient; the localStorage guard is a UX convenience only. |

### 5.3 What this checklist does and does not verify

**Verified by this checklist (code-level):**
- Contract source logic, security invariants, and test coverage
- Frontend address validation and wrong-network detection
- ABI consistency between contract source and frontend ABI
- Chain ID and USDC address consistency across all source files
- Production build success

**Not verified by this checklist (requires live deployment):**
- Contract behavior on Arc Mainnet chain ID 5042 under real network conditions
- Gas costs on mainnet
- That USDC address `0x3600000000000000000000000000000000000000` is the correct Circle-issued token (verified separately via on-chain `read_contract` in a previous session)
- Approver wallet security — hardware setup, backup procedures, key rotation process
- That the production hosting environment correctly injects `VITE_TREASURY_ADDRESS`
- That `vite build` output, when served from a CDN or hosting provider, correctly reads the environment variable

**This checklist is not a substitute for an independent security audit.**

---

## Part 6 — Files changed this session

| File | Change |
|---|---|
| `src/components/layout/Topbar.tsx` | Wrong-network banner now includes chain ID 5042 in the message text |
| `docs/mainnet-deployment-checklist.md` | This file (new) |
| `docs/final-predeployment-audit.md` | Updated to reflect final check results |

No contract source changes were made this session. All 77 Foundry tests pass unchanged.

---

## Authorization gate

**This document does not authorize any deployment.**

The following actions require separate, explicit, written authorization:
- Deploying `AskirawaFiTreasury.sol` to any mainnet
- Setting `VITE_TREASURY_ADDRESS` to a live contract address
- Depositing USDC into the deployed treasury
- Submitting any proposal, vote, or execution on a live treasury

Arc Studio will stop and wait for that authorization before taking any of the above actions.
