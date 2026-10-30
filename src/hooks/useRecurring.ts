/**
 * useRecurring — manages recurring payment schedule state and manual execution.
 *
 * Persistence: localStorage (browser-local, clearly labeled in the UI).
 * Execution: manual, wallet-signed USDC ERC-20 transfer().
 *
 * Automated execution requires a keeper service — not yet deployed.
 * Notification and audit callbacks are injected by callers to avoid circular deps.
 */

import { useState, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi'
import { erc20Abi } from 'viem'
import {
  type RecurringSchedule,
  type Frequency,
  type ExecutionRecord,
  loadSchedules,
  saveSchedules,
  upsertSchedule,
  generateId,
  parseUsdcString,
  formatUsdcBigint,
  nextExecutionDate,
  USDC_DECIMALS,
} from '../lib/recurring'
import { Notify, type AppNotification } from '../lib/notifications'
import { logAuditEvent, type AuditEntry } from '../lib/audit'
import { getUsdc } from '../onchain-facts'
import { ARC_MAINNET_CHAIN_ID } from '../config'
import { usdcDecimalsFor } from '../onchain-money'

const CHAIN_ID = ARC_MAINNET_CHAIN_ID

export type NotifyFn = (n: AppNotification) => void
export type AuditFn = (fields: Omit<AuditEntry, 'id' | 'timestamp'>) => void

// ─── useRecurringSchedules ────────────────────────────────────────────────────

export function useRecurringSchedules(opts?: { onNotify?: NotifyFn; actorAddress?: string }) {
  const { address } = useAccount()
  const [schedules, setSchedules] = useState<RecurringSchedule[]>(() => loadSchedules())

  const saveSchedule = useCallback((schedule: RecurringSchedule) => {
    setSchedules(prev => {
      const next = upsertSchedule(prev, schedule)
      saveSchedules(next)
      return next
    })
  }, [])

  const deleteSchedule = useCallback((id: string) => {
    setSchedules(prev => {
      const next = prev.filter(s => s.id !== id)
      saveSchedules(next)
      return next
    })
  }, [])

  const createSchedule = useCallback(
    (params: {
      name: string
      recipientAddress: string
      amountUsdc: string
      frequency: Frequency
      startDate: string
      startTime: string
      endDate?: string
      maxExecutions?: number
      description: string
    }): RecurringSchedule => {
      const schedule: RecurringSchedule = {
        id: generateId(),
        name: params.name,
        recipientAddress: params.recipientAddress,
        amountUsdc: params.amountUsdc,
        frequency: params.frequency,
        startDate: params.startDate,
        startTime: params.startTime,
        endDate: params.endDate,
        maxExecutions: params.maxExecutions,
        description: params.description,
        status: 'active',
        createdAt: Date.now(),
        createdBy: address,
        executionHistory: [],
      }
      saveSchedule(schedule)

      const n = Notify.recurringCreated(schedule.id, schedule.name)
      opts?.onNotify?.(n)
      logAuditEvent({
        category: 'recurring',
        action: 'recurring_schedule_created',
        actorAddress: opts?.actorAddress ?? address ?? null,
        description: `Recurring schedule "${schedule.name}" created: ${schedule.frequency} payments of ${schedule.amountUsdc} USDC.`,
        outcome: 'success',
        entityId: schedule.id,
        entityLabel: schedule.name,
      })

      return schedule
    },
    [address, saveSchedule, opts]
  )

  const pauseSchedule = useCallback(
    (id: string) => {
      setSchedules(prev => {
        const s = prev.find(x => x.id === id)
        if (!s || s.status !== 'active') return prev
        const updated: RecurringSchedule = { ...s, status: 'paused', pausedAt: Date.now() }
        const next = upsertSchedule(prev, updated)
        saveSchedules(next)

        const n = Notify.recurringPaused(s.id, s.name)
        opts?.onNotify?.(n)
        logAuditEvent({
          category: 'recurring',
          action: 'recurring_schedule_paused',
          actorAddress: opts?.actorAddress ?? null,
          description: `Recurring schedule "${s.name}" paused.`,
          outcome: 'info',
          entityId: s.id,
          entityLabel: s.name,
        })

        return next
      })
    },
    [opts]
  )

  const resumeSchedule = useCallback(
    (id: string) => {
      setSchedules(prev => {
        const s = prev.find(x => x.id === id)
        if (!s || s.status !== 'paused') return prev
        const updated: RecurringSchedule = { ...s, status: 'active', pausedAt: undefined }
        const next = upsertSchedule(prev, updated)
        saveSchedules(next)

        const n = Notify.recurringResumed(s.id, s.name)
        opts?.onNotify?.(n)
        logAuditEvent({
          category: 'recurring',
          action: 'recurring_schedule_resumed',
          actorAddress: opts?.actorAddress ?? null,
          description: `Recurring schedule "${s.name}" resumed.`,
          outcome: 'info',
          entityId: s.id,
          entityLabel: s.name,
        })

        return next
      })
    },
    [opts]
  )

  const cancelSchedule = useCallback(
    (id: string) => {
      setSchedules(prev => {
        const s = prev.find(x => x.id === id)
        if (!s || s.status === 'cancelled' || s.status === 'completed') return prev
        const updated: RecurringSchedule = { ...s, status: 'cancelled', cancelledAt: Date.now() }
        const next = upsertSchedule(prev, updated)
        saveSchedules(next)

        const n = Notify.recurringCancelled(s.id, s.name)
        opts?.onNotify?.(n)
        logAuditEvent({
          category: 'recurring',
          action: 'recurring_schedule_cancelled',
          actorAddress: opts?.actorAddress ?? null,
          description: `Recurring schedule "${s.name}" cancelled.`,
          outcome: 'info',
          entityId: s.id,
          entityLabel: s.name,
        })

        return next
      })
    },
    [opts]
  )

  return {
    schedules,
    saveSchedule,
    deleteSchedule,
    createSchedule,
    pauseSchedule,
    resumeSchedule,
    cancelSchedule,
  }
}

// ─── useUsdcBalance (recurring) ───────────────────────────────────────────────

export function useUsdcBalance() {
  const { address } = useAccount()
  const usdcFact = getUsdc(CHAIN_ID)

  const { data, isLoading, error, refetch } = useReadContract({
    address: usdcFact?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!usdcFact },
  })

  const rawBalance: bigint = typeof data === 'bigint' ? data : 0n
  const decimals = usdcDecimalsFor(CHAIN_ID)
  const formatted = rawBalance > 0n
    ? (() => {
        const divisor = BigInt(10 ** decimals)
        const whole = rawBalance / divisor
        const frac = rawBalance % divisor
        const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2)
        return `${Number(whole).toLocaleString('en-US')}.${fracStr}`
      })()
    : null

  return { rawBalance, formatted, isLoading, error, refetch }
}

