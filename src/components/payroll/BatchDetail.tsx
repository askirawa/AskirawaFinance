/**
 * BatchDetail — full details of a payroll batch with execution controls.
 *
 * ─── Execution modes ─────────────────────────────────────────────────────────
 *
 * TREASURY MODE  (VITE_TREASURY_ADDRESS is set)
 *   Payroll batches must go through AskirawaFiTreasury approval before USDC moves.
 *   Flow:
 *     1. "Propose to Treasury" — calls proposePayroll(proposalId, recipients[], amounts[], expiresAt)
 *        - Freezes the exact recipient list and amounts in the on-chain content hash.
 *        - proposalId and tx hash are stored on the batch record.
 *        - Direct execution is NOT available; the old PayrollBatch / sequential paths
 *          are hidden with an explicit "treasury enforcement active" notice.
 *     2. Approvers vote via the Approvals page (or any wallet that calls treasury.vote()).
 *     3. "Execute via Treasury" — calls execute(proposalId, frozenRecipients, frozenAmounts)
 *        - Only available once on-chain approvalCount >= quorum.
 *        - Passes the exact frozen payload; any substitution causes PayloadHashMismatch.
 *
 * PERSONAL-WALLET MODE  (VITE_TREASURY_ADDRESS is unset)
 *   Unchanged original behaviour: atomic via PayrollBatch contract if deployed,
 *   otherwise sequential USDC.transfer() per employee.
 *   Clearly labeled as personal-wallet / non-treasury mode.
 *
 * ─── Safety properties ───────────────────────────────────────────────────────
 *   - In treasury mode the direct-execute button is NEVER shown.
 *   - frozenRecipients / frozenAmounts are written once at propose-confirm time
 *     and never overwritten; execute() reads only those fields.
 *   - Duplicate proposals are blocked: "Propose" is hidden once treasuryProposalId is set.
 *   - A failed transaction is never shown as a confirmed on-chain action.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  X, ArrowUpRight, AlertCircle, CheckCircle2, Clock,
  Loader2, Info, PlayCircle, ShieldCheck, Zap, Shield,
  Vote, Send,
} from 'lucide-react'
import { useAccount, useSwitchChain } from 'wagmi'
import Badge from '../ui/Badge'
import Spinner from '../ui/Spinner'
import {
  type PayrollBatch,
  type EmployeePayment,
  BATCH_STATUS_LABELS,
  batchStatusVariant,
  paymentStatusVariant,
  getBatchStats,
  formatUsdcBigint,
  formatTs,
  formatBatchId,
  sumBatchAmounts,
  parseUsdcString,
} from '../../lib/payroll'
import { useUsdcBalance, useBatchRunner } from '../../hooks/usePayroll'
import {
  isTreasuryDeployed,
  useTreasuryPayroll,
  useTreasuryVote,
  useVoteEligibility,
  useTreasuryProposal,
  useTreasuryConfig,
} from '../../hooks/useTreasury'
import { buildTxExplorerUrl } from '../../onchain-facts'
import { PAYROLL_BATCH_ADDRESS, TREASURY_ADDRESS } from '../../lib/contract'
import { ARC_MAINNET_CHAIN_ID } from '../../config'
import { useNotifications } from '../../context/NotificationContext'
import { logAuditEvent } from '../../lib/audit'

const CHAIN_ID = ARC_MAINNET_CHAIN_ID
// Default proposal lifetime: 7 days (within [1h, 30d] window)
const DEFAULT_EXPIRY_DAYS = 7

interface BatchDetailProps {
  batch: PayrollBatch
  onClose: () => void
  onUpdate: (updated: PayrollBatch) => void
}

function PaymentRow({ payment }: { payment: EmployeePayment }) {
  const explorerUrl = payment.txHash
    ? buildTxExplorerUrl(CHAIN_ID, payment.txHash)
    : null

  const statusIcon = {
    pending:    <Clock        size={13} style={{ color: 'var(--muted)' }} />,
    processing: <Loader2      size={13} className="animate-spin" style={{ color: 'var(--accent)' }} />,
    confirmed:  <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />,
    failed:     <AlertCircle  size={13} style={{ color: 'var(--danger)' }} />,
  }[payment.status]

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td className="px-5 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
        {payment.name || '—'}
      </td>
      <td className="px-5 py-3 text-xs mono" style={{ color: 'var(--muted)' }}>
        {payment.walletAddress.slice(0, 6)}…{payment.walletAddress.slice(-4)}
      </td>
      <td className="px-5 py-3 text-sm font-semibold mono" style={{ color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
        {payment.amountUsdc} USDC
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-1.5">
          {statusIcon}
          <Badge variant={paymentStatusVariant(payment.status)}>
            {payment.status === 'confirmed' ? 'Confirmed' :
             payment.status === 'processing' ? 'Processing' :
             payment.status === 'failed'     ? 'Failed'     : 'Waiting'}
          </Badge>
        </div>
        {payment.errorMessage && (
          <div className="mt-1 text-xs" style={{ color: 'var(--danger)', overflowWrap: 'anywhere' }}>{payment.errorMessage}</div>
        )}
      </td>
      <td className="px-5 py-3">
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: 'var(--accent)' }}
          >
            {payment.txHash!.slice(0, 8)}…
            <ArrowUpRight size={11} />
          </a>
        ) : (
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>—</span>
        )}
      </td>
      <td className="px-5 py-3 text-xs" style={{ color: 'var(--muted)' }}>
        {payment.confirmedAt ? formatTs(payment.confirmedAt) : '—'}
      </td>
    </tr>
  )
}

// ─── Treasury panel (shown when VITE_TREASURY_ADDRESS is set) ─────────────────

function TreasuryPanel({
  batch,
  onUpdate,
}: {
  batch: PayrollBatch
  onUpdate: (b: PayrollBatch) => void
}) {
  const { address, chainId } = useAccount()
  const { emit } = useNotifications()
  const isWrongChain = chainId !== CHAIN_ID

  const { propose, executePayroll, isPending, error } = useTreasuryPayroll()
  const { vote, isPending: isVoting, error: voteError } = useTreasuryVote()
  const { quorum } = useTreasuryConfig()

  const proposalId = (batch.treasuryProposalId as `0x${string}` | undefined) ?? null
  const { proposal, refetch: refetchProposal } = useTreasuryProposal(proposalId)

  const [localError, setLocalError] = useState<string | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)

  // ── Required approvals / vote state from on-chain ────────────────────────────────────────
  const approvalCount = proposal?.approvalCount ?? 0
  const effectiveQuorum = quorum ?? 1
  const quorumReached = approvalCount >= effectiveQuorum
  // Only approvers who did not create the request and have not yet approved it may vote
  const { canVote, reason: voteBlockedReason } = useVoteEligibility(proposalId)

  // ── Propose ──────────────────────────────────────────────────────────────────

  const handlePropose = useCallback(async () => {
    setLocalError(null)
    if (!address) { setLocalError('Your wallet is not connected. Connect it and try again.'); return }
    if (isWrongChain) { setLocalError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return }

    // Build the frozen payload from pending payments
    const pendingPayments = batch.payments.filter(p => p.status === 'pending')
    if (pendingPayments.length === 0) { setLocalError('There are no unpaid payments in this batch to send for approval.'); return }

    let recipients: `0x${string}`[] = []
    let amounts: bigint[] = []
    try {
      recipients = pendingPayments.map(p => p.walletAddress as `0x${string}`)
      amounts = pendingPayments.map(p => parseUsdcString(p.amountUsdc))
    } catch (e) {
      setLocalError((e as Error).message)
      return
    }

    const expiresAt = Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_DAYS * 86400

    const result = await propose({ offChainId: batch.id, recipients, amounts, expiresAt })
    if (!result) return // error already set in hook

    // Persist the frozen payload and proposal ID to the batch record.
    // These fields are NEVER overwritten after this point.
    const updated: PayrollBatch = {
      ...batch,
      status: 'processing',
      submittedAt: Date.now(),
      treasuryProposalId: result.proposalId,
      treasuryProposeTxHash: result.hash,
      treasuryExpiresAt: expiresAt,
      treasuryRecipients: result.frozenRecipients,
      treasuryAmounts: result.frozenAmounts.map(a => a.toString()),
      treasuryStatus: 'proposed',
    }
    onUpdate(updated)
    void refetchProposal()

    emit({
      id: `payroll-proposed-${batch.id}-${Date.now()}`,
      category: 'payroll',
      severity: 'info',
      title: 'Payroll sent for approval',
      description: `Payroll batch "${batch.name}" was sent for approval (${pendingPayments.length} recipients).`,
      timestamp: Date.now(),
      read: false,
      txHash: result.hash,
    })
    logAuditEvent({
      category: 'payroll',
      action: 'payroll_batch_submitted',
      actorAddress: address ?? null,
      description: `Payroll batch "${batch.name}" was sent for approval through the treasury contract. Request ID: ${result.proposalId.slice(0, 10)}… Transaction: ${result.hash.slice(0, 10)}…`,
      outcome: 'success',
      entityId: batch.id,
      entityLabel: batch.name,
      txHash: result.hash,
    })
  }, [address, isWrongChain, batch, propose, onUpdate, refetchProposal, emit])

  // ── Vote ─────────────────────────────────────────────────────────────────────

  const handleVote = useCallback(async () => {
    setLocalError(null)
    if (!proposalId) { setLocalError('This batch has not been sent for approval yet. Send it for approval first.'); return }
    if (isWrongChain) { setLocalError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return }

    const txHash = await vote(proposalId)
    if (!txHash) return

    void refetchProposal()
    emit({
      id: `payroll-voted-${batch.id}-${Date.now()}`,
      category: 'payroll',
      severity: 'info',
      title: 'Approval recorded',
      description: `Your approval for payroll batch "${batch.name}" was recorded.`,
      timestamp: Date.now(),
      read: false,
      txHash,
    })
    logAuditEvent({
      category: 'payroll',
      action: 'payroll_batch_approved',
      actorAddress: address ?? null,
      description: `Approval recorded for payroll batch "${batch.name}" (request ID: ${proposalId.slice(0, 10)}…).`,
      outcome: 'success',
      entityId: batch.id,
      entityLabel: batch.name,
      txHash,
    })
  }, [proposalId, isWrongChain, vote, refetchProposal, emit, batch, address])

  // ── Execute ──────────────────────────────────────────────────────────────────

  const handleExecute = useCallback(async () => {
    setLocalError(null)
    if (!proposalId) { setLocalError('This batch has not been sent for approval yet. Send it for approval first.'); return }
    if (!batch.treasuryRecipients || !batch.treasuryAmounts) {
      setLocalError('The approved payment list is missing from this browser. Create the batch again and resubmit it for approval.')
      return
    }
    if (isWrongChain) { setLocalError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return }

    setIsExecuting(true)
    try {
      const frozenRecipients = batch.treasuryRecipients as `0x${string}`[]
      const frozenAmounts = batch.treasuryAmounts.map(a => BigInt(a))

      const txHash = await executePayroll({ proposalId, frozenRecipients, frozenAmounts })
      if (!txHash) return

      const confirmedAt = Date.now()
      const updated: PayrollBatch = {
        ...batch,
        status: 'completed',
        completedAt: confirmedAt,
        treasuryExecuteTxHash: txHash,
        treasuryStatus: 'executed',
        payments: batch.payments.map(p =>
          p.status === 'pending'
            ? { ...p, status: 'confirmed' as const, txHash, confirmedAt }
            : p
        ),
      }
      onUpdate(updated)
      void refetchProposal()

      emit({
        id: `payroll-executed-${batch.id}-${Date.now()}`,
        category: 'payroll',
        severity: 'success',
        title: 'Payroll sent',
        description: `Payroll batch "${batch.name}" was sent through the treasury contract (${frozenRecipients.length} payments).`,
        timestamp: confirmedAt,
        read: false,
        txHash,
      })
      logAuditEvent({
        category: 'payroll',
        action: 'payroll_batch_executed',
        actorAddress: address ?? null,
        description: `Payroll batch "${batch.name}" was sent through the treasury contract. Request ID: ${proposalId.slice(0, 10)}… Transaction: ${txHash.slice(0, 10)}…`,
        outcome: 'success',
        entityId: batch.id,
        entityLabel: batch.name,
        txHash,
      })
    } finally {
      setIsExecuting(false)
    }
  }, [proposalId, batch, isWrongChain, executePayroll, onUpdate, refetchProposal, emit, address])

  const displayError = localError || error || voteError

  // ── Render ───────────────────────────────────────────────────────────────────

  const isProposed = !!batch.treasuryProposalId
  const isExecutedOnChain = batch.treasuryStatus === 'executed'
  const explorerBase = `https://explorer.arc.io`

  return (
    <div
      className="px-6 py-4 space-y-3"
      style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-muted)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield size={14} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          Approval required
        </span>
        <span
          className="text-xs px-2 py-0.5 font-semibold"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
        >
          {TREASURY_ADDRESS!.slice(0, 8)}…{TREASURY_ADDRESS!.slice(-4)}
        </span>
      </div>

      <div className="text-xs" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
        This batch needs {effectiveQuorum} {effectiveQuorum === 1 ? 'approval' : 'approvals'} before any USDC is sent.
        The recipients and amounts are locked when you request approval and cannot be changed afterwards.
      </div>

      {/* Proposal info (after propose) */}
      {isProposed && (
        <div
          className="p-3 space-y-1 text-xs"
          style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <span style={{ color: 'var(--muted)' }}>Approval request ID</span>
            <span className="mono font-semibold" style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }} title={batch.treasuryProposalId}>
              {batch.treasuryProposalId!.slice(0, 10)}…{batch.treasuryProposalId!.slice(-6)}
            </span>
          </div>
          {batch.treasuryProposeTxHash && (
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <span style={{ color: 'var(--muted)' }}>Approval request transaction</span>
              <a
                href={buildTxExplorerUrl(CHAIN_ID, batch.treasuryProposeTxHash) ?? `${explorerBase}/tx/${batch.treasuryProposeTxHash}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                {batch.treasuryProposeTxHash.slice(0, 10)}…{batch.treasuryProposeTxHash.slice(-6)}
                <ArrowUpRight size={11} />
              </a>
            </div>
          )}
          {batch.treasuryExecuteTxHash && (
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <span style={{ color: 'var(--muted)' }}>Payment transaction</span>
              <a
                href={buildTxExplorerUrl(CHAIN_ID, batch.treasuryExecuteTxHash) ?? `${explorerBase}/tx/${batch.treasuryExecuteTxHash}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold"
                style={{ color: 'var(--success)' }}
              >
                {batch.treasuryExecuteTxHash.slice(0, 10)}…{batch.treasuryExecuteTxHash.slice(-6)}
                <ArrowUpRight size={11} />
              </a>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <span style={{ color: 'var(--muted)' }}>Approvals</span>
            <span style={{ color: quorumReached ? 'var(--success)' : 'var(--ink)' }}>
              {approvalCount} of {effectiveQuorum} approvals
              {quorumReached && <span className="ml-1" style={{ color: 'var(--success)' }}>✓ Fully approved</span>}
            </span>
          </div>
          {batch.treasuryExpiresAt && (
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <span style={{ color: 'var(--muted)' }}>Expires</span>
              <span style={{ color: 'var(--muted)' }}>
                {new Date(batch.treasuryExpiresAt * 1000).toLocaleString()}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <span style={{ color: 'var(--muted)' }}>Recipients locked in</span>
            <span style={{ color: 'var(--ink)' }}>{batch.treasuryRecipients?.length ?? 0}</span>
          </div>
        </div>
      )}

      {displayError && (
        <div
          className="flex items-start gap-2 p-3 text-xs"
          style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)', color: 'var(--danger)', overflowWrap: 'anywhere' }}
        >
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          {displayError}
        </div>
      )}

      {/* Action buttons */}
      {!isExecutedOnChain && !isWrongChain && (
        <div className="flex flex-wrap gap-2">
          {/* Request approval (only if not yet proposed) */}
          {!isProposed && (
            <button
              onClick={() => { void handlePropose() }}
              disabled={isPending || !address}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-opacity"
              style={{
                background: (isPending || !address) ? 'var(--surface-muted)' : 'var(--accent)',
                color: (isPending || !address) ? 'var(--subtle)' : 'var(--bg)',
                border: 'none',
                cursor: (isPending || !address) ? 'not-allowed' : 'pointer',
                minHeight: 44,
                opacity: isPending ? 0.7 : 1,
              }}
            >
              {isPending ? <><Spinner size={13} /> Requesting approval…</> : <><Send size={13} /> Request approval</>}
            </button>
          )}

          {/* Approve (only after the request exists) */}
          {isProposed && !quorumReached && canVote && (
            <button
              onClick={() => { void handleVote() }}
              disabled={isVoting || !address}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-opacity"
              style={{
                background: (isVoting || !address) ? 'var(--surface-muted)' : 'var(--accent-dim)',
                color: (isVoting || !address) ? 'var(--subtle)' : 'var(--accent)',
                border: '1px solid var(--accent-border)',
                cursor: (isVoting || !address) ? 'not-allowed' : 'pointer',
                minHeight: 44,
                opacity: isVoting ? 0.7 : 1,
              }}
            >
              {isVoting ? <><Spinner size={13} /> Approving…</> : <><Vote size={13} /> Approve payroll</>}
            </button>
          )}

          {isProposed && !quorumReached && !canVote && voteBlockedReason && (
            <div className="text-xs" style={{ color: 'var(--muted)', alignSelf: 'center' }}>{voteBlockedReason}</div>
          )}

          {/* Send (only after the required approvals) */}
          {isProposed && quorumReached && batch.treasuryStatus !== 'executed' && (
            <button
              onClick={() => { void handleExecute() }}
              disabled={isExecuting || !address}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-opacity"
              style={{
                background: (isExecuting || !address) ? 'var(--surface-muted)' : 'var(--accent)',
                color: (isExecuting || !address) ? 'var(--subtle)' : 'var(--bg)',
                border: 'none',
                cursor: (isExecuting || !address) ? 'not-allowed' : 'pointer',
                minHeight: 44,
                opacity: isExecuting ? 0.7 : 1,
              }}
            >
              {isExecuting
                ? <><Spinner size={13} /> Sending…</>
                : <><ShieldCheck size={13} /> Send payroll</>
              }
            </button>
          )}

          <button onClick={() => { void refetchProposal() }} title="Refresh approval status" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 0, minHeight: 44, padding: '8px 12px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
            Refresh status
          </button>
        </div>
      )}

      {isExecutedOnChain && (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--success)' }}>
          <CheckCircle2 size={14} />
          Payroll sent through the treasury contract. All payments are confirmed.
        </div>
      )}

      {isWrongChain && (
        <div className="text-xs" style={{ color: 'var(--warning)' }}>
          Your wallet is on the wrong network. Switch to Arc Mainnet to continue.
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BatchDetail({ batch, onClose, onUpdate }: BatchDetailProps) {
  const { isConnected, chainId, address } = useAccount()
  const { emit } = useNotifications()
  const { switchChain, isPending: isSwitching } = useSwitchChain() as {
    switchChain: (params: { chainId: number }) => void
    isPending: boolean
  }
  const { rawBalance, formatted: balanceFormatted } = useUsdcBalance()
  const isWrongChain = isConnected && chainId !== CHAIN_ID

  const stats = getBatchStats(batch)
  const pendingRaw = sumBatchAmounts(batch.payments.filter(p => p.status === 'pending'))
  const hasPending = batch.payments.some(p => p.status === 'pending')
  const hasEnoughBalance = rawBalance >= pendingRaw

  const {
    runBatch,
    isRunning,
    step,
    currentIndex,
    runError,
    canExecute,
    executionMode,
    hasAllowance,
  } = useBatchRunner(batch, onUpdate, { onNotify: emit, actorAddress: address ?? undefined })

  const executeCheck = canExecute()
  const isTerminal = batch.status === 'completed' || batch.status === 'failed'
  const canRun = hasPending && !isTerminal && !isRunning

  const atomicStepLabel: Record<string, string> = {
    idle:       '',
    approving:  'Step 1 of 2: Allowing USDC…',
    executing:  'Step 2 of 2: Sending payments…',
    confirming: 'Waiting for confirmation…',
  }

  useEffect(() => {
    if (isRunning) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isRunning, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(5,12,18,0.85)', backdropFilter: 'blur(6px)', padding: 12 }}
      onClick={() => { if (!isRunning) onClose() }}
    >
      <div
        style={{
          width: 'min(896px, 100%)',
          maxHeight: '90dvh',
          overflowY: 'auto',
          background: 'var(--bg-2)',
          border: '1px solid var(--border-strong)',
        }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Payroll batch details"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                {formatBatchId(batch.id)}
              </span>
              <Badge variant={batchStatusVariant(batch.status)}>
                {BATCH_STATUS_LABELS[batch.status]}
              </Badge>
              {/* Mode badge */}
              {isTreasuryDeployed ? (
                <span
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                >
                  <Shield size={10} /> Approval required
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5"
                  style={{ background: executionMode === 'atomic' ? 'var(--accent-dim)' : 'var(--surface-muted)', color: executionMode === 'atomic' ? 'var(--accent)' : 'var(--muted)', border: executionMode === 'atomic' ? '1px solid var(--accent-border)' : '1px solid var(--border)' }}
                >
                  {executionMode === 'atomic' ? <><ShieldCheck size={10} /> All at once</> : <><Zap size={10} /> One by one</>}
                </span>
              )}
            </div>
            <h2 className="display font-bold text-xl" style={{ color: 'var(--ink)', letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}>
              {batch.name}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              <span>Created {formatTs(batch.createdAt)}</span>
              {batch.createdBy && <span>by {batch.createdBy.slice(0, 6)}…{batch.createdBy.slice(-4)}</span>}
              {batch.scheduleType === 'scheduled' && batch.scheduledDate && (
                <span style={{ color: 'var(--warning)' }}>
                  Pay date: {new Date(batch.scheduledDate).toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center transition-colors shrink-0"
            style={{ width: 44, height: 44, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid gap-0" style={{ borderBottom: '1px solid var(--border)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))' }}>
          {[
            { label: 'Employees', value: String(stats.employeeCount) },
            { label: 'Total',     value: `${stats.totalFormatted} USDC` },
            { label: 'Confirmed', value: String(stats.confirmedCount) },
            { label: 'Waiting',   value: String(stats.pendingCount) },
            { label: 'Failed',    value: String(stats.failedCount) },
          ].map(({ label, value }, i) => (
            <div key={label} className="px-5 py-3" style={{ borderRight: i < 4 ? '1px solid var(--border)' : 'none', minWidth: 0 }}>
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)', fontSize: 10 }}>{label}</div>
              <div className="font-bold mono text-sm display" style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── TREASURY MODE: treasury panel ─────────────────────────────────── */}
        {isTreasuryDeployed && (
          <TreasuryPanel batch={batch} onUpdate={onUpdate} />
        )}

        {/* ── PERSONAL-WALLET MODE: direct execution controls ───────────────── */}
        {!isTreasuryDeployed && (
          <>
            {/* Mode notice */}
            {executionMode === 'atomic' ? (
              <div className="flex items-start gap-3 px-6 py-3 text-xs" style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent-dim)', color: 'var(--muted)' }}>
                <ShieldCheck size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                <span>
                  <strong style={{ color: 'var(--ink-2)' }}>All payments are sent together</strong>
                  {' '}through the payroll contract ({PAYROLL_BATCH_ADDRESS?.slice(0, 8)}…). Either every payment goes through or none do.
                  You confirm twice in your wallet: first to allow USDC, then to send the batch.
                  This is paid from your own wallet and does not need treasury approval.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-3 px-6 py-3 text-xs" style={{ borderBottom: '1px solid var(--border)', background: 'rgba(232,184,76,0.04)', color: 'var(--muted)' }}>
                <Info size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
                <span>
                  <strong style={{ color: 'var(--warning)' }}>Payments are sent one by one from your own wallet.</strong>
                  {' '}You confirm each employee separately, and some payments may succeed while others fail.
                  This does not need treasury approval because the treasury contract has not been set up yet.
                </span>
              </div>
            )}

            {/* Execution controls */}
            {canRun && (
              <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>
                      Your wallet balance:{' '}
                      <span className="font-semibold mono" style={{ color: hasEnoughBalance ? 'var(--accent)' : 'var(--danger)' }}>
                        {balanceFormatted ?? '—'} USDC
                      </span>
                      {' · '}Amount to pay:{' '}
                      <span className="font-semibold mono" style={{ color: 'var(--ink-2)' }}>
                        {formatUsdcBigint(pendingRaw)} USDC
                      </span>
                    </div>
                    {executionMode === 'atomic' && (
                      <div className="text-xs mt-0.5" style={{ color: hasAllowance ? 'var(--accent)' : 'var(--muted)' }}>
                        {hasAllowance
                          ? 'USDC is already allowed for this batch. You only need to confirm once in your wallet.'
                          : 'You will confirm twice in your wallet: first to allow USDC, then to send the batch.'}
                      </div>
                    )}
                    {!isConnected && <div className="text-xs mt-1" style={{ color: 'var(--warning)' }}>Connect your wallet to send payments.</div>}
                    {isConnected && isWrongChain && <div className="text-xs mt-1" style={{ color: 'var(--warning)' }}>Your wallet is on the wrong network. Switch to Arc Mainnet.</div>}
                    {isConnected && !isWrongChain && !hasEnoughBalance && <div className="text-xs mt-1" style={{ color: 'var(--danger)' }}>Your wallet does not have enough USDC for this batch. Add USDC and try again.</div>}
                    {runError && <div className="text-xs mt-1" style={{ color: 'var(--danger)', overflowWrap: 'anywhere' }}>{runError}</div>}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isWrongChain && (
                      <button onClick={() => switchChain({ chainId: CHAIN_ID })} disabled={isSwitching} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold" style={{ background: 'var(--warning)', color: '#0d1810', border: 'none', cursor: isSwitching ? 'not-allowed' : 'pointer', minHeight: 44, opacity: isSwitching ? 0.7 : 1 }}>
                        {isSwitching ? 'Switching…' : 'Switch to Arc Mainnet'}
                      </button>
                    )}
                    <button
                      onClick={() => { void runBatch() }}
                      disabled={!executeCheck.ok || isRunning}
                      className="flex items-center gap-2 px-5 py-2 text-sm font-semibold transition-opacity"
                      style={{ background: executeCheck.ok && !isRunning ? 'var(--accent)' : 'var(--surface-muted)', color: executeCheck.ok && !isRunning ? 'var(--bg)' : 'var(--subtle)', border: 'none', cursor: executeCheck.ok && !isRunning ? 'pointer' : 'not-allowed', minHeight: 44 }}
                    >
                      {isRunning ? (
                        <><Spinner size={14} />{executionMode === 'atomic' ? (atomicStepLabel[step] || 'Processing…') : `Sending ${currentIndex !== null ? currentIndex + 1 : 0} of ${stats.pendingCount}…`}</>
                      ) : (
                        <><PlayCircle size={15} />{batch.scheduleType === 'scheduled' ? 'Send payments now' : 'Send payments'}</>
                      )}
                    </button>
                  </div>
                </div>

                {executionMode === 'sequential' && isRunning && currentIndex !== null && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
                      <span>Sending payment {currentIndex + 1} of {stats.pendingCount}</span>
                      <span>{Math.round((currentIndex / Math.max(stats.pendingCount, 1)) * 100)}%</span>
                    </div>
                    <div className="overflow-hidden" style={{ height: 4, background: 'var(--surface-muted)' }}>
                      <div className="transition-all" style={{ height: 4, background: 'var(--accent)', width: `${Math.round((currentIndex / Math.max(stats.pendingCount, 1)) * 100)}%` }} />
                    </div>
                  </div>
                )}

                {executionMode === 'atomic' && isRunning && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                    <div className="flex items-center gap-1.5" style={{ color: step === 'approving' || step === 'confirming' ? 'var(--accent)' : step === 'executing' ? 'var(--success)' : 'var(--subtle)' }}>
                      {step === 'approving' ? <Spinner size={11} /> : <CheckCircle2 size={11} />}
                      Step 1: Allow USDC
                    </div>
                    <span style={{ color: 'var(--subtle)' }}>→</span>
                    <div className="flex items-center gap-1.5" style={{ color: step === 'executing' || step === 'confirming' ? 'var(--accent)' : 'var(--subtle)' }}>
                      {step === 'executing' ? <Spinner size={11} /> : <CheckCircle2 size={11} />}
                      Step 2: Send payments
                    </div>
                  </div>
                )}

                {batch.scheduleType === 'scheduled' && batch.scheduledDate && !isRunning && (
                  <div className="flex items-start gap-2 mt-3 p-3 text-xs" style={{ background: 'rgba(232,184,76,0.06)', border: '1px solid rgba(232,184,76,0.15)', color: 'var(--warning)' }}>
                    <Info size={13} className="mt-0.5 shrink-0" />
                    <span>Planned for {new Date(batch.scheduledDate).toLocaleString()}. Payments are not sent automatically. Click <strong>Send payments now</strong> when you are ready.</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Payment table */}
        <div className="overflow-x-auto" style={{ maxHeight: '40dvh', overflowY: 'auto' }}>
          <table className="w-full" style={{ minWidth: 700 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr style={{ background: 'var(--bg-2)' }}>
                {['Employee', 'Wallet', 'Amount', 'Status', 'Transaction', 'Confirmed'].map(h => (
                  <th key={h} className="text-left text-xs uppercase tracking-wider px-5 py-3" style={{ color: 'var(--subtle)', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: '0.07em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batch.payments.map(payment => (
                <PaymentRow key={payment.id} payment={payment} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          {batch.note && (
            <div className="text-xs" style={{ color: 'var(--muted)', overflowWrap: 'anywhere', minWidth: 0 }}>Note: {batch.note}</div>
          )}
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm font-medium" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)', cursor: 'pointer', minHeight: 36 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
