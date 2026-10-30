# Askirawa Finance — Final Pre-Deployment Audit
**Date:** October 22, 2026  
**Status:** AWAITING DEPLOYMENT AUTHORIZATION — do not deploy until explicitly instructed.

---

## Verification results

| Check | Result |
|---|---|
| AskirawaFiTreasury Foundry tests | **59/59 pass** |
| PayrollBatch Foundry tests | **18/18 pass** |
| Total Foundry tests | **77/77 pass** |
| Frontend lint (oxlint) | **0 errors, 0 warnings** |
| Frontend typecheck (tsc) | **0 errors** |
| Production build (vite build) | **Success** (chunk-size advisory only, not an error) |

All checks were run fresh this session against the current source. No test was skipped or suppressed.

---

## Audit area 1: Contract security — governance and fund-movement paths

### Complete USDC outflow trace

Every line of `AskirawaFiTreasury.sol` was read. The **only** function that moves USDC out of the contract is `execute()` (line 468), which internally calls `_executePayments()` → `usdc.safeTransfer()`.

`execute()` requires ALL of the following simultaneously:
1. `p.expiresAt != 0` — proposal must exist
2. `p.executed == false` — not already executed
3. `p.cancelled == false` — not cancelled
4. `block.timestamp < p.expiresAt` — not expired (strict less-than; exact-second boundary reverts since the `>=` fix)
5. `p.approvalCount >= quorum` — quorum of distinct approver votes reached
6. Content hash recomputed from supplied arrays must match stored `p.contentHash` — payload substitution reverts

No other function moves USDC. Verified by reading every function in the contract:

| Function | Moves USDC? | Notes |
|---|---|---|
| `execute()` | **Yes** | Only under all 6 conditions above |
| `deposit()` | Inbound only | `safeTransferFrom` — adds to balance |
| `proposeTransfer/Payroll/ConfigChange()` | No | Creates proposal record only |
| `vote()` | No | Increments `approvalCount` only |
| `cancel()` | No | Sets `cancelled = true` only |
| `transferOwnership()` | No | Changes `owner` only |

**No `selfdestruct`, no raw ETH receiver, no `call{value:}`, no unchecked `transfer()`, no fallback function** — confirmed by full source read.

### Owner capabilities — confirmed cannot bypass approvals

The owner address (`owner` state variable, set in constructor) can only:
- Call `cancel()` on any pending non-executed non-expired proposal (blocks, does not move funds)
- Call `transferOwnership()` to hand off the owner role
- Call `deposit()` (as can anyone)

The owner **cannot**:
- Call `execute()` to move funds without a fully-approved proposal
- Change approvers or quorum without a CONFIG_CHANGE proposal reaching quorum
- Approve their own proposals (self-vote rule applies to all addresses)

`execute()` has no `onlyOwner` modifier. The owner is not privileged for execution — they are privileged only for cancellation.

### Governance change mechanics

1. Any approver calls `proposeConfigChange(proposalId, newApprovers[], newQuorum, expiresAt)` with `onlyApprover`.
2. The new config is encoded as a regular proposal payload (recipients = newApprovers, amounts[0] = newQuorum).
3. The current quorum of distinct approver votes is required — the same as any spending proposal.
4. `execute()` dispatches to `_executeConfigChange()` which calls `_setApprovers(newApprovers, newQuorum)`.
5. `_setApprovers` clears the old approver set, writes the new set with silent deduplication, then calls `_validateApproversAndQuorum(_approverList.length, newQuorum)` against the **deduplicated** count.
6. After validation passes, `quorum = newQuorum` takes effect immediately for subsequent proposals.

**Governance cannot bypass spending approvals.** A CONFIG_CHANGE that reduces quorum still requires the current quorum to execute.

**A CONFIG_CHANGE that produces an unreachable quorum is blocked at execution time** (not just at proposal time) by the dedup-then-validate path in `_setApprovers`. Test: `test_RevertIf_ConfigDuplicateApproversBreaksQuorum`, `test_GovernanceCannotProduceUnreachableQuorum`.

**New quorum is immediately enforced on subsequent proposals.** Test: `test_GovernanceNewQuorumEnforcedOnSubsequentProposals`.

### Exact conditions that permanently lock funds

These are design consequences, not bugs. They are disclosed in the contract header at lines 47-51.

**Condition 1 — Key loss below quorum (no on-chain resolution):**  
If fewer than `quorum` approvers have accessible private keys, no proposal can reach quorum. There is no emergency escape. This is deliberate: an escape hatch would be a governance bypass.  
Mitigation: deploy with `quorum < approverCount`, minimum 2-of-3, store keys in hardware wallets with offline backups.  
Test: `test_FundsLockedIfApproversLost`.

