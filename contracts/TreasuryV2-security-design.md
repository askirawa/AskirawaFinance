# Askirawa Treasury v2: Security (Part 3 of 4, rev 2)

Parts: [1 Core](./TreasuryV2-design.md) | [2 Modules](./TreasuryV2-modules-design.md) | **3 Security (this file)** | [4 Delivery](./TreasuryV2-delivery-design.md)

## 1. Audit findings and how v2 resolves each

| Audit finding | v2 resolution | Test that proves it (Part 4) |
|---|---|---|
| Proposal payload not readable onchain (High) | Full payload stored in contract state and emitted as events; `getPayroll(id, offset, limit)` returns every recipient and amount; `totalAmount`, expiry, delay, snapshot are struct fields. Execution takes no caller arrays. | G-PAY-01..04 |
| Votes not snapshotted (High) | Each proposal stores `epoch` and `quorum`. Voting eligibility uses that epoch's immutable approver set. Execution requires `epoch == currentEpoch`, so a governance change voids pending proposals instead of mixing old votes with a new set. | G-EPOCH-01..06 |
| Owner can veto, direct ownership transfer (Medium) | No owner. Cancel is limited to the proposer (own proposal) and the guardian (cannot cancel governance or unpause). Guardian is replaceable by quorum. | G-CANCEL-01..06 |
| Proposer cannot vote, quorum plus one lockout (Medium) | Proposer who is an approver auto-approves at creation, counted once. Two distinct approvers are always required because `MIN_QUORUM` is the constant 2 (D1). Quorum is enforced `>= MIN_QUORUM` and at least 2 approvers at deploy and on every governance change. | G-VOTE-01..06 |
| One bad recipient blocks the batch (Medium) | Accepted and resolved by decision D5: payroll is all-or-nothing and no partial mode exists. Remedy is cancel and re-propose without the bad recipient. UI pre-flight checks and execution simulation reduce occurrence. Schedules are single-payment and soft-fail with retry instead of reverting. | G-PAY-07, G-PAY-12, S-FAIL-* |
| Config proposal approvable but unexecutable (Low) | Duplicates and bad quorum revert at proposal time; the same validator runs again at execution. Duplicates are rejected, not silently merged. | G-GOV-03..05 |
| No pause, no rescue, no recovery path (Low) | `pause()` by guardian or any approver; unpause and rescue of non-USDC tokens by proposal. Recovery from lost approver keys is an open decision (D9): see section 11, nothing is chosen yet. | G-PAUSE-*, G-RESCUE-* |
| Obsolete keeper and off-chain approval logic | Replaced by the schedule module and onchain approvals (Part 2, Part 4). | M-SCHED-* |

## 2. Security considerations table

| Vulnerability | Applicable? | Mitigation |
|---|---|---|
| Reentrancy | Yes: USDC transfers, `onApproved` callback, `payFromModule` | `nonReentrant` on every state-changing external entry; effects before interactions (`Executed` set before transfers; schedule counters advance only after a successful pull); USDC has no callbacks; module code is quorum-approved and codehash-pinned. |
| Access control | Yes | Roles enumerated in Part 1, section 10.1. No owner. Each function lists its caller. Module-only functions check `modules[msg.sender].enabled` and codehash. |
| Integer overflow | Checked 0.8 | `unchecked` only for loop counters and vote counters bounded by `MAX_APPROVERS`; amounts are `uint96` with explicit total-overflow checks. |
| Unchecked external call or return | Yes | `SafeERC20` for every transfer; module call in `try/catch` and failures classified, not trusted. |
| Fee-on-transfer, rebasing | USDC only | Immutable USDC address; balance-delta assertion on every payout; fork test against the real token. |
| Signature replay | No signatures in v2 | N/A. If gasless voting is added later: EIP-712 with nonce, deadline, chain id and verifying contract. |
| Front-running, MEV | Limited | Ids are contract-assigned; execution is permissionless but sends only stored payments; no price-sensitive operation exists. |
| Flash-loan, oracle manipulation | No oracle, no price | N/A. |
| Denial of service | Yes | Bounded loops (`MAX_PAYMENTS`, `MAX_APPROVERS`, `MAX_BACKLOG`); no push to unbounded sets; schedule failures rate limited. One failing recipient only affects its own batch, resolved by re-proposal. |
| Delegatecall, proxy | No | No upgrade, no `delegatecall`, no arbitrary `call`. |
| Timestamp dependence | Yes | Seconds-scale tolerance (minimum 1 hour windows, delays in hours); never used for randomness. |
| Approval persistence | Yes | No token approvals by the treasury to anyone. Depositors approve exact amounts to the treasury; UI never requests unlimited approval. |
| Centralization | Yes | Quorum is the only fund authority; guardian cannot move funds; see threat table. |
| Arc native USDC pool | Yes | No `receive`/`fallback`; accounting uses `balanceOf` only; forced native sends only increase the balance. |
| USDC pause or blocklist | Yes (external) | All payouts revert atomically and nothing is lost; schedules soft-fail then auto-pause; documented in failure scenarios. Cannot be mitigated onchain. |
| Module codehash change | Yes | Core re-checks `extcodehash` per call; mismatch reverts. |
| Event or storage griefing by proposers | Yes | Proposer pays gas; UI filters by status. Optional per-proposer open-proposal cap (decision D10). |
| Stale approvals after approver removal | Yes | Epoch fence. Schedules created earlier survive governance changes (see risk R3). |

