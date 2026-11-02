/**
 * Write actions. Each one is a real contract call through useTx (simulate, sign, wait for receipt, re-read state).
 * The app never records an approval or a payment itself; it only asks the contract and shows what the contract says.
 */
import { useCallback } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { encodeAbiParameters, erc20Abi, type Address } from 'viem'
import { recurringModuleAbi, treasuryAbi } from './abi'
import { NETWORK, RECURRING_MODULE_ADDRESS, TREASURY_ADDRESS, TREASURY_CHAIN_ID } from './config'
import { scheduleParamsAbi } from './decode'
import { useTx } from './useTx'

const treasury = TREASURY_ADDRESS as Address
const base = { address: treasury, abi: treasuryAbi } as const
const DAY = 86_400n
/** Contract bounds: execution window of at least 1 hour after the delay, lifetime at most 30 days. */
const MIN_WINDOW = 3_600n
const MAX_LIFETIME = 30n * DAY

export interface Payment { to: Address; amount: bigint }

export interface ScheduleInput {
  recipient: Address
  amount: bigint
  frequency: 0 | 1 | 2
  /** Unix seconds, UTC. The contract starts the schedule no earlier than approval time. */
  startTime: bigint
  /** 0n = no end date. */
  endTime: bigint
  memoRef: `0x${string}`
}

export function useTreasuryActions() {
  const tx = useTx()
  const { send } = tx
  const { address } = useAccount()
  const client = usePublicClient({ chainId: TREASURY_CHAIN_ID })

  /** Approval deadline: chain time + safety delay + a window for approvers (default 7 days, clamped to the contract's limits). */
  const deadline = useCallback(async (delaySeconds: number, windowDays = 7): Promise<bigint> => {
    const block = await client!.getBlock()
    const wanted = BigInt(windowDays) * DAY
    const minimum = BigInt(delaySeconds) + MIN_WINDOW + 60n
    const lifetime = wanted > minimum ? wanted : minimum
    return block.timestamp + (lifetime > MAX_LIFETIME - 60n ? MAX_LIFETIME - 60n : lifetime)
  }, [client])

  const vote = useCallback(async (id: number, approve: boolean) => {
    const fn = approve ? 'approve' : 'reject'
    return send({
      ...base, functionName: fn, args: [BigInt(id)],
      verify: async () => {
        const v = await client!.readContract({ ...base, functionName: 'voteOf', args: [BigInt(id), address!] })
        return Number(v) === (approve ? 1 : 2)
      },
    })
  }, [send, client, address])

  const execute = useCallback(async (id: number) => send({
    ...base, functionName: 'execute', args: [BigInt(id)],
    verify: async () => Number(await client!.readContract({ ...base, functionName: 'status', args: [BigInt(id)] })) === 4,
  }), [send, client])

  const cancel = useCallback(async (id: number) => send({
    ...base, functionName: 'cancel', args: [BigInt(id)],
    verify: async () => Number(await client!.readContract({ ...base, functionName: 'status', args: [BigInt(id)] })) === 5,
  }), [send, client])

  const proposePayroll = useCallback(async (payments: Payment[], payrollDelay: number, memoRef: `0x${string}`) => {
    const expiresAt = await deadline(payrollDelay)
    return send({
      ...base, functionName: 'proposePayroll',
      args: [payments.map((p) => ({ to: p.to, amount: p.amount })), expiresAt, memoRef],
    })
  }, [send, deadline])

  const proposeSchedule = useCallback(async (input: ScheduleInput, payrollDelay: number) => {
    if (!RECURRING_MODULE_ADDRESS) throw new Error('Recurring payments are not set up for this treasury.')
    const data = encodeAbiParameters(scheduleParamsAbi, [{
      recipient: input.recipient, amount: input.amount, frequency: input.frequency,
      startTime: input.startTime, endTime: input.endTime, maxExecutions: 0, maxTotal: 0n,
      minTreasuryBalanceAfter: 0n, executor: '0x0000000000000000000000000000000000000000', memoRef: input.memoRef,
    }])
    const expiresAt = await deadline(payrollDelay)
    return send({
      ...base, functionName: 'proposeModuleAction',
      args: [RECURRING_MODULE_ADDRESS, 1, data, 0n, expiresAt, input.memoRef],
    })
  }, [send, deadline])

  /** Ask approvers to restart a paused schedule. `skipMissed` decides whether missed periods are paid or skipped. */
  const proposeResume = useCallback(async (scheduleId: number, skipMissed: boolean, payrollDelay: number) => {
    if (!RECURRING_MODULE_ADDRESS) throw new Error('Recurring payments are not set up for this treasury.')
    const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }], [BigInt(scheduleId), skipMissed])
    const expiresAt = await deadline(payrollDelay)
    return send({
      ...base, functionName: 'proposeModuleAction',
      args: [RECURRING_MODULE_ADDRESS, 2, data, 0n, expiresAt, ('0x' + '00'.repeat(32))],
    })
  }, [send, deadline])

  /** Add funds: exact-amount USDC allowance first (only if needed), then deposit. Two wallet confirmations. */
  const deposit = useCallback(async (amount: bigint) => {
    const allowance = await client!.readContract({
      address: NETWORK.usdcAddress, abi: erc20Abi, functionName: 'allowance', args: [address!, treasury],
    })
    if (allowance < amount) {
      const approved = await send({
        address: NETWORK.usdcAddress, abi: erc20Abi, functionName: 'approve', args: [treasury, amount],
        verify: async () => (await client!.readContract({
          address: NETWORK.usdcAddress, abi: erc20Abi, functionName: 'allowance', args: [address!, treasury],
        })) >= amount,
      })
      if (approved.phase !== 'confirmed') return approved
    }
    return send({ ...base, functionName: 'deposit', args: [amount] })
  }, [send, client, address])

  const moduleCall = useCallback(async (fn: 'execute' | 'pause' | 'cancel', scheduleId: number, expectStatus?: number) => {
    const moduleBase = { address: RECURRING_MODULE_ADDRESS as Address, abi: recurringModuleAbi } as const
    return send({
      ...moduleBase, functionName: fn, args: [BigInt(scheduleId)],
      verify: expectStatus === undefined ? undefined : async () => {
        const s = await client!.readContract({ ...moduleBase, functionName: 'getSchedule', args: [BigInt(scheduleId)] })
        return Number(s.status) === expectStatus
      },
    })
  }, [send, client])

  return { tx, vote, execute, cancel, proposePayroll, proposeSchedule, proposeResume, deposit, moduleCall }
}