**Condition 2 — Self-vote lockout when `quorum == approverCount` (no on-chain resolution):**  
`vote()` blocks `msg.sender == p.proposer`. If `quorum == approverCount`, the proposer's exclusion means only `approverCount - 1` distinct votes are possible, which is less than quorum.  
Any proposal submitted by any approver in this configuration will never reach quorum.  
Mitigation: always deploy and maintain `quorum < approverCount`. For 2-of-3, one approver can propose and two others can vote — safely avoids this condition.  
Test: `test_SelfVoteQuorumLockout_DocumentedLimitation`.

**Condition 3 — Governance CONFIG_CHANGE expires while approver is unavailable:**  
A CONFIG_CHANGE proposal that would add a replacement approver has a finite lifetime (`expiresAt`, max 30 days). If an approver goes offline before the governance proposal reaches quorum, and there are no other approvers available to cover quorum, the proposal expires. The old (broken) config persists.  
Mitigation: maintain a healthy quorum margin. Initiate key-rotation CONFIG_CHANGE proposals before keys are suspected compromised.

**Condition 4 — Zero approvers / zero quorum (blocked by constructor and `_setApprovers`):**  
Cannot be reached: both `require(initialApprovers.length > 0 && initialQuorum > 0)` in the constructor and `_validateApproversAndQuorum(count == 0 || quorum == 0)` in `_setApprovers` revert before writing state.

### Security invariants — all verified from source

| Invariant | Mechanism | Tested |
|---|---|---|
| Only approvers propose | `onlyApprover` modifier on all propose functions | `test_RevertIf_NonApproverProposes` |
| Only approvers vote | `onlyApprover` modifier on `vote` | `test_RevertIf_NonApproverVotes` |
| No self-vote | `msg.sender == p.proposer` check | `test_RevertIf_SelfVote` |
| No duplicate vote | `voted[proposalId][msg.sender]` mapping | `test_RevertIf_DuplicateVote` |
| Quorum required before execute | `p.approvalCount < quorum` check | `test_RevertIf_ExecuteWithoutQuorum` |
| Exact expiry boundary (`>=`) | `block.timestamp >= p.expiresAt` in both `vote` and `execute` | `test_RevertIf_VoteAtExactExpiry`, `test_RevertIf_ExecuteAtExactExpiry`, `test_VoteOneSecondBeforeExpiry` |
| Double-execute blocked | `p.executed = true` set before external calls (CEI) | `test_RevertIf_ExecuteTwice` |
| Cancelled proposals blocked | `p.cancelled` flag checked | `test_RevertIf_ExecuteCancelledProposal`, `test_RevertIf_VoteOnCancelledProposal` |
| Expired proposals blocked (cancel too) | `block.timestamp >= p.expiresAt` in `cancel` | `test_RevertIf_CancelExpiredProposal` |
| Payload binding — recipient | Content hash recomputed at execute | `test_RevertIf_SubstitutedRecipient` |
| Payload binding — amount | Content hash recomputed at execute | `test_RevertIf_SubstitutedAmount` |
| Payload binding — array length | Content hash recomputed at execute | `test_RevertIf_SubstitutedRecipientCount` |
| Payload binding — payroll | Content hash recomputed at execute | `test_RevertIf_PayrollSubstitutedRecipientOnExecute` |
| Cross-chain replay prevention | `block.chainid` in `_contentHash` | `test_ContentHashIncludesChainId` |
| Reentrancy blocked | `nonReentrant` on `execute` + CEI | `test_ReentrancyBlocked` |
| Owner cannot spend unilaterally | No `onlyOwner` path to `execute` or fund movement | `test_RevertIf_OwnerCannotExecuteDirectly` |
| Stranger cannot execute | Proposal existence + quorum checks | `test_RevertIf_StrangerExecutesDirectly` |
| Insufficient balance reverts atomically | Pre-transfer balance check | `test_RevertIf_InsufficientBalance`, `test_PayrollAtomicRollback` |
| SafeERC20 used | `using SafeERC20 for IERC20` | All transfer paths |
| Governance requires current quorum | No special governance modifier — same quorum check | `test_GovernanceNewQuorumEnforcedOnSubsequentProposals` |
| Governance cannot set unreachable quorum | Dedup-then-validate in `_setApprovers` | `test_RevertIf_ConfigDuplicateApproversBreaksQuorum`, `test_GovernanceCannotProduceUnreachableQuorum` |

---

## Audit area 2: Configuration and deployment readiness

### Chain ID and USDC address — verified from source

