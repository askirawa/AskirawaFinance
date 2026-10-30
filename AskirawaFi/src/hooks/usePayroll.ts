/**
 * usePayroll — manages payroll batch state and execution.
 *
 * Persistence: localStorage (browser-local, not on-chain).
 * Execution: sequential individual USDC ERC-20 `transfer()` calls via writeContractAsync.
 *
 * Notification and audit callbacks are optional parameters so hooks remain
 * pure — they do not import React context directly, avoiding circular deps.
 */

import { useState, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi'
import { erc20Abi } from 'viem'
import {
  type PayrollBatch,
  type EmployeeEntry,
  type ScheduleType,
  type BatchStatus,
  loadBatches,
  saveBatches,
  upsertBatch,
  generateId,
  parseUsdcString,
  sumBatchAmounts,
  deriveBatchStatus,
  USDC_DECIMALS,
} from '../lib/payroll'
import { Notify, type AppNotification } from '../lib/notifications'
import { logAuditEvent, type AuditEntry } from '../lib/audit'
import { getUsdc } from '../onchain-facts'
import { ARC_MAINNET_CHAIN_ID } from '../config'
import { Amount, usdcDecimalsFor } from '../onchain-money'

const CHAIN_ID = ARC_MAINNET_CHAIN_ID

// ─── Callback types ───────────────────────────────────────────────────────────

export type NotifyFn = (n: AppNotification) => void
export type AuditFn = (fields: Omit<AuditEntry, 'id' | 'timestamp'>) => void

// ─── usePayrollBatches — load/save/manage all batches ─────────────────────────

export function usePayrollBatches(opts?: { onNotify?: NotifyFn; onAudit?: AuditFn }) {
  const [batches, setBatches] = useState<PayrollBatch[]>(() => loadBatches())

  const saveBatch = useCallback((batch: PayrollBatch) => {
    setBatches(prev => {
      const next = upsertBatch(prev, batch)
      saveBatches(next)
      return next
    })
  }, [])

  const deleteBatch = useCallback((id: string) => {
    setBatches(prev => {
      const next = prev.filter(b => b.id !== id)
      saveBatches(next)
      return next
    })
  }, [])

  const createDraft = useCallback(
    (params: {
      name: string
      entries: EmployeeEntry[]
      scheduleType: ScheduleType
      scheduledDate?: string
      note: string
      createdBy?: string
    }): PayrollBatch => {
      const batch: PayrollBatch = {
        id: generateId(),
        name: params.name,
        scheduleType: params.scheduleType,
        scheduledDate: params.scheduledDate,
        createdAt: Date.now(),
        createdBy: params.createdBy,
        status: 'ready',
        note: params.note,
        payments: params.entries.map(e => ({
          ...e,
          status: 'pending',
        })),
      }
      saveBatch(batch)

      // Emit notification + audit at the action boundary
      const notif = Notify.payrollBatchCreated(batch.id, batch.name)
      opts?.onNotify?.(notif)
      logAuditEvent({
        category: 'payroll',
        action: 'payroll_batch_created',
        actorAddress: params.createdBy ?? null,
        description: `Payroll batch "${batch.name}" created with ${batch.payments.length} employees.`,
        outcome: 'success',
        entityId: batch.id,
        entityLabel: batch.name,
      })
      opts?.onAudit?.({
        category: 'payroll',
        action: 'payroll_batch_created',
        actorAddress: params.createdBy ?? null,
        description: `Payroll batch "${batch.name}" created with ${batch.payments.length} employees.`,
        outcome: 'success',
        entityId: batch.id,
        entityLabel: batch.name,
      })

      return batch
    },
    [saveBatch, opts]
  )

  return { batches, saveBatch, deleteBatch, createDraft }
}

// ─── useUsdcBalance — reads USDC ERC-20 balance for the connected wallet ───────

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

  const formatted = data != null
    ? Amount.fromRaw(data, usdcDecimalsFor(CHAIN_ID)).toFixed(2)
    : null

  const rawBalance: bigint = typeof data === 'bigint' ? data : 0n

  return { rawBalance, formatted, isLoading, error, refetch }
}

// ─── useSingleUsdcTransfer — sends one USDC transfer and waits for receipt ─────

export function useSingleUsdcTransfer() {
  const usdcFact = getUsdc(CHAIN_ID)
  const { writeContractAsync } = useWriteContract()

  async function sendTransfer(to: `0x${string}`, amountUsdc: string): Promise<`0x${string}`> {
    if (!usdcFact) throw new Error('USDC not configured for Arc Mainnet')
    const raw = parseUsdcString(amountUsdc)
    const hash = await writeContractAsync({
      address: usdcFact.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, raw],
      chainId: CHAIN_ID,
    })
    return hash
  }

  return { sendTransfer }
}