## 3. Trust model and threat analysis

| Actor / key | Max damage if compromised | Mitigation | Detection |
|---|---|---|---|
| One approver | Can propose, vote once per proposal, pause, cancel schedules. Cannot reach quorum alone. Can stall payments. | `MIN_QUORUM = 2`, so no single approver can ever pass anything; stalling is reversible by quorum (resume, unpause). | `Voted`, `Paused`, `ScheduleCancelled` events by that address |
| Fewer than quorum approvers | Same as above. | Epoch fence discards their pending votes when the set is rotated. | Same |
| Quorum of approvers | Can drain the treasury through payroll after `payrollDelay`. Inherent to any treasury. | Use Safes and hardware keys as approvers; delay plus guardian cancel gives the honest side time to react; module budgets cap schedule drains; small treasury hot balance. | Alert on any `Proposed` with `totalAmount` above threshold; `QuorumReached` |
| Guardian | Can pause (stall) and cancel payroll, module and rescue proposals. Cannot move funds, vote, propose, execute, unpause, or cancel governance and unpause proposals. | Quorum replaces the guardian by governance, which the guardian cannot block. | `Paused`, `Cancelled(by=guardian)` |
| Proposer (non-approver) | Spam proposals; cancel own. | Gas cost; UI filtering; optional cap. | `Proposed` rate per address |
| Executor / keeper | None beyond triggering due, approved payments and burning its own gas. | Open or restricted mode; no funds; no vote. | Failure and lag metrics |
| Module (buggy or malicious, but quorum-approved) | Up to `windowMax` per `windowLength` until paused or disabled. | Budgets set small; pause stops it instantly; codehash pinned; no admin on module. | `ModulePaid` totals versus budget |
| Depositor | None. | | |
| Legacy Automation Registry | None: v2 never calls or trusts it. | | |
| Circle (USDC issuer) | Can pause USDC or blocklist the treasury address, freezing funds. External dependency, not mitigable in contract code. | Keep operational balance moderate; document in risk register. | USDC `Blacklisted` and `Pause` events (monitor) |

Honest limit: protection against a fully compromised quorum is limited to the time delay plus whatever the guardian and monitoring can do in that window. The design deliberately does not claim more.

## 4. Priorities and tradeoffs