| Fact | Source file | Value | Matches requirement |
|---|---|---|---|
| Arc Mainnet chain ID | `src/config.ts` line 14 | `5042 as const` | Yes |
| `ARC_MAINNET_CHAIN_ID` export | `src/config.ts` line 29 | `arcMainnet.id` = 5042 | Yes |
| USDC ERC-20 address (Arc Mainnet) | `src/onchain-facts.ts` line 99 | `0x3600000000000000000000000000000000000000` | Yes |
| USDC ERC-20 decimals | `src/onchain-facts.ts` line 101 | 6 | Yes |
| Native USDC decimals (gas token) | `src/onchain-facts.ts` line 95 | 18 | Yes (Arc-specific, different from ERC-20) |
| Contract header USDC address | `contracts/AskirawaFiTreasury.sol` line 55 | `0x3600000000000000000000000000000000000000` | Consistent |
| Contract header chain ID | `contracts/AskirawaFiTreasury.sol` line 54 | 5042 | Consistent |
| Contract header decimals | `contracts/AskirawaFiTreasury.sol` line 56 | 6 | Consistent |

### Treasury address guard — hardened this session

`TREASURY_ADDRESS` (in `src/lib/contract.ts`) now validates both `startsWith('0x')` AND `length === 42` before accepting `VITE_TREASURY_ADDRESS`. A malformed string such as `"0xGARBAGE"` (wrong length) is treated as null, producing `isTreasuryDeployed = false` and preventing any contract read calls against a non-contract address. The same hardening was applied to `PAYROLL_BATCH_ADDRESS`.

Previously: only `startsWith('0x')` was checked. A 45-character malformed address would pass and fire failing RPC reads.  
Now: explicit length check ensures only correctly-formed 42-character addresses are accepted.

### What happens with an unset treasury address

- `TREASURY_ADDRESS` is `null`
- `isTreasuryDeployed` is `false`
- Every treasury hook returns `{ isDeployed: false, ... }` and skips all contract reads/writes
- The UI shows "Local Mode" banners throughout (Approvals, BatchDetail, ScheduleDetail)
- No treasury approval is claimed or implied
- The localStorage-based approval workflow continues unchanged

No ambiguous state is possible: the treasury is either configured with a valid address or it is not.

### Required constructor arguments (documentation only — do not deploy)

```solidity
AskirawaFiTreasury(
  address usdcAddress,   // MUST be 0x3600000000000000000000000000000000000000
  address initialOwner,  // Treasury admin wallet — controls cancel and deposit
  address[] initialApprovers,  // At minimum 3 addresses for a safe 2-of-3 setup
  uint8   initialQuorum        // MUST be < initialApprovers.length (recommend 2 for 2-of-3)
)
```

**Critical deployment parameters:**
- `usdcAddress`: must be exactly `0x3600000000000000000000000000000000000000` on Arc Mainnet (chain ID 5042). Passing the wrong address would cause all deposit and transfer calls to interact with the wrong token.
- `initialQuorum`: must be strictly less than `initialApprovers.length` to avoid the self-vote lockout condition. For a 3-approver setup, quorum of 2 is the minimum safe configuration.
- `initialOwner`: should be a hardware-wallet-secured address. The owner can cancel proposals; a compromised owner cannot move funds but can disrupt treasury operations.

**Frontend configuration steps (documentation only — do not execute):**
1. `forge build` — confirm contracts compile (currently passes)
2. Deploy `AskirawaFiTreasury` with the above parameters on Arc Mainnet
3. Record the deployed contract address
4. `printf 'VITE_TREASURY_ADDRESS=0x<address>\n' >> /home/user/app/.env` — do not hardcode in source
5. Restart the Vite dev server (env files are read only at startup)
6. Verify `isTreasuryDeployed` becomes `true` in the running app
7. Fund: call `USDC.approve(treasuryAddress, amount)` then `treasury.deposit(amount)` from the owner or any USDC holder
8. Verify `useTreasuryBalance()` reflects the deposited amount

**Automation Registry** (`0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434`) is untouched. Deploying `AskirawaFiTreasury` does not affect it.

---

## Audit area 3: Frontend integration — honest accounting

### Flows enforced on-chain when treasury is deployed

| Feature | On-chain enforced | How |
|---|---|---|
| Approval proposals (create) | Yes | `proposeTransfer` tx required; receipt confirmed before local record written |
| Approval votes | Yes | `vote(proposalId)` tx on-chain; reverts if not approver, duplicate, or proposal invalid |
| Approval execution | Yes | `execute(proposalId, recipients, amounts)` with content hash check |
| Payroll batch proposal | Yes | `proposePayroll(proposalId, recipients, amounts, expiry)` |
| Payroll batch execution | Yes | `execute()` with frozen recipients/amounts from proposal confirmation |
| Recurring payment proposal | Yes | `proposeTransfer()` per payment period |
| Recurring payment execution | Yes | `execute()` per period |
| Quorum progress display | Yes | Reads `proposal.approvalCount` from contract via `useTreasuryProposal` |

