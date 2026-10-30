/**
 * useApprovals — approval request state, policy management, and execution.
 *
 * All requests are saved in this browser only.
 * Execution sends a real USDC ERC-20 transfer() on Arc Mainnet.
 * Approval decisions are locally recorded — NOT cryptographically enforced on-chain.
 *
 * Notification and audit callbacks are injected by callers to avoid circular deps.
 */

import { useState, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi'
import { erc20Abi } from 'viem'
import {
  type ApprovalRequest,
  type ApprovalPolicy,
  type ApprovalDecision,
  type RequestType,
  loadRequests,
  saveRequests,
  loadPolicy,
  savePolicy,
  upsertRequest,
  generateId,
  parseUsdcString,
  deriveRequestStatus,
  getRequestStats,
  isAuthorizedApprover,
  friendlyTxError,
  isUserRejection,
} from '../lib/approvals'
import { Notify, type AppNotification } from '../lib/notifications'
import { logAuditEvent, type AuditEntry } from '../lib/audit'
import { getUsdc } from '../onchain-facts'
import { ARC_MAINNET_CHAIN_ID } from '../config'

const CHAIN_ID = ARC_MAINNET_CHAIN_ID

export type NotifyFn = (n: AppNotification) => void
export type AuditFn = (fields: Omit<AuditEntry, 'id' | 'timestamp'>) => void

// ─── USDC balance hook ────────────────────────────────────────────────────────

export function useUsdcBalance() {
  const { address, chainId } = useAccount()
  const usdcFact = getUsdc(CHAIN_ID)
  const { data, isLoading } = useReadContract({
    address: (usdcFact?.address ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : ['0x0000000000000000000000000000000000000000'],
    chainId: CHAIN_ID,
    query: { enabled: !!usdcFact && !!address },
  })
  const raw = (typeof data === 'bigint' ? data : 0n)
  const divisor = 10n ** 6n
  const whole = raw / divisor
  const frac = (raw % divisor).toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return {
    rawBalance: raw,
    formatted: address && chainId === CHAIN_ID ? `${Number(whole).toLocaleString('en-US')}.${frac}` : null,
    isLoading,
  }
}

// ─── Main requests hook ───────────────────────────────────────────────────────

export function useApprovalRequests(opts?: { onNotify?: NotifyFn }) {
  const [requests, setRequests] = useState<ApprovalRequest[]>(loadRequests)

  /** Functional-updater wrapper — always reads the latest state, never a stale snapshot. */
  const persist = useCallback((updater: (prev: ApprovalRequest[]) => ApprovalRequest[]) => {
    setRequests(prev => {
      const next = updater(prev)
      saveRequests(next)
      return next
    })
  }, [])

  const createRequest = useCallback((fields: {
    title: string
    type: RequestType
    recipientAddress: string
    amountUsdc: string
    description: string
    requiredApprovals: number
    linkedBatchId?: string
    linkedScheduleId?: string
    requesterAddress: string
    /** Set when treasury is deployed and propose tx confirmed */
    onChainProposalId?: `0x${string}`
    proposeTxHash?: string
    onChainExpiresAt?: number
  }): ApprovalRequest => {
    const now = Date.now()
    const req: ApprovalRequest = {
      id: generateId(),
      type: fields.type,
      title: fields.title,
      requesterAddress: fields.requesterAddress,
      recipientAddress: fields.recipientAddress,
      amountUsdc: fields.amountUsdc,
      description: fields.description,
      requiredApprovals: fields.requiredApprovals,
      decisions: [],
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      linkedBatchId: fields.linkedBatchId,
      linkedScheduleId: fields.linkedScheduleId,
      onChainProposalId: fields.onChainProposalId,
      proposeTxHash: fields.proposeTxHash,
      onChainExpiresAt: fields.onChainExpiresAt,
    }
    persist(prev => upsertRequest(prev, req))

    const n = Notify.approvalRequestCreated(req.id, req.title)
    opts?.onNotify?.(n)
    logAuditEvent({
      category: 'approval',
      action: 'approval_request_created',
      actorAddress: fields.requesterAddress,
      description: `Approval request "${req.title}" created. Amount: ${req.amountUsdc} USDC. Required approvals: ${req.requiredApprovals}.`,
      outcome: 'pending',
      entityId: req.id,
      entityLabel: req.title,
      meta: { amount: req.amountUsdc, recipient: req.recipientAddress },
    })

    return req
  }, [persist, opts])

  const recordDecision = useCallback((
    requestId: string,
    approverAddress: string,
    decision: 'approved' | 'rejected',
    reason?: string
  ) => {
    // Capture result of the state update for side-effect notifications
    let sideEffectData: {
      req: ApprovalRequest
      updated: ApprovalRequest
      prevStatus: ApprovalRequest['status']
    } | null = null

    persist(prev => {
      const req = prev.find(r => r.id === requestId)
      if (!req) return prev

      const alreadyDecided = req.decisions.some(
        d => d.approverAddress.toLowerCase() === approverAddress.toLowerCase()
      )
      if (alreadyDecided) return prev

      const now = Date.now()
      const newDecision: ApprovalDecision = {
        approverAddress,
        decision,
        reason,
        timestamp: now,
      }
      const updated: ApprovalRequest = {
        ...req,
        decisions: [...req.decisions, newDecision],
        updatedAt: now,
      }
      const prevStatus = req.status
      updated.status = deriveRequestStatus(updated)
      sideEffectData = { req, updated, prevStatus }
      return upsertRequest(prev, updated)
    })

    // Notifications and audit events run after state update (not inside the updater)
    // sideEffectData is set synchronously by React's updater before setState returns
    if (!sideEffectData) return
    const { req, updated, prevStatus } = sideEffectData as {
      req: ApprovalRequest
      updated: ApprovalRequest
      prevStatus: ApprovalRequest['status']
    }

    if (decision === 'approved') {
      const n = Notify.approvalDecisionApproved(req.id, req.title, approverAddress)
      opts?.onNotify?.(n)
      logAuditEvent({
        category: 'approval',
        action: 'approval_decision_approved',
        actorAddress: approverAddress,
        description: `"${req.title}" approved by ${approverAddress.slice(0, 8)}….`,
        outcome: 'success',
        entityId: req.id,
        entityLabel: req.title,
      })
      // Threshold notification — only when status just became 'approved' (wasn't before)
      if (updated.status === 'approved' && prevStatus !== 'approved') {
        const tn = Notify.approvalThresholdReached(req.id, req.title)
        opts?.onNotify?.(tn)
        logAuditEvent({
          category: 'approval',
          action: 'approval_threshold_reached',
          actorAddress: approverAddress,
          description: `"${req.title}" reached the required number of approvals (${req.requiredApprovals}/${req.requiredApprovals}).`,
          outcome: 'info',
          entityId: req.id,
          entityLabel: req.title,
        })
      }
    } else {
      const n = Notify.approvalDecisionRejected(req.id, req.title, approverAddress)
      opts?.onNotify?.(n)
      logAuditEvent({
        category: 'approval',
        action: 'approval_decision_rejected',
        actorAddress: approverAddress,
        description: `"${req.title}" rejected by ${approverAddress.slice(0, 8)}…${reason ? `: ${reason}` : ''}.`,
        outcome: 'failure',
        entityId: req.id,
        entityLabel: req.title,
      })
    }
  }, [persist, opts])

  const cancelRequest = useCallback((requestId: string) => {
    let cancelled: ApprovalRequest | null = null
    const now = Date.now()
    persist(prev => {
      const req = prev.find(r => r.id === requestId)
      if (!req || req.status === 'executed' || req.status === 'executing') return prev
      cancelled = { ...req, status: 'cancelled', updatedAt: now }
      return upsertRequest(prev, cancelled)
    })
    if (!cancelled) return
    const c = cancelled as ApprovalRequest
    const n = Notify.approvalCancelled(c.id, c.title)
    opts?.onNotify?.(n)
    logAuditEvent({
      category: 'approval',
      action: 'approval_request_cancelled',
      actorAddress: null,
      description: `Approval request "${c.title}" cancelled.`,
      outcome: 'info',
      entityId: c.id,
      entityLabel: c.title,
    })
  }, [persist, opts])

  const updateRequest = useCallback((req: ApprovalRequest) => {
    persist(prev => upsertRequest(prev, req))
  }, [persist])

  return { requests, createRequest, recordDecision, cancelRequest, updateRequest }
}

// ─── Policy hook ──────────────────────────────────────────────────────────────

export function useApprovalPolicy() {
  const [policy, setPolicy] = useState<ApprovalPolicy>(loadPolicy)

  const updatePolicy = useCallback((updates: Partial<ApprovalPolicy>, updaterAddress?: string) => {
    const now = Date.now()
    const next: ApprovalPolicy = {
      ...policy,
      ...updates,
      updatedAt: now,
      updatedBy: updaterAddress ?? policy.updatedBy,
    }
    setPolicy(next)
    savePolicy(next)
  }, [policy])

  return { policy, updatePolicy }
}

// ─── Execution hook ───────────────────────────────────────────────────────────

export function useRequestExecutor(
  req: ApprovalRequest | null,
  policy: ApprovalPolicy,
  onUpdate: (updated: ApprovalRequest) => void,
  opts?: { onNotify?: NotifyFn }
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
    if (!address) return { ok: false, reason: 'Connect your wallet to continue.' }
    if (isWrongChain) return { ok: false, reason: 'Your wallet is on the wrong network. Switch to Arc Mainnet to continue.' }
    if (!req) return { ok: false, reason: 'Select a request first.' }
    if (req.status !== 'approved') {
      const stats = getRequestStats(req)
      return {
        ok: false,
        reason: `${stats.remainingApprovals} more approval${stats.remainingApprovals !== 1 ? 's' : ''} needed before this can be sent.`,
      }
    }
    if (!usdcFact) return { ok: false, reason: 'USDC is not available on this network. Switch to Arc Mainnet and try again.' }
    try {
      const rawAmount = parseUsdcString(req.amountUsdc)
      if (rawBalance < rawAmount) {
        return { ok: false, reason: `Your wallet does not have enough USDC for this payment. Add funds and try again.` }
      }
    } catch {
      return { ok: false, reason: 'The amount on this request is not valid. Create a new request with the correct amount.' }
    }
    if (!publicClient) return { ok: false, reason: 'Could not connect to the network. Refresh the page and try again.' }
    return { ok: true }
  }

  async function executeRequest() {
    if (!req || !address || !usdcFact || !publicClient) return
    const { ok, reason } = canExecute()
    if (!ok) { setExecError(reason ?? 'This payment cannot be sent right now.'); return }

    setIsExecuting(true)
    setExecError(null)

    const now = Date.now()
    onUpdate({ ...req, status: 'executing', updatedAt: now })

    logAuditEvent({
      category: 'approval',
      action: 'approval_request_sending',
      actorAddress: address ?? null,
      description: `Sending approval request "${req.title}". Amount: ${req.amountUsdc} USDC.`,
      outcome: 'pending',
      entityId: req.id,
      entityLabel: req.title,
    })

    try {
      const rawAmount = parseUsdcString(req.amountUsdc)
      const hash = await writeContractAsync({
        address: usdcFact.address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [req.recipientAddress as `0x${string}`, rawAmount],
        chainId: CHAIN_ID,
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      const succeeded = receipt.status === 'success'
      const finishedAt = Date.now()

      onUpdate({
        ...req,
        status: succeeded ? 'executed' : 'failed',
        txHash: hash,
        confirmedAt: succeeded ? finishedAt : undefined,
        errorMessage: succeeded ? undefined : 'The network rejected the payment. Nothing was sent. Check the details and try again.',
        updatedAt: finishedAt,
      })

      if (succeeded) {
        const n = Notify.approvalExecuted(req.id, req.title, hash)
        opts?.onNotify?.(n)
        logAuditEvent({
          category: 'approval',
          action: 'approval_request_executed',
          actorAddress: address ?? null,
          description: `Approval request "${req.title}" sent and confirmed on Arc Mainnet.`,
          outcome: 'success',
          entityId: req.id,
          entityLabel: req.title,
          txHash: hash,
          meta: { amount: req.amountUsdc, recipient: req.recipientAddress },
        })
      } else {
        const n = Notify.approvalFailed(req.id, req.title, 'The network rejected the payment. Nothing was sent. Check the details and try again.')
        opts?.onNotify?.(n)
        logAuditEvent({
          category: 'approval',
          action: 'approval_request_failed',
          actorAddress: address ?? null,
          description: `Approval request "${req.title}" was rejected by the network.`,
          outcome: 'failure',
          entityId: req.id,
          entityLabel: req.title,
          txHash: hash,
        })
      }
    } catch (err) {
      // Declining the wallet prompt is not a failure: nothing was sent, so the request
      // goes back to "approved" and can be sent again.
      if (isUserRejection(err)) {
        const cancelMsg = 'Transaction cancelled. Nothing was sent.'
        onUpdate({ ...req, status: 'approved', errorMessage: undefined, updatedAt: Date.now() })
        opts?.onNotify?.(Notify.approvalSendCancelled(req.id, req.title))
        logAuditEvent({
          category: 'approval',
          action: 'approval_send_cancelled',
          actorAddress: address ?? null,
          description: `Wallet prompt cancelled for "${req.title}". No transaction was sent.`,
          outcome: 'info',
          entityId: req.id,
          entityLabel: req.title,
        })
        setExecError(cancelMsg)
        return
      }

      const msg = friendlyTxError(err, 'The payment was not sent. Check your wallet and try again.')
      onUpdate({ ...req, status: 'failed', errorMessage: msg, updatedAt: Date.now() })

      const n = Notify.approvalFailed(req.id, req.title, msg)
      opts?.onNotify?.(n)
      logAuditEvent({
        category: 'approval',
        action: 'approval_request_failed',
        actorAddress: address ?? null,
        description: `Approval request "${req.title}" failed: ${msg}`,
        outcome: 'failure',
        entityId: req.id,
        entityLabel: req.title,
      })

      setExecError(msg)
    } finally {
      setIsExecuting(false)
    }
  }

  return { isExecuting, execError, canExecute, executeRequest, isAuthorized: isAuthorizedApprover(address ?? '', policy) }
}

// ─── Stats hook ───────────────────────────────────────────────────────────────

export interface ApprovalStats {
  total: number
  pending: number
  partial: number
  approved: number
  rejected: number
  executed: number
  failed: number
  needsMyApproval: number
}

export function useApprovalStats(requests: ApprovalRequest[], myAddress?: string): ApprovalStats {
  const needsMyApproval = myAddress
    ? requests.filter(r => {
        if (r.status !== 'pending' && r.status !== 'partial') return false
        const alreadyDecided = r.decisions.some(
          d => d.approverAddress.toLowerCase() === myAddress.toLowerCase()
        )
        return !alreadyDecided
      }).length
    : 0

  return {
    total: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    partial: requests.filter(r => r.status === 'partial').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
    executed: requests.filter(r => r.status === 'executed').length,
    failed: requests.filter(r => r.status === 'failed').length,
    needsMyApproval,
  }
}