| Decision | Tradeoff | Rationale and rejected alternatives |
|---|---|---|
| Payload stored in state, not only hashed | Higher gas to propose (one slot per recipient) | Approvers and any contract can verify without an indexer. Rejected: hash-only with calldata recovery (the v1 weakness); event-only (depends on log retention and an indexer). Gas on Arc must be measured on testnet (D8). |
| Epoch fence on execution | Pending payroll must be re-proposed after any approver change | Prevents mixing votes across different trust sets; simple to reason about. Rejected: honoring old snapshots after rotation (a removed or compromised approver's votes would keep power). Snapshots are still stored for audit and for vote eligibility. |
| No owner | No one can fix a mistake unilaterally | Removes the single-key veto and bypass surface. Mistakes are fixed by quorum. |
| Guardian cancel limited, guardian replaceable | Guardian cannot stop a bad governance change | Avoids a hostile guardian becoming permanent. Rejected: guardian may cancel everything (circular lock-in). |
| Proposer auto-approves | Proposer's approval is implicit | Keeps four-eyes with `MIN_QUORUM = 2` and avoids needing quorum plus one approvers. Rejected: ban self-vote. |
| Atomic payroll (D5, resolved) | One bad recipient fails the whole batch and forces a re-proposal and new votes | Simpler state machine, exact reconciliation (a proposal is either fully paid or not paid), no partial-payment states to audit. Rejected: per-item partial execution with retry. Not revisited in v2. |
| Immutable contracts | Migration by switching contracts; a recovery mechanism cannot be added after deployment, and migration itself needs quorum | No proxy admin, no storage-layout risk. Rejected: UUPS behind quorum and timelock (adds an upgrade path equal in power to full fund control). This makes D9 a pre-deployment decision (section 11). |
| Pause is one-signer, unpause is quorum | A single approver or guardian can halt outflows | Fail-safe direction; recovery requires agreement. |
| Open execution of due items | Anyone can trigger payments at the earliest moment | Removes keeper trust and liveness risk; the payment is already approved. |
| Typed actions only | Less flexible than a generic executor | No arbitrary call means no way to turn the treasury into an attacker-controlled account. |

## 5. Emergency controls, fund recovery and what is deliberately absent

| Situation | Control |
|---|---|
| Suspected key compromise or bad proposal | `pause()` by guardian or any approver stops payroll execution and every module draw. `cancel` by guardian for non-governance proposals. Governance proposals can still be voted and executed while paused so approvers can be rotated. |
| Rotate approvers or guardian | Governance proposal, executes after `configDelay` (floor set at deploy, recommended 24 hours on mainnet). New epoch voids all other pending proposals. |
| Resume | `Unpause` proposal, quorum plus `configDelay`. Cannot be cancelled by the guardian. |
| Wrong token sent to the treasury | `Rescue` proposal for any token except USDC. USDC is never rescuable outside normal payroll. |
| Move everything to a new treasury | An ordinary payroll proposal of one item for the full balance, or several in steps. This is the migration path, and it has the same approval and delay as any payment. |
| Lost approver keys below quorum | Undecided (D9). Under the current draft with no recovery, funds are inaccessible when fewer than quorum approvers can sign: no backdoor, no owner override, and the guardian cannot help. Section 11 compares that approach with delayed, quorum-authorized recovery designs; no choice has been made. |
| USDC pauses or blocklists the treasury | Contract cannot fix it; all payments revert; nothing is lost; schedules auto-pause. |

## 6. Failure scenarios

| Scenario | Result |
|---|---|
| Payroll transfer 7 of 20 reverts (recipient rejected by USDC) | Whole `execute` reverts; status stays Pending; no funds moved; approvers cancel and re-propose without that recipient. |
| Treasury balance lower than total at execution | Reverts with `InsufficientBalance(have, need)`; proposal stays Pending until funded or expired. Two proposals cannot both pay from the same funds; whichever executes first wins, the second reverts. |
| Execution called twice in the same block | Second call reverts: status is `Executed`. |
| Approver removed after voting | The proposal is fenced; their vote has no effect in the new epoch. |
| Two governance proposals both approved | First executes and increments the epoch; the second is fenced. |
| Schedule due, treasury empty | `ExecutionFailed(INSUFFICIENT_BALANCE)`, retry after `retryDelay`, auto-pause after `maxFailures`. A deposit before then lets the next retry succeed with no data lost. |
| Keeper offline for a week (daily schedule) | First call after recovery finds more than `MAX_BACKLOG` overdue periods and pauses the schedule; a quorum resume chooses pay-all-missed or skip-missed. |
| Module budget exhausted mid-window | `payFromModule` reverts, the module records `BUDGET` failure; payment resumes automatically in the next window. |
| Module returns garbage on `onApproved` | The whole governance execution reverts; nothing changes. |
| Core paused while a payroll is executable | `execute` reverts `Paused`; the proposal waits until unpaused or expiry. |
| Chain reorg or dropped transaction | Frontend never marks anything done without a confirmed receipt and matching event (Part 4). |

## 7. Recommended parameters (to confirm, see Part 4 decisions)

| Parameter | Testnet | Mainnet suggestion |
|---|---|---|
| `MIN_QUORUM` (constant, D1) | 2 | 2 |
| Approvers | at least 2 test wallets (3 gives headroom), supplied by you (D15) | Safes or hardware wallets, count above quorum, supplied by you |
| `payrollDelay` | 0 to 10 minutes | 1 hour or more, tiered by amount if adopted |
| `configDelay` floor | 5 minutes | 24 hours |
| Proposal window | 1 hour to 30 days | same |
| `MAX_PAYMENTS` | measured on testnet, start at 100 | set from measured gas |
| Schedule module `perTxMax`, `windowMax` | small test values | sized to the largest legitimate schedule, windows of 1 day |
| `retryDelay`, `maxFailures` | 5 minutes, 3 | 6 hours, 5 |

## 8. Third-party libraries

| Library | Version | Already a dependency | Why | Security-reviewed |
|---|---|---|---|---|
| OpenZeppelin Contracts | 5.x (project currently pins 5.6.1) | yes | `SafeERC20`, `ReentrancyGuard`, `IERC165`, `IERC20` | widely audited |
| forge-std | existing | yes (tests) | Foundry test utilities | n/a |
| Date arithmetic | written in-repo (`ScheduleMath`, about 40 lines) | no | avoids an unaudited dependency | fuzzed against a reference implementation |

## 9. Monitoring and alerting

| Event or metric | Threshold | Severity | Action |
|---|---|---|---|
| `Proposed` with `totalAmount` above limit | any | warning | notify approvers |
| `QuorumReached` for payroll above limit | any | warning | guardian review inside the delay |
| `Paused`, `Cancelled(by=guardian)` | any | critical | incident review |
| `EpochCreated` | any | critical | confirm intended rotation |
| `ModuleConfig` executed | any | critical | confirm budget change |
| `ModulePaid` window spend above 80 percent of `windowMax` | | warning | review schedules |
| `ExecutionFailed`, `ScheduleAutoPaused` | any | warning | fund or investigate |
| Keeper lag above 1 hour, keeper gas balance low | | warning | restart or top up |
| USDC pause or blocklist events involving the treasury | any | critical | external incident |
| Treasury balance below next 7 days of scheduled payments | | warning | top up |

## 10. Cross-functional review

| Reviewer | Owns |
|---|---|
| Smart contract engineering | core and module code, Foundry suite |
| Independent security auditor | full scope before any mainnet use |
| Finance operations | parameters, approver roster, runbooks |
| Frontend and data | indexing, confirmation states (Part 4) |
| Compliance | USDC blocklist and pause exposure, record keeping |

## 11. Recovery mechanism evaluation (D9: open, no option selected)

This section compares ways to handle the loss of approver keys. It deliberately does not choose. The comparison, the open questions in 11.8, and the effect on implementation are for you to decide.

### 11.1 The problem, and why it must be decided before any code is deployed

- Funds can move only with a quorum of approvers (at least 2). If fewer than quorum approver keys can still sign (lost, destroyed, incapacitated), no payment, no governance change and no migration is possible.
- The contracts are immutable (no proxy, no owner), so a recovery path cannot be added after deployment. It also cannot be added by governance after the loss, because governance needs the quorum that was lost. Choosing "none" later is free; choosing "some mechanism" later means deploying a new treasury and moving funds through a payroll, which itself needs quorum.
- Therefore D9 is a precondition for implementation. Every option except A and A+ changes the Part 1 core specification.

### 11.2 Constraints you set

1. Recovery must be delayed.
2. Recovery must be authorized by a quorum of recovery signers, so no one person can trigger it.
3. The guardian must never have direct access to treasury funds, and (applied here) must have no recovery role at all.
4. It must be compared against the no-recovery approach, with trust assumptions, attack surface, lockout risk and implementation complexity.

### 11.3 Options evaluated

| Option | Summary | Contract change |
|---|---|---|
| A. No recovery | Current draft. Lost quorum means funds are permanently inaccessible. | none |
| A+. No recovery, mandated operational controls | Same contract as A. The deployment policy requires approvers to be Safes or hardware wallets, a set with headroom above quorum, documented key backup, scheduled rotation drills. Enforcement is procedural, not onchain. | none |
| B-a. Recovery council, onchain voting | A separate set of m recovery signers (threshold r of m) votes in the contract. After a long delay, anyone can execute and install a new governance configuration. A quorum of current approvers can veto during the delay. | new roles, storage and about 6 functions |
| B-b. Recovery address is an external Safe | The contract stores one recovery address (a Safe that the organization configures with its own r-of-m). Same delay and veto as B-a. The "not one person" property is provided by the Safe, not checked by the contract. | one address, about 3 functions |
| B-c. B-a or B-b plus an inactivity gate | Recovery can be started only if no proposal has executed for a long period. Single-approver actions do not count as activity; an executed proposal does. | B plus one timestamp and one check |
| F. Rate-limited recovery module | A pre-enabled module can draw to a pre-declared migration address, limited per window, triggered by a recovery council. Does not change governance; drains slowly. | module plus an exemption in the core's pause check |

Not evaluated because they violate the constraints: guardian-initiated recovery, any owner or admin override, recovery by a single "recovery key", and a proxy upgrade path.

### 11.4 Common design of the B family (what it does and does not do)

- **Recovery installs governance only.** It can set a new approver list, quorum (validated: at least 2 and at most the approver count), proposers, guardian and recovery set. It cannot pay, rescue, configure modules, or call any module. After recovery the new approvers must still propose and vote any payment, so recovery is a two-step path to funds with the normal checks on each step.
- **Authorization.** r-of-m recovery signers with r at least 2 and m at least r + 1; all distinct, none equal to the guardian. Whether they may overlap with approvers is open (Q4).
- **Sequence.** Initiate (r signers) then `RECOVERY_DELAY` then Execute (callable by anyone) then a new epoch begins, which voids every pending proposal (same fence as normal governance).
- **Veto.** During the delay a quorum of current approvers can cancel. A single approver cannot, and the guardian cannot. Reason: the only parties able to veto are exactly those whose liveness makes recovery unnecessary; a lone compromised approver cannot block a legitimate recovery.
- **After a veto.** The recovery set is suspended until normal governance replaces or re-enables it, which stops repeated initiation spam by a compromised set.
- **Pause interplay.** Initiating and executing recovery work while the treasury is paused; otherwise a single pauser could block recovery.
- **Changing the recovery set** is a normal governance proposal. If the quorum is lost, the recovery set cannot be rotated either.
- **Events (critical alerts):** `RecoveryInitiated`, `RecoveryVetoed`, `RecoveryExecuted`, `RecoverySetChanged`.
- **Inactivity gate (B-c).** Activity is a proposal executed (a quorum-level act). If fewer than quorum approvers are alive, activity stops and the gate opens; a single compromised approver cannot keep the gate closed because their actions are not counted.

### 11.5 Side-by-side comparison

| Criterion | A. None | A+. None plus procedure | B-a. Council, onchain votes | B-b. External Safe | B-c. B plus inactivity gate | F. Rate-limited module |
|---|---|---|---|---|---|---|
| Who can ever control funds besides a quorum of approvers | nobody | nobody | recovery signers (r of m), indirectly through new approvers, after delay and unless vetoed | the Safe's signers, same path | same, only after the inactivity period | recovery signers, directly but capped per window, to a fixed address only |
| Trust assumptions | approvers keep at least a quorum of working keys forever | same, plus procedural discipline | approvers keep a quorum online within the delay, or recovery signers are honest and independent | same as B-a, plus the Safe is configured as claimed (not verifiable by the contract) | as B, plus approvers are active in normal operation | as B, plus the migration address is correct and safe |
| Attack surface added | none | none | roles, storage, 6 functions, veto logic, pause exemption | 1 address, 3 functions, veto logic, pause exemption | B plus a timestamp that must be updated on every execution | a module with a pause exemption and a fixed destination |
| Lockout risk from lost approver keys | permanent | permanent, but less likely because of procedure | recoverable after the delay | recoverable after the delay | recoverable after inactivity period plus delay | recoverable slowly (drain rate limited) |
| Lockout or denial-of-service risk created by the mechanism itself | none | none | recovery-set key loss disables recovery only; spam initiations are limited by veto suspension | same | small: a bug in activity tracking could keep the gate shut | a compromised pauser cannot stop it by design, which also means pause cannot stop it |
| Takeover risk if recovery signers collude or are compromised | none | none | real: after the delay they can install their own approvers unless a quorum of approvers vetoes in time | same, and depends on how the Safe is run | lower: the attack window exists only during long inactivity | bounded theft per window, plus whatever happens before approvers react |
| Needs approver liveness | n/a | n/a | yes, to veto a hostile recovery within the delay | yes | yes, plus normal activity | yes, to disable the module |
| Implementation complexity (estimates, not measurements) | none | none; documentation and deploy checks | highest of the B family: about 6 new functions, 4 events, 25 to 35 extra tests | moderate: about 3 functions, 4 events, 12 to 18 extra tests | B plus about 6 extra tests | module plus core exemption: about 20 extra tests |
| Audit burden | baseline | baseline | meaningful: new authority path to funds | meaningful | meaningful | meaningful, and touches the budget logic |
| Operational burden | high on approvers | highest procedural burden | maintain a recovery set, monitor events | maintain a Safe, monitor events | as B, plus keep the org active | maintain council and migration address |
| Effect on the Part 1 spec | none | none | adds recovery section and extends governance payload | same | same | adds exemption to pause rules |

### 11.6 Scenarios (outcome per option)

| Scenario | A | A+ | B-a / B-b | B-c | F |
|---|---|---|---|---|---|
| 1. One of three approvers loses a key (quorum 2 still live) | rotate by governance | same | same | same | same |
| 2. Two of three keys lost (quorum unreachable) | funds frozen | funds frozen | recovery after delay | recovery after inactivity plus delay | slow drain to migration address |
| 3. All approver keys lost | frozen | frozen | recovery after delay | recovery after inactivity plus delay | slow drain |
| 4. Recovery signers compromised, approvers healthy | not applicable | not applicable | approvers veto within delay; if they miss it, attacker installs approvers | same, but only if the treasury was also inactive | attacker drains up to the window limit per window to the fixed address until a quorum disables the module (pause does not stop it, by design) |
| 5. Recovery signers compromised while approvers are unreachable for longer than the delay | not applicable | not applicable | takeover | takeover only if inactive long enough | bounded theft per window |
| 6. A single compromised approver tries to block a legitimate recovery | not applicable | not applicable | cannot: veto needs a quorum | cannot: its actions do not count as activity | not applicable |
| 7. Recovery signers' own keys are lost | not applicable | not applicable | recovery unavailable, treasury still works normally | same | same |
| 8. Hostile guardian | pause and cancel payroll only | same | same, plus cannot touch recovery | same | same |
| 9. Spam initiations by compromised recovery signers | not applicable | not applicable | one veto suspends the set; governance re-enables | same | not applicable |
| 10. Treasury dormant for a year with healthy approvers | fine | fine | fine, no recovery needed | recovery signers may start a recovery; approvers must veto | fine |
| 11. USDC issuer freezes the treasury address | funds frozen | frozen | frozen | frozen | frozen (no option helps) |

### 11.7 What each choice means for the rest of the design

- **A or A+:** Part 1 stays as written. Add to the deployment policy: approver addresses must be Safes or hardware wallets, a minimum headroom (for example 2-of-3 is the minimum viable, 3-of-5 gives headroom), a documented rotation drill schedule. The risk register keeps R5 as an accepted residual risk.
- **B-a / B-b / B-c / F:** Part 1 gains a recovery section, the governance payload gains recovery fields, the test plan gains a recovery group, the monitoring table gains critical alerts, and the independent audit scope grows. The choice between B-a and B-b is "contract enforces that it is not one person" versus "contract trusts a Safe you configure".

### 11.8 Questions that decide D9

1. How many independent people or entities will hold approver keys, and can they run Safes with their own key backup and rotation?
2. What is the longest period during which a quorum of approvers might be unreachable (vacation, incapacity)? A recovery delay shorter than that makes a hostile recovery unvetoable.
3. Is permanent loss of the treasury a worse outcome for you than adding a delayed takeover path guarded by a separate group?
4. Who would be the recovery signers, are there at least three independent ones, and may any of them also be approvers? Overlap lowers independence and raises correlated key-loss risk.
5. If a mechanism is chosen, do you prefer the contract to enforce the multi-person rule (B-a) or to trust an external Safe (B-b)?
6. Is the treasury expected to be dormant for long periods (relevant to B-c)?
7. What delay is acceptable: the evaluation intentionally gives no number; typical choices are weeks, not days.

No option is selected until you answer. Contract implementation does not begin until D9 is decided.

## 12. Implemented recovery (supersedes the open decision in section 11)

D9 was resolved as **option B-c on B-a**: a 3-member council with threshold 2, a 30 day inactivity gate, a 14 day
timelock with approver-quorum veto, and a 7 day post-recovery spending cooling period. Because the treasury plus the
council logic exceeded the 24,576 byte contract size limit (27,716 bytes), the council logic is a separate immutable
contract, `TreasuryRecovery`, and the treasury exposes one restricted hook, `installRecovery`, callable only by its
immutable `recovery` address. Section 11 remains as the record of the evaluated options.

Full description, permissions, limits and residual risks: `docs/recovery-design.md`. Not independently audited.