### Flows that remain local-only (clearly disclosed in UI)

| Feature | Local-only | Reason |
|---|---|---|
| Payroll (treasury not deployed) | Yes | Personal-wallet sequential transfers; labeled "Direct wallet transfers" |
| Recurring payments (treasury not deployed) | Yes | Personal-wallet transfer per execution; labeled "Personal wallet / direct transfer" |
| Approvals (treasury not deployed) | Yes | localStorage records only; labeled with amber "local only" banner |
| Duplicate period prevention (recurring) | Partially | Primary check is localStorage; on-chain duplicate prevention comes from `ProposalAlreadyExists` revert if the same proposalId is re-submitted |
| Payroll batch personal-wallet fallback | Yes | Still present when treasury not deployed; explicitly labeled, not presented as approval-enforced |

### Limitations that must be disclosed to users

1. **No automatic execution.** No keeper or reliable execution service is deployed. All recurring payment executions and all proposal executions require a human to initiate the transaction. Do not represent recurring payments as "automatic" while this remains true.

2. **Quorum progress on a second device.** `ApprovalDetail` now reads `proposal.approvalCount` from the contract via `useTreasuryProposal`. This means the count is live from on-chain state regardless of which device voted. The display is now accurate across devices when the treasury is deployed.

3. **localStorage deduplication is not globally secure.** The duplicate-period guard in `ScheduleDetail` reads localStorage for the existing execution record. A second browser, second device, or cleared localStorage could allow a second proposal for the same period. On-chain protection: if the same `proposalId` is submitted twice, the contract reverts with `ProposalAlreadyExists`. The frontend proposes a stable ID derived from `keccak256(offChainId, chainId, contractAddress)` — so the same schedule+period combination produces the same proposalId and the contract prevents double-proposal.

4. **Payroll fallback is explicit.** When `isTreasuryDeployed` is false, `BatchDetail` shows the personal-wallet mode UI. It is labeled "Personal Wallet Mode" with an amber disclosure. It is not presented as treasury-approved payroll.

---

## Files changed — prior session (address guard hardening)

| File | Change |
|---|---|
| `src/lib/contract.ts` | Hardened `TREASURY_ADDRESS` and `PAYROLL_BATCH_ADDRESS` guards to also check `length === 42` |

## Files changed — this session (deployment checklist)

| File | Change |
|---|---|
| `src/components/layout/Topbar.tsx` | Wrong-network banner now includes chain ID 5042 in message text |
| `docs/mainnet-deployment-checklist.md` | New — full deployment readiness checklist |

No contract source changes were made. All 77 Foundry tests pass unchanged.

See `docs/mainnet-deployment-checklist.md` for the complete deployment procedure,
constructor arguments, post-deploy verification steps, and remaining risk registry.

---

## Deployment blockers — complete list

1. **Independent security audit required.** This document is a code-level review by the same system that wrote the code. It is not a substitute for an independent professional audit. The contract header explicitly states "UNAUDITED — HACKATHON DEMONSTRATION ONLY." Do not hold substantial production funds until an independent audit is completed and all findings are resolved.

2. **Deployment not yet authorized.** `VITE_TREASURY_ADDRESS` is unset. No deployment has been made. This is intentional — deployment requires explicit separate authorization from the repository owner.

3. **Approver key infrastructure not reviewed.** The security of the treasury depends entirely on the security of the approver private keys. Hardware wallet setup, backup procedures, and key rotation processes are outside the scope of this code review.

4. **No keeper service.** Recurring payments and expiring proposals require human intervention. A keeper would need to be separately designed, audited, and deployed. Do not represent automatic execution as available.

5. **Wallet connector coverage.** Only the injected (MetaMask) connector is configured. Mobile wallet users (WalletConnect) cannot connect. This is a UX limitation, not a security issue.

---

## Separation of code-level verification from live deployment verification

**This audit verified (code-level):**
- Contract source logic, error conditions, and state transitions
- Test coverage breadth and correctness
- Frontend address guard logic
- ABI consistency between contract source and frontend ABI definitions
- Chain ID and USDC address consistency across all source files

**This audit did NOT verify (requires live deployment):**
- That the contract behaves identically on Arc Mainnet chain ID 5042 as in the test environment
- That the USDC address `0x3600000000000000000000000000000000000000` on Arc Mainnet is the correct Circle-issued USDC (verified separately in a previous session via `read_contract`)
- That gas costs are acceptable on mainnet
- That the Vite build, when served from a production host, correctly reads `VITE_TREASURY_ADDRESS` from the deployment environment
- That the connected wallets of approvers are configured correctly

**This audit is not an independent security audit.** Passing automated tests demonstrates that the code behaves as the tests specify. It does not rule out logic errors, economic attacks, or vulnerabilities outside the test scenarios.