// ─── usePayrollStats — aggregate stats for all batches ───────────────────────

export function usePayrollStats(batches: PayrollBatch[]) {
  const totalBatches = batches.length
  const completedBatches = batches.filter(b => b.status === 'completed').length
  const processingBatches = batches.filter(b => b.status === 'processing').length
  const failedBatches = batches.filter(b => b.status === 'failed' || b.status === 'partial').length
  const draftBatches = batches.filter(b => b.status === 'draft' || b.status === 'ready').length

  const allPayments = batches.flatMap(b => b.payments)
  const totalPayments = allPayments.length
  const confirmedPayments = allPayments.filter(p => p.status === 'confirmed').length
  const pendingPayments = allPayments.filter(p => p.status === 'pending').length
  const failedPayments = allPayments.filter(p => p.status === 'failed').length

  const uniqueRecipients = new Set(allPayments.map(p => p.walletAddress.toLowerCase())).size

  const totalConfirmedRaw = allPayments
    .filter(p => p.status === 'confirmed')
    .reduce((acc, p) => {
      try { return acc + parseUsdcString(p.amountUsdc) } catch { return acc }
    }, 0n)

  const totalAllRaw = allPayments.reduce((acc, p) => {
    try { return acc + parseUsdcString(p.amountUsdc) } catch { return acc }
  }, 0n)

  return {
    totalBatches,
    completedBatches,
    processingBatches,
    failedBatches,
    draftBatches,
    totalPayments,
    confirmedPayments,
    pendingPayments,
    failedPayments,
    uniqueRecipients,
    totalConfirmedRaw,
    totalAllRaw,
  }
}

// ─── useBatchRunner — orchestrates multi-step execution for one batch ─────────

