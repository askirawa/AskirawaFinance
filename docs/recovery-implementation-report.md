# Recovery implementation: verification report

Scope: council recovery (B-c on B-a) for Treasury v2, keeper and rehearsal updates, Governance recovery panel, docs.
Nothing was deployed or broadcast. Neither Automation Registry was touched. Not independently reviewed or audited.

## Result of the verification run (all from `AskirawaFinance/`)
| Check | Command | Result |
|---|---|---|
| Solidity build and sizes | `forge build --sizes` | exit 0. AskirawaTreasury 22,865 bytes (limit 24,576, margin 1,711), TreasuryRecovery 9,142, RecurringPaymentModule 12,092 |
| All Foundry tests | `forge test` | 42 suites, **801 passed, 0 failed, 0 skipped**. Includes v1, v2, deploy-script tests, 16 earlier invariants, `test_PAY12_NoAbiFunctionOrEventNamedSkipPartialAtomicOrForce`, and 66 recovery tests (28 flow, 25 safety/cooling/compromise/fuzz, 7 authorization, 6 invariant) |
| Server tests | `bun test server` | **45 pass, 0 fail**: 23 keeper, 14 local anvil rehearsal (incl. recovery lifecycle), 8 frontend helper |
| Frontend typecheck | `bunx tsc --noEmit` | exit 0 |
| Frontend lint | `bunx oxlint --type-aware src scripts` | 0 warnings, 0 errors |
| Server typecheck | `bunx tsc -p <temp config including server/keeper*.ts, chain.ts> --typeRoots node_modules/@types` | exit 0 (the repo's tsconfig does not cover `server/`) |
| Server lint | `bunx oxlint server/keeper.ts server/keeper-core.ts server/chain.ts` and the three test files | 0 warnings, 0 errors |
| Production build | `bunx vite build --outDir /tmp/ask-dist` | exit 0 |
| Slither | `forge build --build-info --skip "./contracts/test/**" "./contracts/script/**" --force`, then `slither . --foundry-out-directory contracts/out --foundry-ignore-compile --exclude-dependencies --filter-paths "node_modules\|lib\|contracts/test"` | 20 contracts, 48 results, exit 255 (Slither exits non-zero when it reports anything). Full log: `docs/static-analysis-slither.txt` |

Slither detail: only timestamp comparisons (intended: the gates are time based), strict equality on enums and zero amounts,
unused return values that are deliberate (overflow-validation call, ignored tuple fields), default-initialized loop locals,
a view call inside a bounded loop, array-length caching, naming and complexity. No reentrancy, arbitrary-send,
delegatecall, unchecked-transfer, controlled-call or locked-ether results. That classification is my reading, not an audit.

Not run: `bun run lint` and `bun run check` (the repo's lint script uses `--fix` across the whole repository, which would
rewrite unrelated files; I ran the same linter without `--fix` on the code I touched). Type-aware lint of the pre-existing
`server/db.ts` and `server/index.ts` reports errors that predate this work; they are not part of the repo's own lint scope and were not changed.
Not done: any browser or wallet test of the UI, and any Arc Testnet run.

## Requirement-by-requirement
| Requirement | How it is verified |
|---|---|
| `TreasuryRecovery` can only call the restricted hook | `test_AUTH01`: records every call made by the recovery contract across cancel, veto, expiry and execution. All go to its own treasury, value 0, selectors limited to `validateGovernance`, `installRecovery`, `currentEpoch`, `quorum`, `isApproverAt`, `lastActivityAt`, `coolingEnd`; no create, selfdestruct or delegatecall. `test_AUTH03`: no other address (approvers, council, guardian, the treasury, a different treasury's recovery contract) can call `installRecovery`; a bound recovery contract cannot be rebound. |
| Recovery cannot move or redirect funds | `test_AUTH02` plus the fuzz and invariant tests: the recovery path never touches the USDC contract; treasury and supply unchanged; the recovery contract holds nothing. The rehearsal asserts the same balance across a full recovery. |
| 30 day gate | Unit tests at gate minus 1 second and exactly at the gate; any executed proposal moves it; a veto and an executed recovery restart it; the treasury re-checks it in `installRecovery`; rehearsal on a local chain. |
| 14 day timelock | Execution one second early reverts, at the boundary succeeds; execution window expiry; rehearsal. |
| Approver-quorum veto | One veto is not enough, the treasury quorum vetoes in both Voting and Timelocked, duplicate veto rejected, non-approver rejected, gate restarts; rehearsal with real accounts. |
| 7 day cooling | Payroll, module draws and module funding revert until the boundary; deposits, governance, unpause, rescue and funding-free module actions keep working; `completeCooling` emits once; keeper stands down (unit and rehearsal). |
| Authorization, rotation limits, failures | Authorization tests above; `test_AUTH05` and `test_AUTH06` document that council independence is not enforced in ordinary governance and that the council can only be replaced by a recovery; `test_AUTH07` shows a failed execution changes nothing. |

## Files changed
Solidity: `contracts/v2/AskirawaTreasury.sol` (recovery hook, inactivity clock, cooling, 9th constructor argument; storage appended so existing layout is unchanged), new `contracts/v2/TreasuryRecovery.sol`, new `contracts/v2/interfaces/ITreasuryRecovery.sol`, `contracts/script/DeployConfigValidator.sol`, `DeployTreasuryV2.s.sol`, `deploy-v2.env.example`.
Solidity tests: new `TreasuryRecovery.{Base,Flow,Safety,Auth,Invariant}.t.sol`; updated `AskirawaTreasury.{Base,Governance,PayBase}.t.sol`, `Deploy*.t.sol`, `RecurringPaymentModule.Auth.t.sol`.
Frontend: new `src/components/v2/RecoveryPanel.tsx`, `src/hooks/v2/useRecoveryV2.ts`; updated `src/lib/v2/{abi,config,status}.ts`, `src/hooks/v2/{useTreasuryV2,useV2Events}.ts`, `src/components/v2/EventFeed.tsx`, `src/pages/Governance.tsx`, `src/vite-env.d.ts`, `env.example`.
Keeper and tests: `server/keeper-core.ts` (cooling stand-down), `server/keeper-core.test.ts`, `server/v2-rehearsal.anvil.test.ts` (recovery deployment order, gate, veto, lost-key recovery, cooling).
Docs: `docs/recovery-design.md` (rewritten as the implemented design), `contracts/TreasuryV2-security-design.md` (section 12), `docs/testnet-deployment-checklist.md`, `docs/keeper-setup.md`, `README.md`, `AGENTS.md`, `docs/static-analysis-slither.txt`, this report.
`snapshots/AskirawaTreasuryPayExecTest.json` is rewritten by the test suite itself (a gas snapshot); it is a side effect, not a decision.

## Remaining risks and open items
1. Not independently reviewed. Both contracts, the deploy script and the interaction between them need an external audit.
2. Compromised council plus approvers unreachable for 44+ days can install hostile governance (funds then wait 7 days of cooling and a payroll delay). Monitoring `RecoveryInitiated` is the main control.
3. The council can be replaced only by a recovery. Two lost council keys disable recovery. An ordinary-governance council rotation is a possible follow-up and would be a further core change.
4. Council independence from approvers is enforced at deployment and inside recovery, not in ordinary governance.
5. A hostile council member can hold the single recovery slot for up to 7 days; anyone can front-run `bindTreasury` on an unbound recovery contract (griefing only). Verify wiring after deployment.
6. Proposals made during cooling need an expiry after the cooling period; schedules called manually during cooling record failures.
7. The Arc contract size limit was not verified; the design stays under the standard limit.
8. Deployment policy (3 approvers, delays, council 3 of 2) is enforced by the deploy script, not by the contracts, which accept wider ranges.
9. The old v1 UI components remain unused; Analytics, Audit Log and Notifications still read browser-local data.

## Testnet readiness
Code, tests and documentation are ready for review. Deployment still needs your explicit authorization, six independent wallets
(3 approvers, 3 council members) plus an optional guardian, and a keystore signer. Follow `docs/testnet-deployment-checklist.md`.
