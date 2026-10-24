# Payroll and Recurring Payments — Treasury Integration Report

**Date:** 2026-10-22  
**Test results:** 50/50 treasury + 18/18 payroll Foundry tests. 0 frontend lint errors. 0 typecheck errors.

---

## Which actions are enforced on-chain vs. local-only

| Action | When treasury deployed (`VITE_TREASURY_ADDRESS` set) | When treasury not deployed |
|---|---|---|
| Create payroll batch | Local draft only (no change) | Local draft only |
| Propose payroll batch to treasury | **On-chain: `proposePayroll(id, recipients[], amounts[], expiresAt)`** | Not available |
| Vote on payroll proposal | **On-chain: `treasury.vote(proposalId)`** | Not available |
| Execute payroll batch | **On-chain: `treasury.execute(proposalId, frozenRecipients, frozenAmounts)`** — atomic, all-or-nothing | Sequential personal-wallet `USDC.transfer()` per employee OR atomic via PayrollBatch contract |
| Create recurring schedule | Local draft only (no change) | Local draft only |
| Propose a payment period to treasury | **On-chain: `proposeTransfer(id, recipient, amount, expiresAt)`** | Not available |
| Vote on recurring proposal | **On-chain: `treasury.vote(proposalId)`** | Not available |
| Execute recurring payment | **On-chain: `treasury.execute(proposalId, [recipient], [amount])`** | Personal-wallet `USDC.transfer()` |
| Automatic execution (keeper) | **No keeper deployed.** Execution is always manually triggered. | No keeper deployed |

---

## Contract compatibility

`AskirawaFiTreasury.sol` required **no changes**. It already had:

- `proposePayroll(bytes32, address[], uint256[], uint64)` — binds full batch payload to content hash
- `proposeTransfer(bytes32, address, uint256, uint64)` — binds single-recipient payload
- `execute(bytes32, address[], uint256[])` — verifies hash, requires quorum, atomically distributes
- `MAX_BATCH_SIZE = 200` — matches payroll limit

PayrollBatch.sol is **not used** as a treasury-spending route. When treasury is deployed, `BatchDetail` shows the treasury panel only. The old PayrollBatch/sequential paths are fully hidden and explicitly labeled as personal-wallet mode only.

---

## Payload binding and frozen-payload invariant

At `proposePayroll`/`proposeTransfer` call time, the contract computes:
```
contentHash = keccak256(abi.encode(
  block.chainid, address(this), proposalId, txType,
  recipients[], amounts[], expiresAt
))
```

The frontend stores the exact `frozenRecipients` and `frozenAmounts` returned from the propose transaction on the local record (`PayrollBatch.treasuryRecipients` / `treasuryAmounts`, `ExecutionRecord.treasuryRecipient` / `treasuryAmountRaw`). The execute call passes only those stored values — never re-reads from the current batch state. Any substitution causes `PayloadHashMismatch` revert.

**This means:** even if a user edits localStorage after proposing, the execute call will fail if the payload differs from what was proposed. The contract is the authority.

---

## Duplicate execution prevention

- **Payroll**: `treasury.execute()` sets `p.executed = true` before any external call (CEI pattern). A second call reverts with `ProposalAlreadyExecuted`. The `BatchDetail` UI hides the Execute button after `treasuryStatus === 'executed'`.
- **Recurring**: The `handleTreasuryPropose` function checks `schedule.executionHistory` for any existing entry with `treasuryProposalId` set and status not `failed`/`skipped`. If found, propose is blocked with a clear error. Each payment period uses a unique off-chain execution record ID to derive a distinct `proposalId`.

---

## Keeper / automatic execution

No keeper exists and none was implied. Both pages display explicit notices:
- Payroll: scheduled batches show "This batch was scheduled for X. It has not executed automatically."
- Recurring: "No keeper exists — execution is still manually triggered after approval."

---

## New Foundry tests (3 added)

| Test | What it proves |
|---|---|
| `test_PayrollLifecycle_ProposeVoteExecute` | Full 3-recipient payroll: propose → 2 votes → execute → funds distributed atomically |
| `test_RevertIf_PayrollSubstitutedRecipientOnExecute` | Substituting one recipient in `execute()` reverts with `PayloadHashMismatch` |
| `test_RecurringPayment_LifecycleAndDuplicateBlocked` | Single-recipient propose→vote→execute; second execute reverts with `ProposalAlreadyExecuted` |

---

## Files changed

| File | Change |
|---|---|
| `src/lib/payroll.ts` | Added `BatchTreasuryStatus` type and treasury fields to `PayrollBatch` interface |
| `src/lib/recurring.ts` | Added treasury fields to `ExecutionRecord` interface |
| `src/hooks/useTreasury.ts` | Added `useTreasuryPayroll` and `useTreasuryRecurringPropose` hooks |
| `src/components/payroll/BatchDetail.tsx` | Full rewrite: treasury panel (propose/vote/execute) + personal-wallet mode clearly separated |
| `src/components/recurring/ScheduleDetail.tsx` | Treasury propose/vote/execute panel added to Execute Payment section |
| `contracts/test/AskirawaFiTreasury.t.sol` | 3 new tests (50 total) |

---

## Remaining limitations

1. **No keeper** — recurring and scheduled payroll execution requires a connected wallet to trigger. Deploying a keeper (Gelato, Chainlink Automation, or custom) is a separate infrastructure task.
2. **No on-chain vote pre-check** — the Vote button does not pre-check `voted[proposalId][address]`. It lets the contract revert with `AlreadyVoted`. A future enhancement can add a `voted` read to hide the button for wallets that already voted.
3. **Treasury not deployed** — `VITE_TREASURY_ADDRESS` is still unset. All treasury paths remain in build-verified but unexercised code until deployment is authorized.
4. **Independent audit required** — `AskirawaFiTreasury.sol` is unaudited. Do not hold substantial production funds.