// ─── useRecurringStats ────────────────────────────────────────────────────────

export function useRecurringStats(schedules: RecurringSchedule[]) {
  const total = schedules.length
  const active = schedules.filter(s => s.status === 'active').length
  const paused = schedules.filter(s => s.status === 'paused').length
  const completed = schedules.filter(s => s.status === 'completed').length
  const cancelled = schedules.filter(s => s.status === 'cancelled' || s.status === 'failed').length

  const allExecs = schedules.flatMap(s => s.executionHistory)
  const confirmedExecs = allExecs.filter(e => e.status === 'confirmed').length
  const pendingExecs = schedules
    .filter(s => s.status === 'active')
    .filter(s => nextExecutionDate(s) !== null).length
  const failedExecs = allExecs.filter(e => e.status === 'failed').length

  const totalConfirmedRaw = allExecs
    .filter(e => e.status === 'confirmed')
    .reduce((acc, e) => {
      try { return acc + parseUsdcString(e.amountUsdc) } catch { return acc }
    }, 0n)

  const monthlyActiveRaw = schedules
    .filter(s => s.status === 'active' && s.frequency === 'monthly')
    .reduce((acc, s) => {
      try { return acc + parseUsdcString(s.amountUsdc) } catch { return acc }
    }, 0n)

  return {
    total,
    active,
    paused,
    completed,
    cancelled,
    confirmedExecs,
    pendingExecs,
    failedExecs,
    totalConfirmedRaw,
    totalConfirmedFormatted: formatUsdcBigint(totalConfirmedRaw),
    monthlyActiveRaw,
    monthlyActiveFormatted: formatUsdcBigint(monthlyActiveRaw),
  }
}

