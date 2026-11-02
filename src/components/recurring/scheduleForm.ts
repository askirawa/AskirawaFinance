/** Recurring payment form: types, validation and the contract call it produces. */
import { useReadContract } from 'wagmi'
import { encodeAbiParameters, zeroAddress, type Address } from 'viem'
import { treasuryAbi } from '../../chain/abi'
import { RECURRING_MODULE_ADDRESS, TREASURY_ADDRESS, TREASURY_CHAIN_ID } from '../../chain/config'
import { scheduleParamsAbi } from '../../chain/decode'
import { memoRefFor } from '../../chain/addressBook'
import { usdc } from '../../chain/format'
import { checkAddress, parseAmount } from '../payroll/payrollRows'
import { dateInputToUnix, todayUtc, type FrequencyIndex } from './preview'

export interface ScheduleForm {
  recipientName: string
  address: string
  amount: string
  scheduleName: string
  frequency: FrequencyIndex
  startDate: string
  endDate: string
}

export const EMPTY_FORM: ScheduleForm = {
  recipientName: '', address: '', amount: '', scheduleName: '', frequency: 1, startDate: '', endDate: '',
}

const MAX_AHEAD_SECONDS = 360 * 86_400
const NAME_MAX = 60

export interface Budget {
  /** null while unknown (loading or unreadable). */
  enabled: boolean | null
  perTxMax: bigint | null
}

/** The per-payment limit the treasury applies to the recurring payments module, read from the contract. */
export function useModuleBudget(): Budget {
  const query = useReadContract({
    address: TREASURY_ADDRESS ?? zeroAddress,
    abi: treasuryAbi,
    functionName: 'modules',
    args: [RECURRING_MODULE_ADDRESS ?? zeroAddress],
    chainId: TREASURY_CHAIN_ID,
    query: { enabled: !!TREASURY_ADDRESS && !!RECURRING_MODULE_ADDRESS, refetchInterval: 30_000 },
  })
  if (!query.data) return { enabled: null, perTxMax: null }
  return { enabled: query.data[0], perTxMax: query.data[2] }
}

export interface ScheduleChecks {
  nameError?: string
  addressError?: string
  amountError?: string
  startError?: string
  endError?: string
  budgetError?: string
  recipient?: Address
  amountRaw?: bigint
  startTime?: number
  /** Last second of the chosen end date (UTC), or 0 for no end. */
  endTime: number
  step1: boolean
  step2: boolean
}

export function checkSchedule(f: ScheduleForm, budget: Budget): ScheduleChecks {
  const out: ScheduleChecks = { endTime: 0, step1: false, step2: false }
  if (f.recipientName.trim().length > NAME_MAX || f.scheduleName.trim().length > NAME_MAX) {
    out.nameError = `Keep names under ${NAME_MAX} characters.`
  }
  const a = checkAddress(f.address, [
    { address: TREASURY_ADDRESS, message: 'This is the treasury itself. Choose an outside wallet.' },
    { address: RECURRING_MODULE_ADDRESS, message: 'This is the recurring payments contract. Choose an outside wallet.' },
  ])
  if (a.error) out.addressError = a.error
  else out.recipient = a.address
  const m = parseAmount(f.amount)
  if (m.error) out.amountError = m.error
  else {
    out.amountRaw = m.value
    if (budget.perTxMax !== null && m.value! > budget.perTxMax) {
      out.amountError = `The treasury allows at most ${usdc(budget.perTxMax)} USDC per recurring payment.`
    }
  }
  if (budget.enabled === false) {
    out.budgetError = 'Recurring payments are switched off in this treasury\u2019s budget. Approvers must enable them before a schedule can be requested.'
  }
  const now = Math.floor(Date.now() / 1000)
  const start = dateInputToUnix(f.startDate)
  if (!f.startDate) out.startError = 'Choose a start date.'
  else if (start === null) out.startError = 'Enter a valid date.'
  else if (f.startDate < todayUtc()) out.startError = 'The start date is in the past (UTC).'
  else if (start > now + MAX_AHEAD_SECONDS) out.startError = 'The start date can be at most about a year ahead.'
  else out.startTime = start
  if (f.endDate) {
    const end = dateInputToUnix(f.endDate)
    if (end === null) out.endError = 'Enter a valid date.'
    else if (start !== null && end <= start) out.endError = 'The end date must be after the start date.'
    else out.endTime = end + 86_399
  }
  const nameOk = !out.nameError
  out.step1 = nameOk && !out.addressError && !out.amountError && !out.budgetError && !!out.recipient && out.amountRaw !== undefined
  out.step2 = out.startTime !== undefined && !out.endError
  return out
}

/** Exactly the arguments useTreasuryActions().proposeSchedule sends, for the dry run. */
export function scheduleCallArgs(checks: ScheduleChecks, frequency: FrequencyIndex, scheduleName: string, expiresAt: bigint) {
  const memoRef = memoRefFor(scheduleName)
  const data = encodeAbiParameters(scheduleParamsAbi, [{
    recipient: checks.recipient as Address,
    amount: checks.amountRaw as bigint,
    frequency,
    startTime: BigInt(checks.startTime as number),
    endTime: BigInt(checks.endTime),
    maxExecutions: 0,
    maxTotal: 0n,
    minTreasuryBalanceAfter: 0n,
    executor: zeroAddress,
    memoRef,
  }])
  return [RECURRING_MODULE_ADDRESS as Address, 1, data, 0n, expiresAt, memoRef] as const
}
