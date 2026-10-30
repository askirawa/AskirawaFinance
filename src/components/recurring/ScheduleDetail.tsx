/**
 * ScheduleDetail — drawer/panel showing full schedule state,
 * execution controls, and history.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  X,
  ArrowUpRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Info,
  PlayCircle,
  PauseCircle,
  StopCircle,
  Shield,
  Send,
  Vote,
  ShieldCheck,
} from 'lucide-react'
import { useAccount, useSwitchChain } from 'wagmi'
import Spinner from '../ui/Spinner'
import Badge from '../ui/Badge'
import {
  type RecurringSchedule,
  type ExecutionRecord,
  SCHEDULE_STATUS_LABELS,
  FREQUENCY_LABELS,
  EXECUTION_STATUS_LABELS,
  scheduleStatusVariant,
  executionStatusVariant,
  formatUsdcBigint,
  parseUsdcString,
  formatTs,
  formatScheduleId,
  nextExecutionDate,
  upcomingExecutions,
  projectedTotal,
} from '../../lib/recurring'
import { useUsdcBalance, useScheduleRunner } from '../../hooks/useRecurring'
import {
  isTreasuryDeployed,
  useTreasuryRecurringPropose,
  useTreasuryVote,
  useVoteEligibility,
  useTreasuryProposal,
  useTreasuryConfig,
} from '../../hooks/useTreasury'
import { buildTxExplorerUrl } from '../../onchain-facts'
import { ARC_MAINNET_CHAIN_ID } from '../../config'
import { useNotifications } from '../../context/NotificationContext'
import { logAuditEvent } from '../../lib/audit'
import { generateId } from '../../lib/recurring'

const CHAIN_ID = ARC_MAINNET_CHAIN_ID

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '8px 0',
        borderBottom: '1px solid var(--border)',
        gap: 16,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, textAlign: 'right', overflowWrap: 'anywhere', minWidth: 0 }}>
        {value}
      </span>
    </div>
  )
}

function ExecutionRow({ exec, chainId }: { exec: ExecutionRecord; chainId?: number }) {
  const txUrl =
    exec.txHash && chainId
      ? buildTxExplorerUrl(chainId, exec.txHash)
      : null

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>
          {exec.executedAt ? formatTs(exec.executedAt) : formatTs(exec.scheduledFor)}
        </div>
        {exec.errorMessage && (
          <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2, overflowWrap: 'anywhere' }}>{exec.errorMessage}</div>
        )}
        {exec.txHash && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'monospace' }}>
            {exec.txHash.slice(0, 10)}…{exec.txHash.slice(-6)}
          </div>
        )}
      </div>

      <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {exec.amountUsdc} USDC
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Badge variant={executionStatusVariant(exec.status)}>
          {EXECUTION_STATUS_LABELS[exec.status]}
        </Badge>
        {txUrl && (
          <a
            href={txUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="View transaction on the explorer"
            aria-label="View transaction on the explorer"
            style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', minWidth: 40, minHeight: 40, justifyContent: 'center' }}
          >
            <ArrowUpRight size={13} />
          </a>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ScheduleDetailProps {
  schedule: RecurringSchedule
  onClose: () => void
  onUpdate: (updated: RecurringSchedule) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
}

export default function ScheduleDetail({
  schedule,
  onClose,
  onUpdate,
  onPause,
  onResume,
  onCancel,
}: ScheduleDetailProps) {
  const { isConnected, address, chainId } = useAccount()
  const { emit } = useNotifications()
  const { switchChain, isPending: isSwitching } = useSwitchChain() as {
    switchChain: (params: { chainId: number }) => void
    isPending: boolean
  }

  const { formatted: balanceFormatted } = useUsdcBalance()

  const { executeNow, isExecuting, execError, canExecute, isWrongChain } = useScheduleRunner(
    schedule,
    (updated) => { onUpdate(updated) },
    { onNotify: emit, actorAddress: address ?? undefined }
  )

  const { ok: canExec, reason: cannotReason } = canExecute()
  const nextExec = nextExecutionDate(schedule)
  const upcoming = upcomingExecutions(schedule, 3)
  const projected = projectedTotal(schedule)
  const isWrongChainBool = chainId !== CHAIN_ID

  // ── Treasury hooks (only active when VITE_TREASURY_ADDRESS is set) ────────────
  const { proposeExecution, executeExecution, isPending: isTreasuryPending, error: treasuryError } = useTreasuryRecurringPropose()
  const { vote: castVote, isPending: isVoting, error: voteError } = useTreasuryVote()
  const { quorum } = useTreasuryConfig()
  const [treasuryLocalError, setTreasuryLocalError] = useState<string | null>(null)
  const [isTreasuryExecuting, setIsTreasuryExecuting] = useState(false)

  // Find the most recent execution record that has a treasury proposal for this schedule.
  // We use the LATEST proposed record to show vote/execute controls.
  const latestProposedExec = [...schedule.executionHistory]
    .sort((a, b) => (b.executedAt ?? 0) - (a.executedAt ?? 0))
    .find(e => !!e.treasuryProposalId && e.status !== 'confirmed' && e.status !== 'failed')

  const activeProposalId = (latestProposedExec?.treasuryProposalId as `0x${string}` | undefined) ?? null
  const { proposal: activeProposal, refetch: refetchProposal } = useTreasuryProposal(activeProposalId)

  const approvalCount = activeProposal?.approvalCount ?? 0
  const effectiveQuorum = quorum ?? 1
  const quorumReached = approvalCount >= effectiveQuorum
  const { canVote, reason: voteBlockedReason } = useVoteEligibility(activeProposalId)

  // ── Treasury: propose this period ─────────────────────────────────────────────
  const handleTreasuryPropose = useCallback(async () => {
    setTreasuryLocalError(null)
    if (!address) { setTreasuryLocalError('Your wallet is not connected. Connect it and try again.'); return }
    if (isWrongChainBool) { setTreasuryLocalError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return }

    // Duplicate period check: block if an existing proposed/processing exec exists
    // Allow re-proposal if the active on-chain proposal is cancelled or executed
    // (the local record may not yet reflect the on-chain cancellation).
    const onChainActiveIsClearedOnChain = activeProposal?.cancelled || activeProposal?.executed
    const alreadyProposed = schedule.executionHistory.some(
      e => !!e.treasuryProposalId && e.status !== 'failed' && e.status !== 'skipped'
    ) && !onChainActiveIsClearedOnChain
    if (alreadyProposed) {
      setTreasuryLocalError(
        'This schedule already has an approval request. ' +
        'Approve or send the existing request before creating a new one. ' +
        'If it was cancelled elsewhere, click Refresh status to update this page.'
      )
      return
    }

    let rawAmount: bigint
    try {
      rawAmount = parseUsdcString(schedule.amountUsdc)
    } catch (e) {
      setTreasuryLocalError((e as Error).message)
      return
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400 // 7 days
    const execId = generateId()
    const now = Date.now()

    // Create a local execution record in 'processing' state immediately
    const processingRecord = {
      id: execId,
      scheduledFor: nextExec?.getTime() ?? now,
      executedAt: now,
      status: 'processing' as const,
      amountUsdc: schedule.amountUsdc,
    }
    onUpdate({
      ...schedule,
      executionHistory: [...schedule.executionHistory, processingRecord],
    })

    const result = await proposeExecution({
      offChainExecId: execId,
      recipient: schedule.recipientAddress as `0x${string}`,
      amount: rawAmount,
      expiresAt,
    })

    if (!result) {
      // Roll back the processing record to failed
      onUpdate({
        ...schedule,
        executionHistory: schedule.executionHistory.map(e =>
          e.id === execId
            ? { ...e, status: 'failed' as const, errorMessage: treasuryError ?? 'The approval request could not be sent. Try again.' }
            : e
        ),
      })
      return
    }

    // Persist the frozen payload and proposal ID
    onUpdate({
      ...schedule,
      executionHistory: schedule.executionHistory.map(e =>
        e.id === execId
          ? {
              ...e,
              status: 'pending' as const,
              treasuryProposalId: result.proposalId,
              treasuryProposeTxHash: result.hash,
              treasuryExpiresAt: expiresAt,
              treasuryRecipient: result.frozenRecipient,
              treasuryAmountRaw: result.frozenAmount.toString(),
            }
          : e
      ),
    })
    void refetchProposal()

    emit({
      id: `recurring-proposed-${execId}-${Date.now()}`,
      category: 'recurring',
      severity: 'info',
      title: 'Payment sent for approval',
      description: `Recurring payment "${schedule.name}" was sent for approval.`,
      timestamp: Date.now(),
      read: false,
      txHash: result.hash,
    })
    logAuditEvent({
      category: 'recurring',
      action: 'recurring_execution_submitted',
      actorAddress: address ?? null,
      description: `Recurring payment "${schedule.name}" was sent for approval. Request ID: ${result.proposalId.slice(0, 10)}…`,
      outcome: 'success',
      entityId: schedule.id,
      entityLabel: schedule.name,
      txHash: result.hash,
    })
  }, [address, isWrongChainBool, schedule, nextExec, proposeExecution, onUpdate, refetchProposal, emit, treasuryError, activeProposal])

  // ── Treasury: vote ────────────────────────────────────────────────────────────
  const handleTreasuryVote = useCallback(async () => {
    setTreasuryLocalError(null)
    if (!activeProposalId) { setTreasuryLocalError('There is no open approval request for this schedule. Request approval first.'); return }
    const txHash = await castVote(activeProposalId)
    if (!txHash) return
    void refetchProposal()
    emit({ id: `recurring-voted-${activeProposalId}-${Date.now()}`, category: 'recurring', severity: 'info', title: 'Approval recorded', description: `Your approval for the "${schedule.name}" payment was recorded.`, timestamp: Date.now(), read: false, txHash })
  }, [activeProposalId, castVote, refetchProposal, emit, schedule.name])

  // ── Treasury: execute ─────────────────────────────────────────────────────────
  const handleTreasuryExecute = useCallback(async () => {
    setTreasuryLocalError(null)
    if (!activeProposalId || !latestProposedExec) { setTreasuryLocalError('There is no open approval request for this schedule. Request approval first.'); return }
    if (!latestProposedExec.treasuryRecipient || !latestProposedExec.treasuryAmountRaw) {
      setTreasuryLocalError('The approved payment details are missing from this browser. Request approval again.')
      return
    }
    setIsTreasuryExecuting(true)
    try {
      const txHash = await executeExecution({
        proposalId: activeProposalId,
        frozenRecipient: latestProposedExec.treasuryRecipient as `0x${string}`,
        frozenAmount: BigInt(latestProposedExec.treasuryAmountRaw),
      })
      if (!txHash) return

      const confirmedAt = Date.now()
      const confirmedCount = schedule.executionHistory.filter(e => e.status === 'confirmed').length + 1
      const isNowComplete = schedule.maxExecutions != null && confirmedCount >= schedule.maxExecutions

      onUpdate({
        ...schedule,
        status: isNowComplete ? 'completed' : schedule.status,
        completedAt: isNowComplete ? confirmedAt : undefined,
        executionHistory: schedule.executionHistory.map(e =>
          e.id === latestProposedExec.id
            ? { ...e, status: 'confirmed' as const, txHash, executedAt: confirmedAt, treasuryExecuteTxHash: txHash }
            : e
        ),
      })
      void refetchProposal()

      emit({ id: `recurring-exec-${latestProposedExec.id}-${Date.now()}`, category: 'recurring', severity: 'success', title: 'Payment sent', description: `Recurring payment "${schedule.name}" was sent through the treasury contract.`, timestamp: confirmedAt, read: false, txHash })
      logAuditEvent({
        category: 'recurring',
        action: 'recurring_execution_confirmed',
        actorAddress: address ?? null,
        description: `Recurring payment "${schedule.name}" was sent through the treasury contract. Transaction: ${txHash.slice(0, 10)}…`,
        outcome: 'success',
        entityId: schedule.id,
        entityLabel: schedule.name,
        txHash,
      })
    } finally {
      setIsTreasuryExecuting(false)
    }
  }, [activeProposalId, latestProposedExec, executeExecution, schedule, onUpdate, refetchProposal, emit, address])

  const displayTreasuryError = treasuryLocalError || treasuryError || voteError

  // Stats
  const confirmedCount = schedule.executionHistory.filter(e => e.status === 'confirmed').length
  const failedCount = schedule.executionHistory.filter(e => e.status === 'failed').length
  const totalPaidRaw = schedule.executionHistory
    .filter(e => e.status === 'confirmed')
    .reduce((acc, e) => {
      try { return acc + parseUsdcString(e.amountUsdc) } catch { return acc }
    }, 0n)

  const sorted = [...schedule.executionHistory].sort((a, b) => (b.executedAt ?? 0) - (a.executedAt ?? 0))

  const busy = isExecuting || isTreasuryPending || isVoting || isTreasuryExecuting

  useEffect(() => {
    if (busy) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        padding: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recurring payment details"
        style={{
          width: 'min(480px, 100%)',
          height: '100%',
          maxHeight: '100dvh',
          overflowY: 'auto',
          background: 'var(--surface-elevated)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            position: 'sticky',
            top: 0,
            background: 'var(--surface-elevated)',
            zIndex: 1,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{schedule.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                {formatScheduleId(schedule.id)}
              </span>
              <Badge variant={scheduleStatusVariant(schedule.status)}>
                {SCHEDULE_STATUS_LABELS[schedule.status]}
              </Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Key stats */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(120px, 100%), 1fr))',
              gap: 12,
            }}
          >
            {[
              { label: 'Confirmed', value: confirmedCount.toString() },
              { label: 'Failed', value: failedCount.toString() },
              { label: 'Total paid', value: `${formatUsdcBigint(totalPaidRaw)} USDC` },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 0,
                  padding: '12px',
                  minWidth: 0,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Execute payment section */}
          {(schedule.status === 'active') && (
            <div style={{ background: 'var(--surface)', border: `1px solid ${isTreasuryDeployed ? 'var(--accent-border)' : 'var(--border)'}`, borderRadius: 0, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {isTreasuryDeployed
                  ? <Shield size={14} style={{ color: 'var(--accent)' }} />
                  : <PlayCircle size={14} style={{ color: 'var(--muted)' }} />
                }
                <span style={{ fontSize: 13, fontWeight: 600, color: isTreasuryDeployed ? 'var(--accent)' : 'var(--ink)' }}>
                  {isTreasuryDeployed ? 'Approval required' : 'Send payment'}
                </span>
              </div>

              {!isConnected ? (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>Connect your wallet to {isTreasuryDeployed ? 'request approval for a payment.' : 'send payments.'}</div>
              ) : isWrongChain ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <AlertCircle size={14} style={{ color: 'var(--warning)' }} />
                  <span style={{ fontSize: 13, color: 'var(--warning)' }}>Your wallet is on the wrong network. Switch to Arc Mainnet to continue.</span>
                  <button onClick={() => switchChain({ chainId: CHAIN_ID })} disabled={isSwitching} style={{ padding: '4px 14px', minHeight: 44, background: 'var(--warning)', border: 'none', borderRadius: 0, color: '#0d1810', fontSize: 12, fontWeight: 600, cursor: isSwitching ? 'not-allowed' : 'pointer' }}>
                    {isSwitching ? 'Switching…' : 'Switch to Arc Mainnet'}
                  </button>
                </div>
              ) : isTreasuryDeployed ? (
                /* ── Treasury mode ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Each payment needs its own approval. Request approval, collect the required approvals, then send the payment.
                    The recipient and amount are locked when you request approval.
                    Nothing is sent automatically, so you still send the payment yourself after it is approved.
                  </div>

                  {displayTreasuryError && (
                    <div style={{ padding: '8px 12px', background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)', borderRadius: 0, fontSize: 12, color: 'var(--danger)', display: 'flex', gap: 8, alignItems: 'flex-start', overflowWrap: 'anywhere' }}>
                      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                      {displayTreasuryError}
                    </div>
                  )}

                  {/* Active proposal info */}
                  {latestProposedExec && (
                    <div style={{ padding: '10px 12px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 0, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--muted)' }}>Approval request ID</span>
                        <span className="mono" style={{ color: 'var(--ink)' }} title={latestProposedExec.treasuryProposalId}>
                          {latestProposedExec.treasuryProposalId!.slice(0, 10)}…{latestProposedExec.treasuryProposalId!.slice(-6)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--muted)' }}>Approvals</span>
                        <span style={{ color: quorumReached ? 'var(--success)' : 'var(--ink)' }}>
                          {approvalCount} of {effectiveQuorum}{quorumReached ? ' ✓' : ''}
                        </span>
                      </div>
                      {latestProposedExec.treasuryProposeTxHash && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--muted)' }}>Approval request transaction</span>
                          <a href={buildTxExplorerUrl(CHAIN_ID, latestProposedExec.treasuryProposeTxHash) ?? '#'} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {latestProposedExec.treasuryProposeTxHash.slice(0, 10)}…
                            <ArrowUpRight size={11} />
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {/* Request approval (only if no open request) */}
                    {!latestProposedExec && (
                      <button
                        onClick={() => { void handleTreasuryPropose() }}
                        disabled={isTreasuryPending || !address}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', minHeight: 44, background: (isTreasuryPending || !address) ? 'var(--surface-muted)' : 'var(--accent)', border: 'none', borderRadius: 0, color: (isTreasuryPending || !address) ? 'var(--muted)' : 'var(--bg)', fontSize: 12, fontWeight: 700, cursor: (isTreasuryPending || !address) ? 'not-allowed' : 'pointer' }}
                      >
                        {isTreasuryPending ? <><Spinner size={12} /> Requesting approval…</> : <><Send size={12} /> Request approval</>}
                      </button>
                    )}
                    {/* Approve */}
                    {latestProposedExec && !quorumReached && canVote && (
                      <button
                        onClick={() => { void handleTreasuryVote() }}
                        disabled={isVoting || !address}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', minHeight: 44, background: (isVoting || !address) ? 'var(--surface-muted)' : 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 0, color: (isVoting || !address) ? 'var(--muted)' : 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: (isVoting || !address) ? 'not-allowed' : 'pointer' }}
                      >
                        {isVoting ? <><Spinner size={12} /> Approving…</> : <><Vote size={12} /> Approve payment</>}
                      </button>
                    )}
                    {latestProposedExec && !quorumReached && !canVote && voteBlockedReason && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>{voteBlockedReason}</div>
                    )}
                    {/* Send */}
                    {latestProposedExec && quorumReached && (
                      <button
                        onClick={() => { void handleTreasuryExecute() }}
                        disabled={isTreasuryExecuting || !address}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', minHeight: 44, background: (isTreasuryExecuting || !address) ? 'var(--surface-muted)' : 'var(--accent)', border: 'none', borderRadius: 0, color: (isTreasuryExecuting || !address) ? 'var(--muted)' : 'var(--bg)', fontSize: 12, fontWeight: 700, cursor: (isTreasuryExecuting || !address) ? 'not-allowed' : 'pointer' }}
                      >
                        {isTreasuryExecuting ? <><Spinner size={12} /> Sending…</> : <><ShieldCheck size={12} /> Send payment</>}
                      </button>
                    )}
                    {latestProposedExec && (
                      <button onClick={() => { void refetchProposal() }} style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 0, minHeight: 44, padding: '8px 12px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
                        Refresh status
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* ── Personal-wallet mode ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                    <span>Your wallet balance</span>
                    <span style={{ color: 'var(--ink)' }}>{balanceFormatted ? `${balanceFormatted} USDC` : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                    <span>Amount per payment</span>
                    <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{schedule.amountUsdc} USDC</span>
                  </div>

                  {execError && (
                    <div style={{ padding: '8px 12px', background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)', borderRadius: 0, fontSize: 12, color: 'var(--danger)', display: 'flex', gap: 8, alignItems: 'flex-start', overflowWrap: 'anywhere' }}>
                      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                      {execError}
                    </div>
                  )}

                  <button
                    onClick={() => { void executeNow(nextExec?.getTime()) }}
                    disabled={isExecuting || !canExec}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', minHeight: 44, background: canExec && !isExecuting ? 'var(--accent)' : 'var(--surface-muted)', border: 'none', borderRadius: 0, color: canExec && !isExecuting ? 'var(--bg)' : 'var(--muted)', fontSize: 13, fontWeight: 700, cursor: canExec && !isExecuting ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}
                  >
                    {isExecuting
                      ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />Sending…</>
                      : <><PlayCircle size={14} />Send payment now</>
                    }
                  </button>

                  {!canExec && cannotReason && !isWrongChain && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>{cannotReason}</div>
                  )}

                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 12px', background: 'rgba(232,184,76,0.06)', borderRadius: 0, fontSize: 11, color: 'var(--muted)' }}>
                    <Info size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--warning)' }} />
                    This payment comes from your own wallet and does not need approval because the treasury contract has not been set up yet. Payments are not sent automatically.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Upcoming executions */}
          {upcoming.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Upcoming payments
              </div>
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 0,
                  overflow: 'hidden',
                }}
              >
                {upcoming.map((d, i) => (
                  <div
                    key={d.getTime()}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 8,
                      padding: '10px 14px',
                      borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Clock size={12} style={{ color: 'var(--muted)' }} />
                      <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                        {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {schedule.amountUsdc} USDC · not sent yet
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule details */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Schedule details
            </div>
            <InfoRow label="Recipient" value={<span style={{ fontFamily: 'monospace', fontSize: 11, overflowWrap: 'anywhere' }}>{schedule.recipientAddress}</span>} />
            <InfoRow label="Amount per payment" value={`${schedule.amountUsdc} USDC`} />
            <InfoRow label="How often" value={FREQUENCY_LABELS[schedule.frequency]} />
            <InfoRow
              label="Start date"
              value={`${schedule.startDate} at ${schedule.startTime}`}
            />
            <InfoRow label="End date" value={schedule.endDate || 'None (keeps going until cancelled)'} />
            <InfoRow label="Number of payments" value={schedule.maxExecutions?.toString() ?? 'No limit'} />
            {projected != null && (
              <InfoRow label="Total if all payments are made" value={`${formatUsdcBigint(projected)} USDC`} />
            )}
            <InfoRow label="Description" value={schedule.description || '—'} />
            <InfoRow
              label="Created"
              value={formatTs(schedule.createdAt)}
            />
            {schedule.pausedAt && <InfoRow label="Paused" value={formatTs(schedule.pausedAt)} />}
            {schedule.cancelledAt && <InfoRow label="Cancelled" value={formatTs(schedule.cancelledAt)} />}
            {schedule.completedAt && <InfoRow label="Completed" value={formatTs(schedule.completedAt)} />}
          </div>

          {/* Actions */}
          {(schedule.status === 'active' || schedule.status === 'paused') && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {schedule.status === 'active' && (
                <button
                  onClick={() => onPause(schedule.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    minHeight: 44,
                    flex: 1,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 0,
                    color: 'var(--warning)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    justifyContent: 'center',
                  }}
                >
                  <PauseCircle size={13} />
                  Pause schedule
                </button>
              )}
              {schedule.status === 'paused' && (
                <button
                  onClick={() => onResume(schedule.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    minHeight: 44,
                    flex: 1,
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-border)',
                    borderRadius: 0,
                    color: 'var(--accent)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    justifyContent: 'center',
                  }}
                >
                  <PlayCircle size={13} />
                  Resume schedule
                </button>
              )}
              <button
                onClick={() => {
                  if (confirm('Cancel this recurring schedule? No more payments will be planned. Payments already sent are not affected.')) {
                    onCancel(schedule.id)
                    onClose()
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                    minHeight: 44,
                  background: 'none',
                  border: '1px solid rgba(232,109,122,0.3)',
                  borderRadius: 0,
                  color: 'var(--danger)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <StopCircle size={13} />
                Cancel schedule
              </button>
            </div>
          )}

          {/* Execution history */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Payment history ({schedule.executionHistory.length})
            </div>
            {sorted.length === 0 ? (
              <div
                style={{
                  padding: '24px 0',
                  textAlign: 'center',
                  color: 'var(--subtle)',
                  fontSize: 13,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Clock size={20} />
                No payments sent yet.
              </div>
            ) : (
              sorted.map(exec => (
                <ExecutionRow key={exec.id} exec={exec} chainId={CHAIN_ID} />
              ))
            )}
          </div>

          {/* Status icon summary */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 0,
              fontSize: 12,
              color: 'var(--muted)',
            }}
          >
            {schedule.status === 'active' ? (
              <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} />
            ) : schedule.status === 'paused' ? (
              <PauseCircle size={14} style={{ color: 'var(--warning)' }} />
            ) : (
              <StopCircle size={14} style={{ color: 'var(--subtle)' }} />
            )}
            <span>
              Status:{' '}
              <strong style={{ color: 'var(--ink)' }}>
                {SCHEDULE_STATUS_LABELS[schedule.status]}
              </strong>
              {schedule.status === 'active' && nextExec && (
                <> · Next payment: {nextExec.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
