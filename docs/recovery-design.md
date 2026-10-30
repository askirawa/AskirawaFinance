# Treasury v2: approver-key recovery (implemented design, option B-c on B-a)

Status: **implemented and tested locally. Not independently reviewed or audited. Not deployed anywhere.**
Do not describe it as secure or production-ready until an independent review is complete.

## 1. Problem
Funds move only when a quorum of approvers (minimum 2) approves and a timelock passes. Governance changes need the
same quorum. With 3 approvers and quorum 2, losing two keys leaves nothing able to execute, including a proposal to
replace the lost keys. The treasury has no owner and no upgrade path, so recovery has to exist before deployment.

## 2. Architecture
Recovery is a **separate immutable contract**, `contracts/v2/TreasuryRecovery.sol`, plus one narrow hook in the treasury.

Why separate: with the logic inside `AskirawaTreasury` the runtime bytecode was 27,716 bytes, above the standard
24,576 byte contract limit. Arc's own limit could not be confirmed, so the design assumes the standard one. With the
split the treasury is 22,865 bytes and the recovery contract about 9 KB.

| Piece | Where | What it does |
|---|---|---|
| Council, voting, veto, timelock, expiry | `TreasuryRecovery` | the whole state machine; holds no funds and no token logic |
| `installRecovery(config)` | `AskirawaTreasury` | callable **only** by the treasury's immutable `recovery` address; validates the config, starts a new epoch, starts the cooling period |
| Inactivity gate (30 days) | both | the recovery contract checks it at initiation; the treasury checks it again at install (defense in depth) |
| Cooling (7 days) | `AskirawaTreasury` | blocks payroll execution and module draws after an install |

Wiring is bidirectional and has no deployer privilege: deploy `TreasuryRecovery(council, 2)` first, then the
treasury with its address. The treasury's constructor stores it as an immutable and calls `bindTreasury`, which
records `msg.sender` as the treasury exactly once and checks the council is disjoint from the initial approvers and
guardian. The deploy script asserts both directions after deployment.

## 3. Parameters (constants, not configurable)
| Rule | Value |
|---|---|
| Council | 3 members, threshold 2 (the contract accepts 3 to 7 members with threshold 2 or more and below the member count; the deploy script requires exactly 3 and 2) |
| Inactivity gate | 30 days with no executed proposal and no completed recovery or veto |
| Council voting window | 7 days to reach the threshold |
| Recovery timelock | 14 days after the threshold is reached |
| Execution window | 14 days after the timelock, then the recovery expires |
| Approver veto | the **current** approvers' normal quorum (captured at initiation) |
| Post-recovery cooling | 7 days |

## 4. Who can do what
| Action | Who | Condition |
|---|---|---|
| `initiateRecovery(config, council, threshold)` | council member | gate open (30 days), no live recovery; the replacement config is fully validated now. The initiator counts as the first council vote. |
| `approveRecovery(id)` | council member, once | status Voting and still valid. Reaching the threshold starts the 14 day timelock. |
| `vetoRecovery(id)` | current approver, once | status Voting or Timelocked. Reaching the treasury quorum vetoes it and **restarts the 30 day gate**. |
| `cancelRecovery(id)` | the initiator | only while Voting |
| `expireRecovery(id)` | anyone | the recovery ran out of time, governance changed, or a proposal executed since it started |
| `executeRecovery(id)` | anyone | timelock elapsed, inside the execution window, still valid |
| `completeCooling()` | anyone | emits `CoolingPeriodCompleted` once the 7 days have passed |

A recovery is **void** (cannot be approved or executed) if the epoch changed since it started, or if any proposal
executed since it started, because that proves the approvers are active. Void recoveries can be marked expired by anyone.

## 5. What a recovery can and cannot do
It can only install a replacement governance configuration: approvers, quorum, proposers, guardian, payroll and
config delays, and the next council and threshold. The treasury re-validates it with the same rules as ordinary
governance, so the immutable minimum config delay still applies.

