/** Decoders for proposal payloads that the treasury stores on-chain as ABI-encoded bytes. */
import { decodeAbiParameters, type Address, type Hex } from 'viem'

export interface ScheduleTerms {
  recipient: Address
  amount: bigint
  frequency: number
  startTime: bigint
  endTime: bigint
  maxExecutions: number
  maxTotal: bigint
  minTreasuryBalanceAfter: bigint
  executor: Address
  memoRef: Hex
}

export interface ModuleActionView {
  module: Address
  actionCode: number
  fundingAmount: bigint
  /** Present only for "create schedule" (action code 1). */
  schedule?: ScheduleTerms
  /** Present only for "resume schedule" (action code 2). */
  resume?: { scheduleId: bigint; skipMissed: boolean }
}

const moduleActionAbi = [
  {
    type: 'tuple',
    components: [
      { name: 'module', type: 'address' },
      { name: 'actionCode', type: 'uint8' },
      { name: 'data', type: 'bytes' },
      { name: 'fundingAmount', type: 'uint96' },
    ],
  },
] as const

export const scheduleParamsAbi = [
  {
    type: 'tuple',
    components: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint96' },
      { name: 'frequency', type: 'uint8' },
      { name: 'startTime', type: 'uint64' },
      { name: 'endTime', type: 'uint64' },
      { name: 'maxExecutions', type: 'uint32' },
      { name: 'maxTotal', type: 'uint96' },
      { name: 'minTreasuryBalanceAfter', type: 'uint96' },
      { name: 'executor', type: 'address' },
      { name: 'memoRef', type: 'bytes32' },
    ],
  },
] as const

/** Returns null when the bytes do not decode, so the UI can say "details unavailable" instead of guessing. */
export function decodeModuleAction(payload: Hex): ModuleActionView | null {
  try {
    const [action] = decodeAbiParameters(moduleActionAbi, payload)
    const view: ModuleActionView = {
      module: action.module,
      actionCode: action.actionCode,
      fundingAmount: action.fundingAmount,
    }
    if (action.actionCode === 1) {
      const [terms] = decodeAbiParameters(scheduleParamsAbi, action.data)
      view.schedule = { ...terms }
    } else if (action.actionCode === 2) {
      const [scheduleId, skipMissed] = decodeAbiParameters(
        [{ type: 'uint256' }, { type: 'bool' }],
        action.data,
      )
      view.resume = { scheduleId, skipMissed }
    }
    return view
  } catch {
    return null
  }
}