export function useBatchRunner(
  batch: PayrollBatch | null,
  onBatchUpdate: (updated: PayrollBatch) => void,
  opts?: { onNotify?: NotifyFn; actorAddress?: string }
) {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { rawBalance } = useUsdcBalance()
  const [isRunning, setIsRunning] = useState(false)
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const usdcFact = getUsdc(CHAIN_ID)
  const { writeContractAsync } = useWriteContract()

  const isWrongChain = chainId !== CHAIN_ID

  const pendingPayments = batch?.payments.filter(p => p.status === 'pending') ?? []
  const batchTotal = batch ? sumBatchAmounts(batch.payments.filter(p => p.status === 'pending')) : 0n

  function canExecute(): { ok: boolean; reason?: string } {
    if (!address) return { ok: false, reason: 'Connect your wallet first.' }
    if (isWrongChain) return { ok: false, reason: 'Switch to Arc Mainnet.' }
    if (!batch || pendingPayments.length === 0) return { ok: false, reason: 'No pending payments.' }
    if (rawBalance < batchTotal) {
      return {
        ok: false,
        reason: `Insufficient USDC. Need ${(Number(batchTotal) / 10 ** USDC_DECIMALS).toFixed(2)} USDC.`,
      }
    }
    return { ok: true }
  }

  async function runBatch() {
    if (!batch || !address || !usdcFact || !publicClient) return
    const { ok, reason } = canExecute()
    if (!ok) { setRunError(reason ?? 'Cannot execute.'); return }

    setIsRunning(true)
    setRunError(null)

    let workingBatch: PayrollBatch = {
      ...batch,
      status: 'processing',
      submittedAt: Date.now(),
      payments: batch.payments.map(p => ({ ...p })),
    }
    onBatchUpdate(workingBatch)

    // Log audit: execution started
    logAuditEvent({
      category: 'payroll',
      action: 'payroll_batch_executed',
      actorAddress: opts?.actorAddress ?? address ?? null,
      description: `Payroll batch "${batch.name}" execution started (${pendingPayments.length} payments).`,
      outcome: 'pending',
      entityId: batch.id,
      entityLabel: batch.name,
    })

    const pendingIndices = workingBatch.payments
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.status === 'pending')

    for (const { p, i } of pendingIndices) {
      setCurrentIndex(i)

      workingBatch = {
        ...workingBatch,
        payments: workingBatch.payments.map((pay, idx) =>
          idx === i ? { ...pay, status: 'processing' } : pay
        ),
      }
      onBatchUpdate(workingBatch)

      try {
        const rawAmount = parseUsdcString(p.amountUsdc)
        const hash = await writeContractAsync({
          address: usdcFact.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [p.walletAddress as `0x${string}`, rawAmount],
          chainId: CHAIN_ID,
        })

        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        const succeeded = receipt.status === 'success'

        workingBatch = {
          ...workingBatch,
          payments: workingBatch.payments.map((pay, idx) =>
            idx === i
              ? {
                  ...pay,
                  status: succeeded ? 'confirmed' : 'failed',
                  txHash: hash,
                  confirmedAt: succeeded ? Date.now() : undefined,
                  errorMessage: succeeded ? undefined : 'Transaction reverted on-chain.',
                }
              : pay
          ),
        }
        onBatchUpdate(workingBatch)

        // Per-payment notification + audit at the receipt boundary
        if (succeeded) {
          const n = Notify.payrollPaymentConfirmed(batch.id, batch.name, p.name, hash)
          opts?.onNotify?.(n)
          logAuditEvent({
            category: 'payroll',
            action: 'payroll_payment_confirmed',
            actorAddress: opts?.actorAddress ?? address ?? null,
            description: `Payment to ${p.name} (${p.walletAddress.slice(0, 8)}…) confirmed. Amount: ${p.amountUsdc} USDC.`,
            outcome: 'success',
            entityId: batch.id,
            entityLabel: batch.name,
            txHash: hash,
            meta: { recipient: p.walletAddress, amount: p.amountUsdc },
          })
        } else {
          const n = Notify.payrollPaymentFailed(batch.id, batch.name, p.name, 'Transaction reverted on-chain.')
          opts?.onNotify?.(n)
          logAuditEvent({
            category: 'payroll',
            action: 'payroll_payment_failed',
            actorAddress: opts?.actorAddress ?? address ?? null,
            description: `Payment to ${p.name} reverted on-chain. Amount: ${p.amountUsdc} USDC.`,
            outcome: 'failure',
            entityId: batch.id,
            entityLabel: batch.name,
            txHash: hash,
          })
        }
      } catch (err) {
        const e = err as { shortMessage?: string; message?: string }
        const msg = e?.shortMessage || e?.message || 'Transfer failed.'
        const isRejection = msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('user denied')
        workingBatch = {
          ...workingBatch,
          payments: workingBatch.payments.map((pay, idx) =>
            idx === i
              ? {
                  ...pay,
                  status: isRejection ? 'pending' : 'failed',
                  errorMessage: isRejection ? undefined : msg,
                }
              : pay
          ),
        }
        onBatchUpdate(workingBatch)

        if (!isRejection) {
          const n = Notify.payrollPaymentFailed(batch.id, batch.name, p.name, msg)
          opts?.onNotify?.(n)
          logAuditEvent({
            category: 'payroll',
            action: 'payroll_payment_failed',
            actorAddress: opts?.actorAddress ?? address ?? null,
            description: `Payment to ${p.name} failed: ${msg}`,
            outcome: 'failure',
            entityId: batch.id,
            entityLabel: batch.name,
          })
        }

        if (isRejection) {
          setRunError('Execution cancelled by user.')
          const finalStatus: BatchStatus = deriveBatchStatus(workingBatch.payments)
          workingBatch = { ...workingBatch, status: finalStatus }
          onBatchUpdate(workingBatch)
          setIsRunning(false)
          setCurrentIndex(null)
          return
        }
      }
    }

    const finalStatus: BatchStatus = deriveBatchStatus(workingBatch.payments)
    workingBatch = {
      ...workingBatch,
      status: finalStatus,
      completedAt: Date.now(),
    }
    onBatchUpdate(workingBatch)

    // Batch-complete notification
    const confirmedCount = workingBatch.payments.filter(p => p.status === 'confirmed').length
    const failedCount = workingBatch.payments.filter(p => p.status === 'failed').length
    const n = Notify.payrollBatchExecuted(batch.id, batch.name, confirmedCount, failedCount)
    opts?.onNotify?.(n)
    logAuditEvent({
      category: 'payroll',
      action: 'payroll_batch_executed',
      actorAddress: opts?.actorAddress ?? address ?? null,
      description: `Payroll batch "${batch.name}" completed: ${confirmedCount} confirmed, ${failedCount} failed.`,
      outcome: failedCount === 0 ? 'success' : confirmedCount > 0 ? 'success' : 'failure',
      entityId: batch.id,
      entityLabel: batch.name,
    })

    setIsRunning(false)
    setCurrentIndex(null)
  }

  return {
    runBatch,
    isRunning,
    currentIndex,
    runError,
    pendingPayments,
    batchTotal,
    canExecute,
    isWrongChain,
  }
}
