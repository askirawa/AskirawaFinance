# Integration and Security Review — AskirawaFiTreasury
**Date:** 2026-10-21  
**Status:** Complete — awaiting deployment authorization

---

## 1. Outgoing USDC paths

| Flow | Contract involved | Treasury-gated | Notes |
|---|---|---|---|
| Approvals → Execute via Treasury | AskirawaFiTreasury.execute() | **Yes** | Only when `VITE_TREASURY_ADDRESS` is set AND `onChainProposalId` is present on the request |
| Approvals → Execute Payment (direct) | USDC.transfer() (ERC-20) | **No** | Only shown when `VITE_TREASURY_ADDRESS` is unset. Clearly labeled "direct transfer — not treasury enforced." |
| Payroll → Run Batch (atomic) | PayrollBatch.executeBatch() | **No** | Personal wallet sends from its own USDC balance. No treasury quorum. |
| Payroll → Run Batch (sequential fallback) | USDC.transfer() (ERC-20) | **No** | Personal wallet. No treasury quorum. |
| Recurring Payments → Execute | USDC.transfer() (ERC-20) | **No** | Personal wallet. No treasury quorum. |
| Automations → createAutomation | AutomationRegistry (no transfer) | N/A | Registers a rule; no USDC moves. |

**The only USDC path that is cryptographically enforced by treasury quorum is `Approvals → Execute via Treasury`, and only when the treasury is deployed and the proposal was registered on-chain.**

Payroll and Recurring Payments are personal-wallet operations. They are not treasury-gated and are clearly labeled as such in their respective UIs.

---

## 2. On-chain vs. local-only per feature

| Feature area | On-chain | Local-only |
|---|---|---|
| Approvals: propose | On-chain (proposeTransfer tx, confirmed before success shown) | — |
| Approvals: vote | On-chain (vote tx, requires onChainProposalId) | — |
| Approvals: execute | On-chain (execute tx through treasury) | — |
| Approvals: approve/reject buttons | Local decision record only (UI tracking) | Yes |
| Approvals: entire feature when treasury unset | — | localStorage only |
| Payroll batch | Personal-wallet USDC transfer | localStorage records |
| Recurring payments | Personal-wallet USDC transfer | localStorage records |
| Automations | AutomationRegistry on Arc Mainnet | — |
| Organization / team | — | localStorage only |
| Analytics | Live USDC balance read (wagmi) | localStorage aggregation |
| Notifications | — | localStorage only |

---

## 3. Bugs found and fixed

### Bug 1 — Propose transaction never submitted (critical integration gap)
**Before:** `ApprovalRequestModal.handleSubmit` called `onSubmit(fields)` → `createRequest` → localStorage. In on-chain mode, no wallet prompt appeared and no `proposeTransfer` transaction was sent. The success screen told the user to "Vote On-Chain" to register the proposal — but `treasury.vote(proposalId)` requires the proposal to already exist on-chain and would revert with `ProposalNotFound`.

**After:** In on-chain mode, `handleSubmit` calls `useTreasuryPropose.proposeTransfer`, waits for the transaction receipt, and only calls `onSubmit` (saving the local record) after receipt confirms `status === 'success'`. A rejected wallet or reverted transaction shows an error banner and keeps the modal open — no false success is reported. The success screen shows the propose tx hash and on-chain proposal ID with an explorer link.

### Bug 2 — Vote/Execute used a re-derived proposalId, not the confirmed one
**Before:** `ApprovalDetail` called `deriveProposalId(request.id)` to produce the proposalId for vote and execute calls. If the propose transaction failed or was never sent, this derived ID would not match any on-chain proposal, and `vote()` / `execute()` would revert with `ProposalNotFound`.

**After:** The confirmed bytes32 proposalId is stored on the local `ApprovalRequest` record as `onChainProposalId` at propose-confirmation time. Vote and execute use `request.onChainProposalId` exclusively. If `onChainProposalId` is absent, a "Not yet registered on-chain" amber banner is shown and the Vote / Execute buttons are hidden.