// ─── useScheduleRunner ────────────────────────────────────────────────────────

/** Turns a raw wallet/network error into a short plain-English message. */
function describeTxError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('insufficient funds') || m.includes('exceeds balance') || m.includes('transfer amount exceeds')) {
    return 'Your wallet does not have enough USDC to cover this payment. Add USDC and try again.'
  }
  if (m.includes('reverted') || m.includes('revert')) {
    return 'The network rejected the transaction. Check your balance and the recipient details, then try again.'
  }
  if (m.includes('chain') && (m.includes('mismatch') || m.includes('switch'))) {
    return 'Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'
  }
  if (raw.length > 140 || raw.includes('\n')) {
    return 'The payment could not be completed. Check your wallet and try again.'
  }
  return raw
}

export function useScheduleRunner(
  schedule: RecurringSchedule | null,
  onScheduleUpdate: (updated: RecurringSchedule) => void,
  opts?: { onNotify?: NotifyFn; actorAddress?: string }
) {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { rawBalance } = useUsdcBalance()
  const [isExecuting, setIsExecuting] = useState(false)
  const [execError, setExecError] = useState<string | null>(null)

  const usdcFact = getUsdc(CHAIN_ID)
  const { writeContractAsync } = useWriteContract()

  const isWrongChain = chainId !== CHAIN_ID

  function canExecute(): { ok: boolean; reason?: string } {
    if (!address) return { ok: false, reason: 'Your wallet is not connected. Connect it and try again.' }
    if (isWrongChain) return { ok: false, reason: 'Your wallet is on the wrong network. Switch to Arc Mainnet and try again.' }
    if (!schedule || schedule.status !== 'active') {
      return { ok: false, reason: 'This schedule is not active. Resume it to send payments.' }
    }
    try {
      const raw = parseUsdcString(schedule.amountUsdc)
      if (rawBalance < raw) {
        return {
          ok: false,
          reason: `Your wallet does not have enough USDC. You need ${(Number(raw) / 10 ** USDC_DECIMALS).toFixed(2)} USDC. Add USDC and try again.`,
        }
      }
    } catch {
      return { ok: false, reason: 'The payment amount on this schedule is not valid. Cancel it and create a new schedule.' }
    }
    const alreadyProcessing = schedule.executionHistory.some(e => e.status === 'processing')
    if (alreadyProcessing) return { ok: false, reason: 'A payment is already being sent. Wait for it to finish.' }
    return { ok: true }
  }

  async function executeNow(scheduledForMs?: number) {
    if (!schedule || !address || !usdcFact || !publicClient) return
    const { ok, reason } = canExecute()
    if (!ok) { setExecError(reason ?? 'The payment cannot be sent right now. Try again.'); return }

    setIsExecuting(true)
    setExecError(null)

    const execId = generateId()
    const now = Date.now()

    const processingRecord: ExecutionRecord = {
      id: execId,
      scheduledFor: scheduledForMs ?? now,
      executedAt: now,
      status: 'processing',
      amountUsdc: schedule.amountUsdc,
    }

    let workingSchedule: RecurringSchedule = {
      ...schedule,
      executionHistory: [...schedule.executionHistory, processingRecord],
    }
    onScheduleUpdate(workingSchedule)

    try {
      const rawAmount = parseUsdcString(schedule.amountUsdc)
      const hash = await writeContractAsync({
        address: usdcFact.address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [schedule.recipientAddress as `0x${string}`, rawAmount],
        chainId: CHAIN_ID,
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      const succeeded = receipt.status === 'success'

      const confirmedRecord: ExecutionRecord = {
        ...processingRecord,
        status: succeeded ? 'confirmed' : 'failed',
        txHash: hash,
        executedAt: Date.now(),
        errorMessage: succeeded ? undefined : 'The network rejected this payment. Try again.',
      }

      const updatedHistory = workingSchedule.executionHistory.map(e =>
        e.id === execId ? confirmedRecord : e
      )

      const confirmedCount = updatedHistory.filter(e => e.status === 'confirmed').length
      const isNowComplete =
        schedule.maxExecutions != null && confirmedCount >= schedule.maxExecutions

      workingSchedule = {
        ...workingSchedule,
        executionHistory: updatedHistory,
        status: isNowComplete ? 'completed' : workingSchedule.status,
        completedAt: isNowComplete ? Date.now() : undefined,
      }
      onScheduleUpdate(workingSchedule)

      // Emit at the receipt boundary only
      if (succeeded) {
        const n = Notify.recurringExecutionConfirmed(schedule.id, schedule.name, schedule.amountUsdc, hash)
        opts?.onNotify?.(n)
        logAuditEvent({
          category: 'recurring',
          action: 'recurring_execution_confirmed',
          actorAddress: opts?.actorAddress ?? address ?? null,
          description: `Recurring payment "${schedule.name}" confirmed: ${schedule.amountUsdc} USDC to ${schedule.recipientAddress.slice(0, 8)}…`,
          outcome: 'success',
          entityId: schedule.id,
          entityLabel: schedule.name,
          txHash: hash,
          meta: { recipient: schedule.recipientAddress, amount: schedule.amountUsdc },
        })
      } else {
        const n = Notify.recurringExecutionFailed(schedule.id, schedule.name, 'The network rejected this payment. Try again.')
        opts?.onNotify?.(n)
        logAuditEvent({
          category: 'recurring',
          action: 'recurring_execution_failed',
          actorAddress: opts?.actorAddress ?? address ?? null,
          description: `Recurring payment "${schedule.name}" was rejected by the network.`,
          outcome: 'failure',
          entityId: schedule.id,
          entityLabel: schedule.name,
          txHash: hash,
        })
      }
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string }
      const rawMsg = e?.shortMessage || e?.message || ''
      const isRejection =
        rawMsg.toLowerCase().includes('user rejected') || rawMsg.toLowerCase().includes('user denied')
      const msg = describeTxError(rawMsg || 'The payment could not be sent. Try again.')

      const failedRecord: ExecutionRecord = {
        ...processingRecord,
        status: isRejection ? 'skipped' : 'failed',
        executedAt: Date.now(),
        errorMessage: isRejection ? 'Transaction cancelled. Nothing was sent.' : msg,
      }

      workingSchedule = {
        ...workingSchedule,
        executionHistory: workingSchedule.executionHistory.map(e =>
          e.id === execId ? failedRecord : e
        ),
      }
      onScheduleUpdate(workingSchedule)

      if (!isRejection) {
        const n = Notify.recurringExecutionFailed(schedule.id, schedule.name, msg)
        opts?.onNotify?.(n)
        logAuditEvent({
          category: 'recurring',
          action: 'recurring_execution_failed',
          actorAddress: opts?.actorAddress ?? address ?? null,
          description: `Recurring payment "${schedule.name}" failed: ${msg}`,
          outcome: 'failure',
          entityId: schedule.id,
          entityLabel: schedule.name,
        })
        setExecError(msg)
      } else {
        setExecError('Transaction cancelled. Nothing was sent.')
      }
    } finally {
      setIsExecuting(false)
    }
  }

  return { executeNow, isExecuting, execError, canExecute, isWrongChain }
}
