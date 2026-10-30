/**
 * Local rehearsal of the Treasury v2 lifecycle on a throwaway anvil chain, driven ONLY through the same
 * ABIs, payload encoders and keeper code the app uses. It proves the TypeScript layer matches the real
 * contracts. It is NOT a testnet deployment and does not replace the Arc Testnet rehearsal.
 *
 * Needs `anvil` and compiled artifacts:   forge build   (or set FORGE_OUT to another output directory).
 * Skips itself when either is missing. Uses anvil's unlocked dev accounts; no keys are read or stored.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { BaseError, ContractFunctionRevertedError, createPublicClient, getAddress, createWalletClient, http, parseEventLogs, type Abi, type Address, type Hex } from 'viem'
import { foundry } from 'viem/chains'
import { MODULE_V2_ABI, MODULE_ACTION, RECOVERY_V2_ABI, TREASURY_V2_ABI } from '../src/lib/v2/abi'
import { ACTION, PSTATUS, decodePayload, describeError, encodeResume, encodeScheduleParams, inspectScheduleExecution } from '../src/lib/v2/status'
import { runOnce, viemKeeperClient, type KeeperConfig } from './keeper-core'

const OUT = process.env.FORGE_OUT ?? 'contracts/out'
const art = (sol: string, name: string) => `${OUT}/${sol}/${name}.json`
const have = spawnSync('anvil', ['--version']).status === 0
  && existsSync(art('AskirawaTreasury.sol', 'AskirawaTreasury')) && existsSync(art('V2MockUSDC.sol', 'V2MockUSDC'))
const suite = have ? describe : describe.skip

const PORT = 8546
const RPC = `http://127.0.0.1:${PORT}`
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const HOUR = 3600, DAY = 86400
const USDC = (n: number) => BigInt(Math.round(n * 1e6))

let anvil: ChildProcess | undefined
const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
const wallet = createWalletClient({ chain: foundry, transport: http(RPC) })
const raw = (method: string, params: unknown[] = []) => pub.request({ method, params } as never)

let accts: Address[] = []
let treasury: Address, module: Address, token: Address, recovery: Address
const [DEPLOYER, A1, A2, A3, A4, GUARDIAN, R1, R2, KEEPER, STRANGER] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
// recovery cast: current council, replacement approvers, replacement council
const [C1, C2, C3, N1, N2, N3, NC1, NC2, NC3] = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const
const who = (i: number) => accts[i] as Address

function artifact(sol: string, name: string): { abi: Abi; bytecode: Hex } {
  const j = JSON.parse(readFileSync(art(sol, name), 'utf8')) as { abi: Abi; bytecode: { object: Hex } }
  return { abi: j.abi, bytecode: j.bytecode.object }
}

async function deploy(i: number, sol: string, name: string, args: unknown[] = []): Promise<Address> {
  const { abi, bytecode } = artifact(sol, name)
  const hash = await wallet.deployContract({ account: who(i), abi, bytecode, args } as never)
  const r = await pub.waitForTransactionReceipt({ hash })
  expect(r.status).toBe('success')
  return getAddress(r.contractAddress as string)
}

async function send(i: number, address: Address, abi: Abi, functionName: string, args: unknown[] = []) {
  const { request } = await pub.simulateContract({ account: who(i), address, abi, functionName, args } as never)
  const hash = await wallet.writeContract(request as never)
  const r = await pub.waitForTransactionReceipt({ hash })
  expect(r.status).toBe('success')
  return r
}
const T = (fn: string, args: unknown[] = [], i = A1) => send(i, treasury, TREASURY_V2_ABI, fn, args)
const rd = <R>(address: Address, abi: Abi, functionName: string, args: unknown[] = []) => pub.readContract({ address, abi, functionName, args } as never) as Promise<R>
const R = (fn: string, args: unknown[] = [], i: number = C1) => send(i, recovery, RECOVERY_V2_ABI, fn, args)
const rc = <R>(fn: string, args: unknown[] = []) => rd<R>(recovery, RECOVERY_V2_ABI, fn, args)
const tr = <R>(fn: string, args: unknown[] = []) => rd<R>(treasury, TREASURY_V2_ABI, fn, args)
const bal = (a: Address) => rd<bigint>(token, artifact('V2MockUSDC.sol', 'V2MockUSDC').abi, 'balanceOf', [a])

async function now() { return Number((await pub.getBlock()).timestamp) }
async function warp(seconds: number) { await raw('evm_increaseTime', [seconds]); await raw('evm_mine') }

/** Simulates a call that must revert with the named custom error; returns the user-facing message. */
async function failsWith(i: number, fn: string, args: unknown[], errorName: string): Promise<string> {
  return failsOn(treasury, TREASURY_V2_ABI, i, fn, args, errorName)
}
async function failsOn(address: Address, abi: Abi, i: number, fn: string, args: unknown[], errorName: string): Promise<string> {
  try {
    await pub.simulateContract({ account: who(i), address, abi, functionName: fn, args } as never)
  } catch (e) {
    const reverted = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null
    const name = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined
    expect(name).toBe(errorName)
    return describeError(e)
  }
  throw new Error(`expected ${fn} to revert with ${errorName}, but it succeeded`)
}