### Bug 3 — Local requests created before treasury deployment had no migration path
**Before:** Any request created before treasury was deployed had no `onChainProposalId`. In on-chain mode the UI would show the green treasury banner and the Vote button, but vote would revert.

**After:** The Vote and Execute buttons are gated on `!isOnChainProposalMissing`. Old requests without `onChainProposalId` show an amber "Not yet registered on-chain" banner with instructions to create a new request.

### Fix 4 — `_executeConfigChange` emitted `bytes32(0)` as proposalId in `Executed` event
Already applied in the previous session. Verified in current source: line 544 correctly receives `proposalId` from `execute()` and passes it through.

---

## 4. Lifecycle trace (on-chain mode, verified by source and tests)

```
1. User opens ApprovalRequestModal
2. Fills details: recipient, amount, description, expiry (1–30 days, default 7)
3. Clicks "Submit & Propose On-Chain"
   → modal calls useTreasuryPropose.proposeTransfer({offChainId, recipient, amount, expiresAt})
   → deriveProposalId(offChainId) = keccak256(encodePacked(offChainId, chainId, contractAddress)) → bytes32
   → writeContractAsync: treasury.proposeTransfer(proposalId, recipient, amount, expiresAt)
   → publicClient.waitForTransactionReceipt(hash)
   IF receipt.status !== 'success': error banner shown, local record NOT saved
   IF receipt.status === 'success':
     → onSubmit({ ...fields, onChainProposalId: proposalId, proposeTxHash: hash, onChainExpiresAt })
     → createRequest saves local record with onChainProposalId stored
     → success screen shows tx hash + proposal ID with explorer link

4. Approver B opens the request detail (proposal now has onChainProposalId)
   → green "Proposal confirmed on-chain" banner shown
   → "Vote On-Chain" button appears
   → clicks "Vote On-Chain"
   → handleTreasuryVote: vote(request.onChainProposalId)
   → waitForTransactionReceipt
   IF success: onApprove(request.id, address) updates local decision record

5. Repeat step 4 for enough approvers to reach quorum

6. Any address opens the request (status = 'approved')
   → "Execute via Treasury" button appears
   → handleTreasuryExecute: execute(proposalId, [recipient], [amount])
     recipients/amounts read from request.recipientAddress + parseUsdcString(request.amountUsdc)
     (these match the values passed to proposeTransfer — binding is enforced by contentHash in contract)
   → waitForTransactionReceipt
   IF success: onUpdate({ status: 'executed', txHash: hash, confirmedAt: now })
   IF failure: onUpdate({ status: 'failed', errorMessage })
```

**Payload binding:** The contract's `contentHash` = `keccak256(abi.encode(chainId, address(this), proposalId, txType, recipients, amounts, expiresAt))`. Any substitution of recipients or amounts in the `execute()` call causes `PayloadHashMismatch` revert. The frontend reads recipients/amounts from the immutable local record fields (`recipientAddress`, `amountUsdc`) that were set at propose time and are never editable.

---

## 5. Contract source verification

Inspected `AskirawaFiTreasury.sol` directly against every claim:

| Claim | Verified |
|---|---|
| Only `execute()` moves USDC — no owner withdrawal | Yes — no other function calls `usdc.safeTransfer` |
| `execute()` requires `approvalCount >= quorum` | Yes — line 477–478 |
| Self-vote blocked | Yes — `msg.sender == p.proposer` revert at line 416 |
| Duplicate vote blocked | Yes — `voted[proposalId][msg.sender]` mapping at line 417 |
| Non-approver cannot vote | Yes — `onlyApprover` modifier |
| Non-approver cannot propose | Yes — `onlyApprover` modifier |
| Payload binding via contentHash | Yes — lines 491–492 recompute and compare |
| CEI: `executed = true` before transfers | Yes — line 495 before `_executePayments` |
| ReentrancyGuard applied | Yes — `nonReentrant` on `execute()` |
| Chain ID in content hash | Yes — `block.chainid` in `_contentHash` |
| No escrow (balance checked at execute time) | Yes — `_executePayments` checks balance at execution |
| CONFIG_CHANGE cannot leave quorum > approverCount | Yes — `_validateApproversAndQuorum` |
| Owner cannot unilaterally move funds | Yes — `onlyOwner` only on `cancel()` and `transferOwnership()` |