It cannot: transfer or withdraw USDC, rescue tokens, execute payroll, configure modules, pause or unpause, or
bypass any approval. `TreasuryRecovery` has no token code. Verified by tests that record every call the contract makes
during full lifecycles: it only reaches its own treasury, with value 0, and only the allowlisted functions
(`validateGovernance`, `installRecovery`, `currentEpoch`, `quorum`, `isApproverAt`, `lastActivityAt`, `coolingEnd`).

On execution: the epoch increments, every proposal from the previous epoch becomes Fenced, the new roster and council
are installed, the 30 day gate restarts (so a recovery cannot be chained), and spending cooling starts.

## 6. Cooling period
For 7 days payroll execution, module payments (`payFromModule`) and module funding revert with `SpendingCoolingOff`.
Deposits, ordinary governance, pause and unpause, module configuration and token rescue still work. Consequences:
- Proposals made during cooling need an expiry later than the end of cooling or they expire first.
- The module records a failed payment as a soft failure instead of reverting, so anyone calling `execute` on a schedule
  during cooling would count failures toward auto-pause. The keeper stands down automatically; manual callers should wait.

## 7. Repeated attempts
After an executed recovery or a veto the gate restarts, so a second recovery needs another 30 quiet days plus the
full vote and timelock. One recovery may be live at a time. A cancelled or expired recovery does not reset the gate,
but it carries over nothing: every recovery needs its own votes and its own timelock.

## 8. Failure scenarios and limits (read before relying on this)
1. **Compromised council plus approvers unreachable for 44+ days** installs hostile governance. Funds still cannot move
   for 7 days, then need a payroll delay and a quorum of the new approvers. This is the accepted trade-off of any
   recovery path; the control is monitoring and a fast veto.
2. **Nobody is watching.** The veto works only if someone notices `RecoveryInitiated` within the 14 day timelock. Alert on it.
3. **Council replacement only through a recovery.** There is no ordinary-governance path to rotate a council member.
   Losing two of three council keys disables recovery (the treasury keeps working). Losing one is survivable but cannot
   be repaired without a full recovery. Adding such a path is a possible follow-up (see section 10).
4. **Independence is checked at deployment and inside recovery, not in ordinary governance.** A quorum of approvers can
   knowingly make a council member an approver. A test documents this.
5. **A pre-approved proposal can be executed by anyone** while a recovery is in flight, which voids the recovery.
   Intended (it shows approvers acted), but note a hostile party can trigger it for a proposal the approvers already approved.
6. **A hostile council member can occupy the single recovery slot for up to 7 days** by initiating a bad recovery.
   Honest members and approvers wait it out or veto.
7. **The recovery contract can be griefed before binding.** Anyone can call `bindTreasury` first, which ruins that
   recovery contract (the treasury constructor then reverts). Deploy both in one session and verify the wiring.
8. **Approver veto cost.** A veto needs the treasury's normal quorum, so a single compromised approver cannot kill a
   legitimate recovery, and a lost-key scenario by definition cannot veto.
9. **External events.** A USDC issuer freeze of the treasury address is outside this design.
10. Still true from the base design: no owner, no upgrade path, 3-of-3-style lockups if quorum is set equal to the approver count.

## 9. Evidence
`contracts/test/v2/TreasuryRecovery.*.t.sol` (flow, cooling/repeat/compromise, authorization, invariants),
`server/v2-rehearsal.anvil.test.ts` (end to end on a local chain through the app's own ABIs), and the existing treasury
suites. Exact commands and results are in `docs/recovery-implementation-report.md`.

## 10. Open decisions for a later change
- Whether to add an ordinary-governance action that rotates the council (with a fresh delay), and whether council
  independence should be enforced there.
- Whether the 7 day voting window, the 14 day execution window and the exact definition of activity are right for production.
- Independent audit scope: both contracts and the deploy script.
