/**
 * usePayroll — manages payroll batch state and execution.
 *
 * Execution modes (chosen automatically at runtime):
 *
 *   ATOMIC MODE  — When VITE_PAYROLL_BATCH_ADDRESS is set and the PayrollBatch
 *                  contract is deployed on Arc Mainnet, execution proceeds as:
 *                    1. USDC.approve(payrollBatchAddress, batchTotal)   — 1 tx
 *                    2. PayrollBatch.executeBatch(batchId, [...], [...]) — 1 tx
 *                  All payments succeed or all revert.  One batch = two wallet
 *                  confirmations regardless of employee count.
 *
 *   SEQUENTIAL MODE — Fallback when the contract is not yet deployed.
 *                  One USDC.transfer() per employee, each requiring a wallet
 *                  confirmation.  Non-atomic: partial success is possible.
 *
 * Persistence: localStorage (browser-local, not on-chain).
 * Notification/audit callbacks: optional, injected by the page component.
 */

import { useState, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi'
import { erc20Abi, keccak256, toHex } from 'viem'
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
import { PAYROLL_BATCH_ADDRESS, PAYROLL_BATCH_ABI } from '../lib/contract'
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

      const notif = Notify.payrollBatchCreated(batch.id, batch.name)
      opts?.onNotify?.(notif)
      logAuditEvent({
        category: 'payroll',
        action: 'payroll_batch_created',
        actorAddress: params.createdBy ?? null,
        description: `Payroll batch "${batch.name}" created with ${batch.payments.length} ${batch.payments.length === 1 ? 'employee' : 'employees'}.`,
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

// ─── usePayrollBatchAllowance — reads allowance for the PayrollBatch contract ──

export function usePayrollBatchAllowance() {
  const { address } = useAccount()
  const usdcFact = getUsdc(CHAIN_ID)

  const { data, isLoading, refetch } = useReadContract({
    address: usdcFact?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: (address && PAYROLL_BATCH_ADDRESS)
      ? [address, PAYROLL_BATCH_ADDRESS]
      : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!usdcFact && !!PAYROLL_BATCH_ADDRESS },
  })

  const allowance: bigint = typeof data === 'bigint' ? data : 0n
  return { allowance, isLoading, refetch }
}

// ─── usePayrollStats ──────────────────────────────────────────────────────────

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
    totalBatches, completedBatches, processingBatches, failedBatches, draftBatches,
    totalPayments, confirmedPayments, pendingPayments, failedPayments,
    uniqueRecipients, totalConfirmedRaw, totalAllRaw,
  }
}

// ─── Execution mode ───────────────────────────────────────────────────────────

export type ExecutionMode = 'atomic' | 'sequential'

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

export function getExecutionMode(): ExecutionMode {
  return PAYROLL_BATCH_ADDRESS ? 'atomic' : 'sequential'
}

// ─── useBatchRunner ───────────────────────────────────────────────────────────
//
// Orchestrates full batch execution.  Chooses atomic or sequential mode based
// on whether PAYROLL_BATCH_ADDRESS is set.
//
// Atomic flow (2 txs, 2 wallet prompts):
//   Step 1: USDC.approve(payrollBatchContract, batchTotal)
//   Step 2: PayrollBatch.executeBatch(batchId, recipients, amounts)
//
// Sequential flow (N txs, N wallet prompts):
//   One USDC.transfer(recipient, amount) per pending payment.

export type BatchRunStep =
  | 'idle'
  | 'approving'   // atomic only — waiting for USDC approve tx
  | 'executing'   // sending executeBatch or individual transfers
  | 'confirming'  // waiting for receipt

