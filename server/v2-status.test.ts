import { describe, expect, test } from 'bun:test'
import { UserRejectedRequestError, encodeAbiParameters, parseAbiParameters, type Address, type Hex } from 'viem'
import { ACTION, PSTATUS, canCancel, canVote, countdownLabel, decodePayload, describeError, formatDuration, type ProposalCore, type Viewer } from '../src/lib/v2/status'
import { bytes32ToMemo, memoToBytes32 } from '../src/lib/v2/memo'

const A = '0x1000000000000000000000000000000000000001' as Address
const B = '0x2000000000000000000000000000000000000002' as Address
const base: ProposalCore = {
  action: ACTION.Payroll, status: 1, epoch: 1n, quorum: 2, proposer: A, createdAt: 0n, approvedAt: 0n,
  executableAt: 2000n, expiresAt: 5000n, approvals: 1, rejections: 0, totalAmount: 0n, payloadHash: '0x00', memoRef: '0x00',
}
const viewer = (o: Partial<Viewer>): Viewer => ({ isApprover: false, isProposer: false, isGuardian: false, address: B, ...o })

describe('proposal permissions', () => {
  test('only approvers who have not voted, in the current epoch, on pending proposals can vote', () => {
    expect(canVote(base, PSTATUS.Pending, viewer({ isApprover: true }), 0, 1n)).toBe(true)
    expect(canVote(base, PSTATUS.Pending, viewer({ isApprover: true }), 1, 1n)).toBe(false)
    expect(canVote(base, PSTATUS.Pending, viewer({ isApprover: false, isProposer: true }), 0, 1n)).toBe(false)
    expect(canVote(base, PSTATUS.Pending, viewer({ isApprover: true }), 0, 2n)).toBe(false)
    expect(canVote(base, PSTATUS.Approved, viewer({ isApprover: true }), 0, 1n)).toBe(false)
    expect(canVote(base, PSTATUS.Executed, viewer({ isApprover: true }), 0, 1n)).toBe(false)
  })
  test('proposer may cancel own live proposal; guardian may not cancel governance or unpause', () => {
    expect(canCancel(base, PSTATUS.Pending, viewer({ address: A }))).toBe(true)
    expect(canCancel(base, PSTATUS.Executed, viewer({ address: A }))).toBe(false)
    expect(canCancel(base, PSTATUS.Pending, viewer({ isGuardian: true }))).toBe(true)
    expect(canCancel({ ...base, action: ACTION.Governance }, PSTATUS.Pending, viewer({ isGuardian: true }))).toBe(false)
    expect(canCancel({ ...base, action: ACTION.Unpause }, PSTATUS.Pending, viewer({ isGuardian: true }))).toBe(false)
    expect(canCancel(base, PSTATUS.Pending, viewer({}))).toBe(false)
  })
})

describe('payload decoding', () => {
  test('governance', () => {
    const data = encodeAbiParameters(parseAbiParameters('(address[] approvers, address[] proposers, uint8 quorum, address guardian, uint32 payrollDelay, uint32 configDelay) c'),
      [{ approvers: [A, B], proposers: [], quorum: 2, guardian: A, payrollDelay: 300, configDelay: 3600 }])
    const d = decodePayload(ACTION.Governance, data)
    expect(d.kind === 'governance' && d.config.quorum).toBe(2)
  })
  test('module config, rescue, unpause and garbage', () => {
    const mc = encodeAbiParameters(parseAbiParameters('(address module, bool enabled, uint96 perTxMax, uint96 windowMax, uint32 windowLength) c'), [{ module: A, enabled: true, perTxMax: 5n, windowMax: 9n, windowLength: 60 }])
    const d = decodePayload(ACTION.ModuleConfig, mc)
    expect(d.kind === 'moduleConfig' && d.windowMax).toBe(9n)
    const un = encodeAbiParameters(parseAbiParameters('(bool unpause, uint64 pauseCount) c'), [{ unpause: true, pauseCount: 3n }])
    const u = decodePayload(ACTION.Unpause, un)
    expect(u.kind === 'unpause' && u.pauseCount).toBe(3n)
    expect(decodePayload(ACTION.Rescue, '0x12' as Hex).kind).toBe('unknown')
  })
})

describe('formatting and errors', () => {
  test('durations', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(3700)).toBe('1h 1m')
    expect(formatDuration(90000)).toBe('1d 1h')
    expect(formatDuration(-5)).toBe('0s')
  })
  test('countdown labels follow the derived state', () => {
    expect(countdownLabel(base, PSTATUS.Approved, 1000)).toBe('Executable in 16m 40s')
    expect(countdownLabel(base, PSTATUS.Executed, 1000)).toBeNull()
  })
  test('wallet rejection is explained', () => {
    expect(describeError(new UserRejectedRequestError(new Error('no')))).toContain('rejected')
    expect(describeError(new Error('boom'))).toBe('boom')
  })
  test('memo round trip', () => {
    expect(bytes32ToMemo(memoToBytes32('payroll-oct'))).toBe('payroll-oct')
    expect(bytes32ToMemo(memoToBytes32(''))).toBeNull()
    expect(bytes32ToMemo(memoToBytes32('x'.repeat(80)))).toBeNull()
  })
})