async function propose(fn: string, args: unknown[], i = A1): Promise<bigint> {
  const next = await tr<bigint>('nextProposalId')
  await T(fn, args, i)
  return next
}
async function approveAndExecute(id: bigint, approvers: number[], delay: number) {
  for (const a of approvers) await T('approve', [id], a)
  await warp(delay + 1)
  await T('execute', [id], STRANGER) // execution is permissionless
}

const state = async (id: bigint) => Number(await tr<number>('status', [id]))
const exp = async (extra = 0) => BigInt((await now()) + 7 * DAY + extra)

suite('Treasury v2 local rehearsal (anvil)', () => {
  beforeAll(async () => {
    anvil = spawn('anvil', ['--port', String(PORT), '--silent', '--chain-id', '31337', '--accounts', '20'], { stdio: 'ignore' })
    for (let i = 0; i < 60; i++) {
      try { await pub.getChainId(); break } catch { await new Promise((r) => setTimeout(r, 250)) }
    }
    accts = ((await pub.request({ method: 'eth_accounts' } as never)) as string[]).map((a) => getAddress(a))
    token = await deploy(DEPLOYER, 'V2MockUSDC.sol', 'V2MockUSDC')
    // recovery contract first (it binds to the treasury from the treasury's constructor), then the treasury
    recovery = await deploy(DEPLOYER, 'TreasuryRecovery.sol', 'TreasuryRecovery', [[who(C1), who(C2), who(C3)], 2])
    treasury = await deploy(DEPLOYER, 'AskirawaTreasury.sol', 'AskirawaTreasury', [token, HOUR, [who(A1), who(A2), who(A3)], [], 2, who(GUARDIAN), 300, HOUR, recovery])
    module = await deploy(DEPLOYER, 'RecurringPaymentModule.sol', 'RecurringPaymentModule', [treasury, HOUR, 3])
    const usdcAbi = artifact('V2MockUSDC.sol', 'V2MockUSDC').abi
    await send(DEPLOYER, token, usdcAbi, 'mint', [who(DEPLOYER), USDC(10_000)])
  }, 60_000)

  afterAll(() => { anvil?.kill() })

  test('deployment: epoch one, roles, delays, module starts disabled', async () => {
    expect(await tr<bigint>('currentEpoch')).toBe(1n)
    expect(await tr<number>('quorum')).toBe(2)
    expect(await tr<number>('payrollDelay')).toBe(300)
    expect(await tr<boolean>('isApprover', [who(A1)])).toBe(true)
    expect(await tr<boolean>('isApprover', [who(DEPLOYER)])).toBe(false)
    expect(await tr<string>('guardian')).toBe(who(GUARDIAN))
    const m = await tr<readonly [boolean]>('modules', [module])
    expect(m[0]).toBe(false)
    expect(await rd<string>(module, MODULE_V2_ABI, 'treasury')).toBe(treasury)
    // recovery wiring: both directions agree
    expect(await tr<string>('recovery')).toBe(recovery)
    expect(await rc<string>('treasury')).toBe(treasury)
    expect(await rc<number>('councilThreshold')).toBe(2)
    expect(await rc<boolean>('isCouncilMember', [who(C1)])).toBe(true)
    expect(await tr<boolean>('isApprover', [who(C1)])).toBe(false)
  })

  test('deposit: approve then deposit moves exactly the amount', async () => {
    const usdcAbi = artifact('V2MockUSDC.sol', 'V2MockUSDC').abi
    await send(DEPLOYER, token, usdcAbi, 'approve', [treasury, USDC(1000)])
    await send(DEPLOYER, treasury, TREASURY_V2_ABI, 'deposit', [USDC(1000)])
    expect(await tr<bigint>('balance')).toBe(USDC(1000))
  })

  test('payroll: quorum and timelock are enforced before it pays', async () => {
    const id = await propose('proposePayroll', [[{ to: who(R1), amount: USDC(100) }, { to: who(R2), amount: USDC(50) }], await exp(), '0x' + '00'.repeat(32)])
    const p = await tr<{ approvals: number; quorum: number }>('getProposal', [id])
    expect(p.approvals).toBe(1) // proposer-approver auto-approves
    expect(p.quorum).toBe(2)
    expect(await state(id)).toBe(PSTATUS.Pending)
    expect(await failsWith(STRANGER, 'execute', [id], 'QuorumNotReached')).toContain('Not enough approvals')
    expect(await failsWith(STRANGER, 'approve', [id], 'NotApprover')).toContain('not an approver')
    expect(await failsWith(A1, 'approve', [id], 'AlreadyVoted')).toContain('already voted')
    await T('approve', [id], A2)
    expect(await state(id)).toBe(PSTATUS.Approved)
    expect(await failsWith(STRANGER, 'execute', [id], 'DelayNotElapsed')).toContain('timelock')
    await warp(301)
    expect(await state(id)).toBe(PSTATUS.Executable)
    const before = [await bal(who(R1)), await bal(who(R2)), await tr<bigint>('balance')]
    await T('execute', [id], STRANGER)
    expect(await bal(who(R1))).toBe(before[0]! + USDC(100))
    expect(await bal(who(R2))).toBe(before[1]! + USDC(50))
    expect(await tr<bigint>('balance')).toBe(before[2]! - USDC(150))
    expect(await state(id)).toBe(PSTATUS.Executed)
    const items = await tr<readonly { to: Address; amount: bigint }[]>('getPayroll', [id, 0n, 100n])
    expect(items.length).toBe(2)
  })

  test('payroll above the treasury balance cannot execute', async () => {
    const id = await propose('proposePayroll', [[{ to: who(R1), amount: USDC(5000) }], await exp(), '0x' + '00'.repeat(32)])
    await T('approve', [id], A2)
    await warp(301)
    expect(await failsWith(STRANGER, 'execute', [id], 'InsufficientBalance')).toContain('does not hold enough')
  })

  test('guardian pause blocks payroll; unpause needs quorum and the config delay', async () => {
    await T('pause', [], GUARDIAN)
    expect(await tr<boolean>('paused')).toBe(true)
    const pay = await propose('proposePayroll', [[{ to: who(R1), amount: USDC(1) }], await exp(), '0x' + '00'.repeat(32)])
    await T('approve', [pay], A2)
    await warp(301)
    expect(await failsWith(STRANGER, 'execute', [pay], 'TreasuryPaused')).toContain('paused')
    expect(await failsWith(GUARDIAN, 'approve', [pay], 'NotApprover')).toContain('not an approver')
    const un = await propose('proposeUnpause', [await exp(), '0x' + '00'.repeat(32)])
    await T('approve', [un], A2)
    await warp(HOUR + 1)
    await T('execute', [un], STRANGER)
    expect(await tr<boolean>('paused')).toBe(false)
    await T('cancel', [pay], A1)
    expect(await state(pay)).toBe(PSTATUS.Cancelled)
  })

  test('guardian can cancel payroll but never governance', async () => {
    const pay = await propose('proposePayroll', [[{ to: who(R1), amount: USDC(1) }], await exp(), '0x' + '00'.repeat(32)])
    await T('cancel', [pay], GUARDIAN)
    expect(await state(pay)).toBe(PSTATUS.Cancelled)
    const gov = await propose('proposeGovernance', [{ approvers: [who(A1), who(A2), who(A3)], proposers: [], quorum: 2, guardian: who(GUARDIAN), payrollDelay: 300, configDelay: HOUR }, await exp(), '0x' + '00'.repeat(32)])
    expect(await failsWith(GUARDIAN, 'cancel', [gov], 'Unauthorized')).toContain('not allowed')
    await T('cancel', [gov], A1)
  })

  test('governance rotation replaces A3 with A4 and voids other pending proposals', async () => {
    const pending = await propose('proposePayroll', [[{ to: who(R1), amount: USDC(1) }], await exp(), '0x' + '00'.repeat(32)])
    const gov = await propose('proposeGovernance', [{ approvers: [who(A1), who(A2), who(A4)], proposers: [], quorum: 2, guardian: who(GUARDIAN), payrollDelay: 300, configDelay: HOUR }, await exp(), '0x' + '00'.repeat(32)])
    const payload = decodePayload(ACTION.Governance, await tr<Hex>('getPayload', [gov]))
    expect(payload.kind === 'governance' && payload.config.approvers[2]).toBe(who(A4))
    await approveAndExecute(gov, [A2], HOUR)
    expect(await tr<bigint>('currentEpoch')).toBe(2n)
    expect(await tr<boolean>('isApprover', [who(A3)])).toBe(false)
    expect(await tr<boolean>('isApprover', [who(A4)])).toBe(true)
    expect(await state(pending)).toBe(PSTATUS.Fenced)
    expect(await failsWith(A2, 'approve', [pending], 'WrongEpoch')).toContain('Governance changed')
  })

  test('recurring module: enable through governance, create a schedule, keeper pays it', async () => {
    // module is disabled, so a schedule proposal is rejected up front
    expect(await failsWith(A1, 'proposeModuleAction', [module, MODULE_ACTION.CREATE_SCHEDULE, '0x', 0n, await exp(), '0x' + '00'.repeat(32)], 'ModuleDisabled')).toContain('not enabled')
    const cfg = await propose('proposeModuleConfig', [module, true, USDC(10), USDC(15), 30 * DAY, await exp(), '0x' + '00'.repeat(32)])
    await approveAndExecute(cfg, [A2], HOUR)
    const m = await tr<readonly [boolean, string, bigint, bigint, number, bigint, bigint]>('modules', [module])
    expect(m[0]).toBe(true)
    expect(m[2]).toBe(USDC(10))

    const data = encodeScheduleParams({ recipient: who(R1), amount: USDC(10), frequency: 0, startTime: 0n, endTime: 0n, maxExecutions: 0, maxTotal: 0n, minTreasuryBalanceAfter: 0n, executor: ZERO, memoRef: ('0x' + '00'.repeat(32)) as Hex })
    const sched = await propose('proposeModuleAction', [module, MODULE_ACTION.CREATE_SCHEDULE, data, 0n, await exp(), '0x' + '00'.repeat(32)])
    const details = decodePayload(ACTION.ModuleAction, await tr<Hex>('getPayload', [sched]))
    expect(details.kind === 'moduleAction' && details.actionCode).toBe(1)
    await approveAndExecute(sched, [A2], 300)
    expect(await rd<bigint>(module, MODULE_V2_ABI, 'scheduleCount')).toBe(1n)

    const cfgK: KeeperConfig = { treasury, module, keeper: who(KEEPER), maxSchedulesPerPoll: 10, maxScan: 100, retryMax: 1, receiptTimeoutMs: 20_000, retryBackoffMs: 50 }
    const keeperWallet = viemKeeperClient(pub, createWalletClient({ chain: foundry, transport: http(RPC), account: who(KEEPER) }))
    const before = await bal(who(R1))
    const reports = await runOnce(keeperWallet, cfgK, () => undefined)
    expect(reports.map((r) => r.outcome)).toEqual(['paid'])
    expect(await bal(who(R1))).toBe(before + USDC(10))
    // the window budget (15) now has 5 left: a second payment (10) in the same window must be skipped, not attempted
    await warp(DAY + 5)
    const second = await runOnce(keeperWallet, cfgK, () => undefined)
    expect(second.map((r) => r.outcome)).toEqual(['skipped'])
    expect(second[0]?.reason).toContain('budget')
    const s = await rd<{ failures: number; executedCount: number }>(module, MODULE_V2_ABI, 'getSchedule', [1n])
    expect(s.failures).toBe(0) // the keeper did not provoke a recorded failure
    expect(s.executedCount).toBe(1)
  }, 60_000)

  test('a manual module execution that cannot pay is reported as a failure, not a success', async () => {
    // fresh window budget so the draw is attempted, then pause the treasury so the draw fails softly
    await T('pause', [], A1)
    const hash = await wallet.writeContract({ account: who(STRANGER), address: module, abi: MODULE_V2_ABI, functionName: 'execute', args: [1n] } as never)
    const receipt = await pub.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success') // the EVM call succeeds...
    expect(inspectScheduleExecution(receipt)).toContain('treasury is paused') // ...but the UI must report failure
    const events = parseEventLogs({ abi: MODULE_V2_ABI, logs: receipt.logs, strict: false })
    expect(events.some((e) => e.eventName === 'ExecutionFailed')).toBe(true)
    const un = await propose('proposeUnpause', [await exp(), '0x' + '00'.repeat(32)])
    await approveAndExecute(un, [A2], HOUR)
    expect(await tr<boolean>('paused')).toBe(false)
  })

  test('keeper does nothing while the treasury is paused', async () => {
    await T('pause', [], GUARDIAN)
    const cfgK: KeeperConfig = { treasury, module, keeper: who(KEEPER), maxSchedulesPerPoll: 10, maxScan: 100, retryMax: 0, receiptTimeoutMs: 5_000, retryBackoffMs: 10 }
    const k = viemKeeperClient(pub, createWalletClient({ chain: foundry, transport: http(RPC), account: who(KEEPER) }))
    const nonceBefore = await pub.getTransactionCount({ address: who(KEEPER) })
    expect(await runOnce(k, cfgK, () => undefined)).toEqual([])
    expect(await pub.getTransactionCount({ address: who(KEEPER) })).toBe(nonceBefore)
    const un = await propose('proposeUnpause', [await exp(), '0x' + '00'.repeat(32)])
    await approveAndExecute(un, [A2], HOUR)
  })

  test('cancelled schedules stop; prefunded module funds return to the treasury', async () => {
    const m = await rd<{ status: number }>(module, MODULE_V2_ABI, 'getSchedule', [1n])
    expect(m.status).toBe(1)
    await send(A2, module, MODULE_V2_ABI, 'cancel', [1n])
    expect((await rd<{ status: number }>(module, MODULE_V2_ABI, 'getSchedule', [1n])).status).toBe(3)
    expect(await rd<boolean>(module, MODULE_V2_ABI, 'isDue', [1n])).toBe(false)

    // prefund the module through an approved action, then return everything
    const usdcAbi = artifact('V2MockUSDC.sol', 'V2MockUSDC').abi
    const before = await tr<bigint>('balance')
    const fund = await propose('proposeModuleAction', [module, MODULE_ACTION.RESUME_SCHEDULE, encodeResume(99n, false), USDC(5), await exp(), '0x' + '00'.repeat(32)])
    await T('approve', [fund], A2)
    await warp(301)
    // resuming an unknown schedule reverts inside the callback, so the whole action (including funding) rolls back
    await failsWith(STRANGER, 'execute', [fund], 'ModuleCallbackFailed')
    expect(await tr<bigint>('balance')).toBe(before)
    // donate directly to the module, then recover it through the dedicated action
    await send(DEPLOYER, token, usdcAbi, 'transfer', [module, USDC(3)])
    const rec = await propose('proposeModuleAction', [module, MODULE_ACTION.RECOVER_FUNDS, '0x', 0n, await exp(), '0x' + '00'.repeat(32)])
    await approveAndExecute(rec, [A2], 300)
    expect(await bal(module)).toBe(0n)
    expect(await tr<bigint>('balance')).toBe(before + USDC(3))
  }, 60_000)

  const newCfg = () => ({ approvers: [who(N1), who(N2), who(N3)], proposers: [], quorum: 2, guardian: ZERO, payrollDelay: 300, configDelay: HOUR })
  const NEW_COUNCIL = () => [who(NC1), who(NC2), who(NC3)]
  const rec = async (id: bigint) => rc<readonly [number, bigint, number, Address, bigint, bigint, bigint, bigint, number, number]>('recoveries', [id])

  test('recovery is closed while approvers are active and cannot be called around the gate', async () => {
    const eligible = await rc<bigint>('recoveryEligibleAt')
    expect(Number(eligible)).toBeGreaterThan(await now())
    await failsOn(recovery, RECOVERY_V2_ABI, C1, 'initiateRecovery', [newCfg(), NEW_COUNCIL(), 2], 'InactivityNotMet')
    await failsOn(recovery, RECOVERY_V2_ABI, A1, 'initiateRecovery', [newCfg(), NEW_COUNCIL(), 2], 'NotCouncilMember')
    // the treasury hook answers only to the recovery contract
    for (const i of [A1, C1, GUARDIAN, STRANGER, DEPLOYER]) await failsWith(i, 'installRecovery', [newCfg()], 'NotRecovery')
  })

  test('recovery veto: the live approvers (normal quorum) stop a council recovery and the gate resets', async () => {
    await warp(31 * DAY) // no executed proposal for 31 days
    const id = await rc<bigint>('nextRecoveryId')
    await R('initiateRecovery', [newCfg(), NEW_COUNCIL(), 2], C1)
    await R('approveRecovery', [id], C2)
    expect((await rec(id))[0]).toBe(2) // timelocked
    await R('vetoRecovery', [id], A1)
    expect((await rec(id))[0]).toBe(2) // one veto is not the quorum
    await failsOn(recovery, RECOVERY_V2_ABI, A1, 'vetoRecovery', [id], 'AlreadyVoted')
    await R('vetoRecovery', [id], A2)
    expect((await rec(id))[0]).toBe(4) // vetoed
    await failsOn(recovery, RECOVERY_V2_ABI, C1, 'initiateRecovery', [newCfg(), NEW_COUNCIL(), 2], 'InactivityNotMet')
  }, 60_000)

  test('lost keys: two lost keys block governance until a recovery runs; recovery installs new governance and cools spending', async () => {
    // epoch 2 approvers: A1, A2, A4. One lost key is survivable.
    const ok = await propose('proposePayroll', [[{ to: who(R2), amount: USDC(1) }], await exp(), '0x' + '00'.repeat(32)])
    await approveAndExecute(ok, [A2], 300)
    expect(await state(ok)).toBe(PSTATUS.Executed)
    // A2 and A4 lost: only A1 can sign, so nothing can reach quorum
    const stuck = await propose('proposePayroll', [[{ to: who(R2), amount: USDC(1) }], await exp(), '0x' + '00'.repeat(32)])
    await warp(HOUR)
    expect(await failsWith(STRANGER, 'execute', [stuck], 'QuorumNotReached')).toContain('Not enough approvals')

    // 30 days of inactivity, then the council recovers
    await raw('evm_setNextBlockTimestamp', [Number(await rc<bigint>('recoveryEligibleAt'))])
    await raw('evm_mine')
    const fundsBefore = await tr<bigint>('balance')
    const id = await rc<bigint>('nextRecoveryId')
    await R('initiateRecovery', [newCfg(), NEW_COUNCIL(), 2], C1)
    await failsOn(recovery, RECOVERY_V2_ABI, C1, 'approveRecovery', [id], 'AlreadyVoted') // duplicate council vote
    await R('approveRecovery', [id], C2)
    const [, , , , , approvedAt, executableAt] = await rec(id)
    expect(Number(executableAt - approvedAt)).toBe(14 * DAY)
    await failsOn(recovery, RECOVERY_V2_ABI, STRANGER, 'executeRecovery', [id], 'DelayNotElapsed')
    // a proposal made in the meantime is fenced by the new epoch
    const pending = await propose('proposePayroll', [[{ to: who(R2), amount: USDC(1) }], await exp(14 * DAY), '0x' + '00'.repeat(32)])
    await raw('evm_setNextBlockTimestamp', [Number(executableAt)])
    await raw('evm_mine')
    await R('executeRecovery', [id], STRANGER) // permissionless once the delay has passed

    expect(await tr<bigint>('currentEpoch')).toBe(3n)
    expect(await tr<boolean>('isApprover', [who(N1)])).toBe(true)
    expect(await tr<boolean>('isApprover', [who(A1)])).toBe(false)
    expect(await tr<string>('guardian')).toBe(ZERO)
    expect(await rc<boolean>('isCouncilMember', [who(NC1)])).toBe(true)
    expect(await rc<boolean>('isCouncilMember', [who(C1)])).toBe(false)
    expect(await state(pending)).toBe(PSTATUS.Fenced)
    expect(await tr<bigint>('balance')).toBe(fundsBefore) // recovery moved no funds

    // 7 day cooling: payroll blocked, governance and deposits still work, keeper stands down
    const coolingEnd = await tr<bigint>('coolingEnd')
    expect(Number(coolingEnd - BigInt(await now()))).toBeGreaterThan(6 * DAY)
    const usdcAbi = artifact('V2MockUSDC.sol', 'V2MockUSDC').abi
    await send(DEPLOYER, token, usdcAbi, 'approve', [treasury, USDC(1)])
    await T('deposit', [USDC(1)], DEPLOYER)
    // expiry must outlive the 7 day cooling period, or the proposal expires before it can run
    const pay = await propose('proposePayroll', [[{ to: who(R2), amount: USDC(1) }], await exp(10 * DAY), '0x' + '00'.repeat(32)], N1)
    await T('approve', [pay], N2)
    await warp(301)
    expect(await failsWith(STRANGER, 'execute', [pay], 'SpendingCoolingOff')).toContain('blocked for 7 days')
    const keeper = viemKeeperClient(pub as never, wallet as never)
    const cfg: KeeperConfig = { treasury, module, keeper: who(KEEPER), maxSchedulesPerPoll: 10, maxScan: 100, retryMax: 1, retryBackoffMs: 1, receiptTimeoutMs: 30_000 }
    expect(await runOnce(keeper, cfg, () => {})).toEqual([])
    await raw('evm_setNextBlockTimestamp', [Number(coolingEnd)])
    await raw('evm_mine')
    await T('completeCooling', [], STRANGER)
    expect(await tr<bigint>('coolingEnd')).toBe(0n)
    const r2before = await bal(who(R2))
    await T('execute', [pay], STRANGER)
    expect((await bal(who(R2))) - r2before).toBe(USDC(1))

    // no repeat: the executed recovery reset the gate
    await failsOn(recovery, RECOVERY_V2_ABI, NC1, 'initiateRecovery', [newCfg(), NEW_COUNCIL(), 2], 'InactivityNotMet')
    // council rotation limit: there is no ordinary-governance path to replace the council
    const names = RECOVERY_V2_ABI.filter((x) => x.type === 'function').map((x) => x.name)
    expect(names.filter((n) => /council|rotate/i.test(n) && !/^(councilMembers|councilThreshold|isCouncilMember|councilVoted)$/.test(n))).toEqual([])
  }, 120_000)
})