export function useBatchRunner(
  batch: PayrollBatch | null,
  onBatchUpdate: (updated: PayrollBatch) => void,
  opts?: { onNotify?: NotifyFn; actorAddress?: string }
) {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { rawBalance } = useUsdcBalance()
  const { allowance, refetch: refetchAllowance } = usePayrollBatchAllowance()
  const [isRunning, setIsRunning] = useState(false)
  const [step, setStep] = useState<BatchRunStep>('idle')
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const usdcFact = getUsdc(CHAIN_ID)
  const { writeContractAsync } = useWriteContract()
  const executionMode = getExecutionMode()
  const isWrongChain = chainId !== CHAIN_ID

  const pendingPayments = batch?.payments.filter(p => p.status === 'pending') ?? []
  const batchTotal = batch ? sumBatchAmounts(batch.payments.filter(p => p.status === 'pending')) : 0n

  // Whether the current allowance already covers the batch total
  const hasAllowance = executionMode === 'atomic'
    ? allowance >= batchTotal
    : true // sequential doesn't need pre-approval

  function canExecute(): { ok: boolean; reason?: string } {
    if (!address) return { ok: false, reason: 'Your wallet is not connected. Connect it and try again.' }
    if (isWrongChain) return { ok: false, reason: 'Your wallet is on the wrong network. Switch to Arc Mainnet and try again.' }
    if (!batch || pendingPayments.length === 0) return { ok: false, reason: 'There are no unpaid payments left in this batch.' }
    if (rawBalance < batchTotal) {
      return {
        ok: false,
        reason: `Your wallet does not have enough USDC. You need ${(Number(batchTotal) / 10 ** USDC_DECIMALS).toFixed(2)} USDC. Add USDC and try again.`,
      }
    }
    return { ok: true }
  }

  // ─── Atomic execution ──────────────────────────────────────────────────────

  async function runAtomic() {
    if (!batch || !address || !usdcFact || !publicClient || !PAYROLL_BATCH_ADDRESS) return
    const { ok, reason } = canExecute()
    if (!ok) { setRunError(reason ?? 'The payments cannot be sent right now. Try again.'); return }

    setIsRunning(true)
    setRunError(null)

    // Derive a deterministic bytes32 batchId from the local batch id string
    const batchIdBytes32 = keccak256(toHex(batch.id))

    let workingBatch: PayrollBatch = {
      ...batch,
      status: 'processing',
      submittedAt: Date.now(),
      payments: batch.payments.map(p => ({ ...p })),
    }
    onBatchUpdate(workingBatch)

    logAuditEvent({
      category: 'payroll',
      action: 'payroll_batch_started',
      actorAddress: opts?.actorAddress ?? address ?? null,
      description: `Payroll batch "${batch.name}" started: ${pendingPayments.length} payments sent together (batch ID ${batchIdBytes32.slice(0, 10)}…).`,
      outcome: 'pending',
      entityId: batch.id,
      entityLabel: batch.name,
    })

    try {
      // ── Step 1: Approve (only if allowance is insufficient) ──────────────
      if (allowance < batchTotal) {
        setStep('approving')

        const approveHash = await writeContractAsync({
          address: usdcFact.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'approve',
          args: [PAYROLL_BATCH_ADDRESS, batchTotal],
          chainId: CHAIN_ID,
        })

        setStep('confirming')
        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash })
        if (approveReceipt.status !== 'success') {
          throw new Error('The USDC approval was rejected by the network. Try again.')
        }

        await refetchAllowance()
      }

      // ── Step 2: executeBatch ─────────────────────────────────────────────
      setStep('executing')

      const pendingRecipients = pendingPayments.map(p => p.walletAddress as `0x${string}`)
      const pendingAmounts    = pendingPayments.map(p => parseUsdcString(p.amountUsdc))

      const execHash = await writeContractAsync({
        address: PAYROLL_BATCH_ADDRESS,
        abi: PAYROLL_BATCH_ABI,
        functionName: 'executeBatch',
        args: [batchIdBytes32, pendingRecipients, pendingAmounts],
        chainId: CHAIN_ID,
      })

      setStep('confirming')
      const execReceipt = await publicClient.waitForTransactionReceipt({ hash: execHash })

      if (execReceipt.status !== 'success') {
        throw new Error('The batch was rejected by the network, so no payments were sent. Try again.')
      }

      // ── All payments confirmed atomically ────────────────────────────────
      const confirmedAt = Date.now()
      workingBatch = {
        ...workingBatch,
        status: 'completed',
        completedAt: confirmedAt,
        payments: workingBatch.payments.map((p) => {
          if (p.status !== 'pending') return p
          return {
            ...p,
            status: 'confirmed' as const,
            txHash: execHash,
            confirmedAt,
          }
        }),
      }
      onBatchUpdate(workingBatch)

      const n = Notify.payrollBatchExecuted(batch.id, batch.name, pendingPayments.length, 0)
      opts?.onNotify?.(n)
      logAuditEvent({
        category: 'payroll',
        action: 'payroll_batch_executed',
        actorAddress: opts?.actorAddress ?? address ?? null,
        description: `Payroll batch "${batch.name}" completed: ${pendingPayments.length} payments confirmed in a single transaction.`,
        outcome: 'success',
        entityId: batch.id,
        entityLabel: batch.name,
        txHash: execHash,
      })
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string }
      const rawMsg = e?.shortMessage || e?.message || ''
      const isRejection = rawMsg.toLowerCase().includes('user rejected') || rawMsg.toLowerCase().includes('user denied')
      const msg = describeTxError(rawMsg || 'The payments could not be sent. Try again.')

      workingBatch = {
        ...workingBatch,
        status: isRejection ? 'ready' : 'failed',
        payments: workingBatch.payments.map(p =>
          p.status === 'processing' || p.status === 'pending'
            ? { ...p, status: 'pending' as const, errorMessage: isRejection ? undefined : msg }
            : p
        ),
      }
      onBatchUpdate(workingBatch)
      setRunError(isRejection ? 'Transaction cancelled. Nothing was sent.' : msg)
    } finally {
      setIsRunning(false)
      setStep('idle')
      setCurrentIndex(null)
    }
  }

  // ─── Sequential execution (fallback) ──────────────────────────────────────

  async function runSequential() {
    if (!batch || !address || !usdcFact || !publicClient) return
    const { ok, reason } = canExecute()
    if (!ok) { setRunError(reason ?? 'The payments cannot be sent right now. Try again.'); return }

    setIsRunning(true)
    setRunError(null)
    setStep('executing')

    let workingBatch: PayrollBatch = {
      ...batch,
      status: 'processing',
      submittedAt: Date.now(),
      payments: batch.payments.map(p => ({ ...p })),
    }
    onBatchUpdate(workingBatch)

    logAuditEvent({
      category: 'payroll',
      action: 'payroll_batch_started',
      actorAddress: opts?.actorAddress ?? address ?? null,
      description: `Payroll batch "${batch.name}" started: ${pendingPayments.length} payments sent one by one.`,
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
                  errorMessage: succeeded ? undefined : 'The network rejected this payment. Try again.',
                }
              : pay
          ),
        }
        onBatchUpdate(workingBatch)

        if (succeeded) {
          const n = Notify.payrollPaymentConfirmed(batch.id, batch.name, p.name, hash)
          opts?.onNotify?.(n)
          logAuditEvent({
            category: 'payroll',
            action: 'payroll_payment_confirmed',
            actorAddress: opts?.actorAddress ?? address ?? null,
            description: `Payment to ${p.name} confirmed: ${p.amountUsdc} USDC.`,
            outcome: 'success',
            entityId: batch.id,
            entityLabel: batch.name,
            txHash: hash,
            meta: { recipient: p.walletAddress, amount: p.amountUsdc },
          })
        } else {
          const n = Notify.payrollPaymentFailed(batch.id, batch.name, p.name, 'The network rejected this payment. Try again.')
          opts?.onNotify?.(n)
          logAuditEvent({
            category: 'payroll',
            action: 'payroll_payment_failed',
            actorAddress: opts?.actorAddress ?? address ?? null,
            description: `Payment to ${p.name} was rejected by the network: ${p.amountUsdc} USDC.`,
            outcome: 'failure',
            entityId: batch.id,
            entityLabel: batch.name,
            txHash: hash,
          })
        }
      } catch (err) {
        const e = err as { shortMessage?: string; message?: string }
        const rawMsg = e?.shortMessage || e?.message || ''
        const isRejection = rawMsg.toLowerCase().includes('user rejected') || rawMsg.toLowerCase().includes('user denied')
        const msg = describeTxError(rawMsg || 'The payment could not be sent. Try again.')

        workingBatch = {
          ...workingBatch,
          payments: workingBatch.payments.map((pay, idx) =>
            idx === i
              ? { ...pay, status: isRejection ? 'pending' : 'failed', errorMessage: isRejection ? undefined : msg }
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
          setRunError('Transaction cancelled. No further payments were sent.')
          const finalStatus: BatchStatus = deriveBatchStatus(workingBatch.payments)
          workingBatch = { ...workingBatch, status: finalStatus }
          onBatchUpdate(workingBatch)
          setIsRunning(false)
          setStep('idle')
          setCurrentIndex(null)
          return
        }
      }
    }

    const finalStatus: BatchStatus = deriveBatchStatus(workingBatch.payments)
    workingBatch = { ...workingBatch, status: finalStatus, completedAt: Date.now() }
    onBatchUpdate(workingBatch)

    const confirmedCount = workingBatch.payments.filter(p => p.status === 'confirmed').length
    const failedCount = workingBatch.payments.filter(p => p.status === 'failed').length
    const n = Notify.payrollBatchExecuted(batch.id, batch.name, confirmedCount, failedCount)
    opts?.onNotify?.(n)
    logAuditEvent({
      category: 'payroll',
      action: 'payroll_batch_executed',
      actorAddress: opts?.actorAddress ?? address ?? null,
      description: `Payroll batch "${batch.name}" finished: ${confirmedCount} confirmed, ${failedCount} failed.`,
      outcome: failedCount === 0 ? 'success' : confirmedCount > 0 ? 'success' : 'failure',
      entityId: batch.id,
      entityLabel: batch.name,
    })

    setIsRunning(false)
    setStep('idle')
    setCurrentIndex(null)
  }

  // ─── Public run function (dispatches to mode) ─────────────────────────────

  async function runBatch() {
    if (executionMode === 'atomic') {
      await runAtomic()
    } else {
      await runSequential()
    }
  }

  return {
    runBatch,
    isRunning,
    step,
    currentIndex,
    runError,
    pendingPayments,
    batchTotal,
    canExecute,
    isWrongChain,
    executionMode,
    hasAllowance,
    allowance,
  }
}