---

## 6. ABI and function signature verification

| Function | ABI in contract.ts | Contract source | Match |
|---|---|---|---|
| `proposeTransfer(bytes32, address, uint256, uint64)` | Yes | Yes | ✓ |
| `proposePayroll(bytes32, address[], uint256[], uint64)` | Yes | Yes | ✓ |
| `vote(bytes32)` | Yes | Yes | ✓ |
| `execute(bytes32, address[], uint256[])` | Yes | Yes | ✓ |
| `cancel(bytes32)` | Yes | Yes | ✓ |
| `proposals(bytes32)` returns `(uint8, bool, bool, uint64, bytes32, address, uint16)` | Yes | Yes | ✓ |
| `balance()` returns `uint256` | Yes | Yes | ✓ |

All event signatures (`Proposed`, `Voted`, `Executed`, `PaymentSent`, `Cancelled`, `ApproversUpdated`) match between source and ABI.

---

## 7. Test results

| Suite | Tests | Result |
|---|---|---|
| `AskirawaFiTreasury.t.sol` | **47/47** (45 original + 2 new lifecycle tests) | All pass |
| `PayrollBatch.t.sol` | **18/18** | All pass |
| Frontend lint | **0 errors, 0 warnings** | Pass |
| Frontend typecheck | **0 errors** | Pass |

New tests added:
- `test_FullLifecycle_ProposeVoteExecute` — verifies propose → vote × 2 → execute with event assertions
- `test_RevertIf_VoteBeforePropose` — verifies `ProposalNotFound` when vote is called with a never-submitted proposalId (the exact revert a voter would hit if the old frontend bug remained)

---

## 8. Remaining limitations (not bugs)

- **Payroll and Recurring Payments are not treasury-gated.** They are personal-wallet transfers. To route them through the treasury, the submitter must create an Approval request of type `payroll_batch` or `recurring_schedule`, collect quorum, and execute via the treasury. The treasury's `proposePayroll` supports this flow; the Payroll UI does not yet wire into it.
- **Local approval decisions (Approve/Reject buttons) are not on-chain votes.** They update the local progress bar only. On-chain quorum is determined solely by `treasury.vote()` calls — the contract does not read localStorage.
- **No automatic execution.** All vote and execute steps require manual wallet action. There is no keeper service.
- **No real-time on-chain sync.** The detail view shows local decision records, not the contract's `approvalCount`. The `useTreasuryProposal` hook can read on-chain state but is not yet wired into the detail's progress bar.
- **This contract is unaudited.** Do not hold substantial production funds until an independent security audit is complete.

---

## 9. Files changed this session

| File | Change |
|---|---|
| `src/lib/approvals.ts` | Added `onChainProposalId`, `proposeTxHash`, `onChainExpiresAt` optional fields to `ApprovalRequest` |
| `src/hooks/useApprovals.ts` | `createRequest` now accepts and persists the three new on-chain fields |
| `src/components/approvals/ApprovalRequestModal.tsx` | Full rewrite: on-chain mode calls `proposeTransfer` and waits for receipt before saving; local mode unchanged; expiry slider added; success screen shows tx hash + proposal ID |
| `src/components/approvals/ApprovalDetail.tsx` | Uses `request.onChainProposalId` for vote/execute; "not yet registered" banner; propose tx row in details table; Vote/Execute gated on `onChainProposalId` present |
| `contracts/test/AskirawaFiTreasury.t.sol` | Added `test_FullLifecycle_ProposeVoteExecute` and `test_RevertIf_VoteBeforePropose` |
