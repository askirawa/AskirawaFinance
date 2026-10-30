/**
 * ApprovalDetail — side drawer showing full request details, approval decisions,
 * approve/reject actions, and execution controls.
 *
 * Two execution modes selected at runtime:
 *
 *   TREASURY CONTRACT MODE (isTreasuryDeployed = true)
 *     Local vote/approval decisions remain for UI tracking, but the execution
 *     path calls the treasury contract's vote() and execute().
 *     USDC moves only through the treasury contract, after the required approvals.
 *
 *   LOCAL MODE (isTreasuryDeployed = false)
 *     Approval decisions are stored in localStorage only.
 *     Execution calls USDC.transfer() directly from the connected wallet —
 *     NOT protected by treasury approval.  Clearly disclosed.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  X, CheckCircle2, XCircle, PlayCircle, ArrowUpRight,
  AlertCircle, Info, Clock, Loader2, ShieldCheck, Lock,
} from 'lucide-react'
import { useAccount, useSwitchChain } from 'wagmi'
import Badge from '../ui/Badge'
import {
  type ApprovalRequest,
  type ApprovalPolicy,
  REQUEST_STATUS_LABELS,
  REQUEST_TYPE_LABELS,
  requestStatusVariant,
  getRequestStats,
  formatUsdcBigint,
  parseUsdcString,
  formatTs,
  formatAddr,
  formatRequestId,
  isAuthorizedApprover,
} from '../../lib/approvals'
import { useRequestExecutor } from '../../hooks/useApprovals'
import {
  isTreasuryDeployed,
  useTreasuryVote,
  useTreasuryExecute,
  useTreasuryProposal,
  useTreasuryConfig,
} from '../../hooks/useTreasury'
import { buildTxExplorerUrl } from '../../onchain-facts'
import { ARC_MAINNET_CHAIN_ID } from '../../config'
import { useNotifications } from '../../context/NotificationContext'

interface Props {
  request: ApprovalRequest
  policy: ApprovalPolicy
  onClose: () => void
  onApprove: (id: string, approverAddress: string, reason?: string) => void
  onReject: (id: string, approverAddress: string, reason: string) => void
  onCancel: (id: string) => void
  onUpdate: (req: ApprovalRequest) => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '10px 0', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-all', maxWidth: '100%', minWidth: 0 }}>{children}</span>
    </div>
  )
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmDanger,
  requireReason,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  confirmDanger?: boolean
  requireReason?: boolean
  onConfirm: (reason?: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 24, width: '100%', maxWidth: 360, maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>{message}</div>
        {requireReason && (
          <textarea
            placeholder="Reason (optional)"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            style={{ width: '100%', background: 'var(--surface-muted)', border: '1px solid var(--border)', padding: '10px', color: 'var(--ink)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', marginBottom: 16, outline: 'none' }}
          />
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, minHeight: 44, fontSize: 13, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>Go back</button>
          <button
            onClick={() => onConfirm(requireReason ? reason : undefined)}
            style={{ flex: 1, minHeight: 44, fontSize: 13, border: 'none', background: confirmDanger ? 'var(--danger)' : 'var(--accent)', color: confirmDanger ? '#fff' : 'var(--bg)', fontWeight: 600, cursor: 'pointer' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ApprovalDetail({ request, policy, onClose, onApprove, onReject, onCancel, onUpdate }: Props) {
  const { address, chainId } = useAccount()
  const { emit } = useNotifications()
  const { switchChain, isPending: isSwitching } = useSwitchChain() as { switchChain: (p: { chainId: number }) => void; isPending: boolean }
  const isWrongChain = chainId !== ARC_MAINNET_CHAIN_ID

  const stats = getRequestStats(request)

  // ── Local mode (no treasury) ───────────────────────────────────────────────
  const { isExecuting: isLocalExec, execError: localExecError, canExecute: localCanExec, executeRequest } =
    useRequestExecutor(request, policy, onUpdate, { onNotify: emit })
  const { ok: canLocalExec, reason: localExecBlockReason } = localCanExec()

  // ── On-chain treasury mode ─────────────────────────────────────────────────
  // Use the confirmed on-chain proposalId stored at propose time.
  // Never re-derive from the off-chain ID: a re-derived ID only matches if the
  // propose tx actually succeeded, and deriving it without checking would allow
  // vote/execute calls that revert with ProposalNotFound.
  const proposalId = isTreasuryDeployed
    ? (request.onChainProposalId ?? null)
    : null
  const isOnChainProposalMissing = isTreasuryDeployed && !request.onChainProposalId
  const { vote, isPending: isVoting, error: voteError } = useTreasuryVote()
  const { execute: treasuryExecute, isPending: isTreasuryExec, error: treasuryExecError } = useTreasuryExecute()

  // Read on-chain proposal state for accurate vote count when treasury is deployed
  const { proposal: onChainProposal, refetch: refetchOnChainProposal } = useTreasuryProposal(
    isTreasuryDeployed && proposalId ? proposalId : null
  )
  const { quorum: onChainQuorum } = useTreasuryConfig()

  const [voteHash, setVoteHash] = useState<string | null>(null)
  const [execHash, setExecHash] = useState<string | null>(null)
  const [treasuryErr, setTreasuryErr] = useState<string | null>(null)

  // useCallback wrapping tells the linter these are stable event handlers, not render-time calls
  const handleTreasuryVote = useCallback(async () => {
    if (!proposalId || !address) return
    setTreasuryErr(null)
    const hash = await vote(proposalId)
    if (hash) {
      setVoteHash(hash)
      // Record locally and refresh on-chain state
      onApprove(request.id, address)
      void refetchOnChainProposal()
    } else if (voteError) {
      setTreasuryErr(voteError)
    }
  }, [proposalId, address, vote, voteError, onApprove, request.id, refetchOnChainProposal])

  const handleTreasuryExecute = useCallback(async () => {
    if (!proposalId) return
    setTreasuryErr(null)
    let recipients: `0x${string}`[] = []
    let amounts: bigint[] = []
    try {
      recipients = [request.recipientAddress as `0x${string}`]
      amounts = [parseUsdcString(request.amountUsdc)]
    } catch {
      setTreasuryErr('The amount or recipient on this request is not valid, so nothing was sent. Create a new request with the correct details.')
      return
    }
    const hash = await treasuryExecute({ proposalId, recipients, amounts })
    const ts = Date.now()
    if (hash) {
      setExecHash(hash)
      onUpdate({ ...request, status: 'executed', txHash: hash, confirmedAt: ts, updatedAt: ts })
    } else if (treasuryExecError) {
      setTreasuryErr(treasuryExecError)
      onUpdate({ ...request, status: 'failed', errorMessage: treasuryExecError, updatedAt: ts })
    }
  }, [proposalId, request, treasuryExecute, treasuryExecError, onUpdate])

  // ── UI helpers ──────────────────────────────────────────────────────────────
  const isApprover = address ? isAuthorizedApprover(address, policy) : false
  const alreadyDecided = address
    ? request.decisions.some(d => d.approverAddress.toLowerCase() === address.toLowerCase())
    : false
  const canDecide = isApprover && !alreadyDecided && (request.status === 'pending' || request.status === 'partial')

  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | 'cancel' | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirmAction) setConfirmAction(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmAction, onClose])

  let amountRaw = 0n
  try { amountRaw = parseUsdcString(request.amountUsdc) } catch { /* noop */ }

  const explorerBase = 'https://explorer.arc.io'
  const activeError = isTreasuryDeployed ? (treasuryErr ?? voteError ?? treasuryExecError) : (request.errorMessage ?? localExecError)
  const isAnyPending = isVoting || isTreasuryExec || isLocalExec

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'flex-end' }}
      role="dialog"
      aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%', maxWidth: 520, height: '100%', maxHeight: '100dvh',
          background: 'var(--surface)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* Confirm dialogs overlay */}
        {confirmAction === 'approve' && address && (
          <ConfirmDialog
            title="Approve this request"
            message={isTreasuryDeployed
              ? `You are recording your approval of "${request.title}" in this browser. To count it with the treasury contract, also use the Vote button.`
              : `You are approving "${request.title}" for ${formatUsdcBigint(amountRaw)} USDC. This approval is saved in this browser only.`
            }
            confirmLabel="Approve"
            onConfirm={reason => { onApprove(request.id, address, reason); setConfirmAction(null) }}
            onCancel={() => setConfirmAction(null)}
          />
        )}
        {confirmAction === 'reject' && address && (
          <ConfirmDialog
            title="Reject this request"
            message="Add a reason if you can. A rejected request cannot be reopened."
            confirmLabel="Reject"
            confirmDanger
            requireReason
            onConfirm={reason => { onReject(request.id, address, reason ?? ''); setConfirmAction(null) }}
            onCancel={() => setConfirmAction(null)}
          />
        )}
        {confirmAction === 'cancel' && (
          <ConfirmDialog
            title="Cancel this request"
            message="This request will be cancelled and cannot be reopened."
            confirmLabel="Cancel request"
            confirmDanger
            onConfirm={() => { onCancel(request.id); setConfirmAction(null); onClose() }}
            onCancel={() => setConfirmAction(null)}
          />
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5" style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em' }}>
                {formatRequestId(request.id)}
              </span>
              <Badge variant={requestStatusVariant(request.status)}>
                {REQUEST_STATUS_LABELS[request.status]}
              </Badge>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3 }}>{request.title}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{REQUEST_TYPE_LABELS[request.type]}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 0' }}>

          {/* Mode banner */}
          {isTreasuryDeployed ? (
            isOnChainProposalMissing ? (
              <div className="flex items-start gap-3 p-4 mb-5" style={{ background: 'var(--warning-dim)', border: '1px solid var(--warning-border)' }}>
                <AlertCircle size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 12, color: 'var(--warning)', lineHeight: 1.5 }}>
                  <strong>Not sent to the treasury contract yet.</strong> This request is saved in this browser only.
                  Voting and sending are turned off until the request is confirmed by the contract.
                  Create a new request to submit it.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-4 mb-5" style={{ background: 'var(--success-dim)', border: '1px solid var(--success-dim)' }}>
                <Lock size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 12, color: 'var(--success)', lineHeight: 1.5 }}>
                  <strong>Checked by the treasury contract.</strong> This request is recorded on Arc Mainnet.
                  USDC is sent only after the required approvals are reached.
                </span>
              </div>
            )
          ) : (
            <div className="flex items-start gap-3 p-4 mb-5" style={{ background: 'var(--warning-dim)', border: '1px solid var(--warning-border)' }}>
              <Info size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 12, color: 'var(--warning)', lineHeight: 1.5 }}>
                <strong>Saved in this browser only.</strong> Approvals are not enforced by a contract.
                Sending pays USDC directly from your connected wallet, without the required approvals being checked.
                The treasury contract has not been set up yet.
              </span>
            </div>
          )}

          {/* Approval progress */}
          {(() => {
            // In treasury mode, use on-chain vote count when the proposal exists.
            // In local mode, use the local decisions count.
            const onChainCount = isTreasuryDeployed && onChainProposal ? onChainProposal.approvalCount : null
            const onChainTotal = isTreasuryDeployed && onChainQuorum ? onChainQuorum : null
            const displayCount = onChainCount ?? stats.approvedCount
            const displayTotal = onChainTotal ?? request.requiredApprovals
            const displayApproved = displayTotal > 0 && displayCount >= displayTotal
            const displayLabel = onChainCount !== null
              ? `${displayCount} of ${displayTotal} approval${displayTotal !== 1 ? 's' : ''} recorded`
              : stats.progressLabel
            return (
              <div className="p-4 mb-5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Approval progress</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: displayApproved ? 'var(--accent)' : 'var(--muted)' }}>{displayLabel}</span>
                </div>
                <div style={{ height: 6, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (displayCount / Math.max(1, displayTotal)) * 100)}%`,
                    background: stats.hasRejection ? 'var(--danger)' : displayApproved ? 'var(--accent)' : 'var(--warning)',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
                {onChainCount !== null && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                    Read from the treasury contract
                    {onChainProposal?.executed && <span style={{ color: 'var(--success)', marginLeft: 8 }}>✓ Sent</span>}
                    {onChainProposal?.cancelled && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>✗ Cancelled</span>}
                    {onChainProposal?.expiresAt && !onChainProposal.executed && !onChainProposal.cancelled && (
                      <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                        (expires {new Date(onChainProposal.expiresAt * 1000).toLocaleDateString()})
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Amount highlight */}
          <div className="p-4 mb-5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Payment amount</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif", overflowWrap: 'anywhere' }}>
              {formatUsdcBigint(amountRaw)} <span style={{ fontSize: 14, color: 'var(--muted)' }}>USDC</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              To: {formatAddr(request.recipientAddress)}
            </div>
          </div>

          {/* Details table */}
          <div style={{ marginBottom: 20 }}>
            <Row label="Request reference">{formatRequestId(request.id)}</Row>
            <Row label="Submitted by">{formatAddr(request.requesterAddress)}</Row>
            <Row label="Recipient">{formatAddr(request.recipientAddress)}</Row>
            <Row label="Created">{formatTs(request.createdAt)}</Row>
            {request.updatedAt !== request.createdAt && (
              <Row label="Updated">{formatTs(request.updatedAt)}</Row>
            )}
            {request.confirmedAt && <Row label="Sent">{formatTs(request.confirmedAt)}</Row>}
            {isTreasuryDeployed && request.onChainProposalId && (
              <Row label="Contract reference">
                <span title={request.onChainProposalId}>
                  {request.onChainProposalId.slice(0, 10)}…{request.onChainProposalId.slice(-6)}
                </span>
              </Row>
            )}
            {request.proposeTxHash && (
              <Row label="Submission transaction">
                <a
                  href={buildTxExplorerUrl(ARC_MAINNET_CHAIN_ID, request.proposeTxHash) ?? `${explorerBase}/tx/${request.proposeTxHash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1"
                  style={{ color: 'var(--accent)' }}
                >
                  {request.proposeTxHash.slice(0, 10)}…{request.proposeTxHash.slice(-6)}
                  <ArrowUpRight size={12} />
                </a>
              </Row>
            )}
            {(request.txHash ?? voteHash ?? execHash) && (
              <Row label="Transaction hash">
                <a
                  href={buildTxExplorerUrl(ARC_MAINNET_CHAIN_ID, (execHash ?? voteHash ?? request.txHash)!) ?? `${explorerBase}/tx/${execHash ?? voteHash ?? request.txHash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1"
                  style={{ color: 'var(--accent)' }}
                >
                  {((execHash ?? voteHash ?? request.txHash) as string).slice(0, 10)}…{((execHash ?? voteHash ?? request.txHash) as string).slice(-6)}
                  <ArrowUpRight size={12} />
                </a>
              </Row>
            )}
          </div>

          {/* Justification */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Business reason</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, background: 'var(--surface-muted)', border: '1px solid var(--border)', padding: '12px 14px', overflowWrap: 'anywhere' }}>
              {request.description || <em style={{ color: 'var(--subtle)' }}>No reason was given.</em>}
            </div>
          </div>

          {/* Decisions */}
          {request.decisions.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Decisions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {request.decisions.map((d, i) => (
                  <div key={i} className="flex items-start gap-3 p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                    {d.decision === 'approved'
                      ? <CheckCircle2 size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
                      : <XCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: d.decision === 'approved' ? 'var(--accent)' : 'var(--danger)' }}>
                          {d.decision === 'approved' ? 'Approved' : 'Rejected'}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{formatTs(d.timestamp)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{formatAddr(d.approverAddress)}</div>
                      {d.reason && <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4, fontStyle: 'italic' }}>"{d.reason}"</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {activeError && (
            <div className="flex items-start gap-3 p-4 mb-4" style={{ background: 'var(--danger-dim)', border: '1px solid var(--danger-border)' }}>
              <AlertCircle size={15} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13, color: 'var(--danger)', overflowWrap: 'anywhere', minWidth: 0 }}>{activeError}</span>
            </div>
          )}

          {/* Wrong-chain banner */}
          {isWrongChain && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 mb-4" style={{ background: 'var(--warning-dim)', border: '1px solid var(--warning-border)' }}>
              <span style={{ fontSize: 13, color: 'var(--warning)' }}>Your wallet is on the wrong network. Switch to Arc Mainnet to continue.</span>
              <button
                onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
                disabled={isSwitching}
                style={{ background: 'var(--warning)', border: 'none', minHeight: 44, padding: '0 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--bg)' }}
              >
                {isSwitching ? 'Switching…' : 'Switch to Arc Mainnet'}
              </button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Approve/Reject (always local decisions) */}
          {canDecide && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                onClick={() => setConfirmAction('reject')}
                style={{ minHeight: 44, fontSize: 13, fontWeight: 600, border: '1px solid var(--danger-border)', background: 'var(--danger-dim)', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <XCircle size={15} /> Reject
              </button>
              <button
                onClick={() => setConfirmAction('approve')}
                style={{ minHeight: 44, fontSize: 13, fontWeight: 600, border: 'none', background: 'var(--accent)', color: 'var(--bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <CheckCircle2 size={15} /> Approve
              </button>
            </div>
          )}

          {/* Already decided notice */}
          {alreadyDecided && !['executed', 'failed', 'cancelled', 'rejected'].includes(request.status) && (
            <div className="flex items-center gap-2 p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <ShieldCheck size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>You have already approved or rejected this request.</span>
            </div>
          )}

          {/* TREASURY CONTRACT MODE: Vote button (when proposal confirmed on-chain and status is pending/partial/approved) */}
          {isTreasuryDeployed && !isOnChainProposalMissing && !isWrongChain && (request.status === 'pending' || request.status === 'partial' || request.status === 'approved') && !request.decisions.some(d => d.approverAddress.toLowerCase() === (address ?? '').toLowerCase()) && (
            <button
              onClick={() => { void handleTreasuryVote() }}
              disabled={isVoting || !address}
              style={{
                width: '100%', minHeight: 48, fontSize: 14, fontWeight: 700,
                border: '1.5px solid var(--accent)', background: 'transparent',
                color: 'var(--accent)', cursor: address ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: isVoting ? 0.7 : 1,
              }}
            >
              {isVoting ? <><Loader2 size={16} className="animate-spin" /> Submitting your approval…</> : <><ShieldCheck size={16} /> Vote with the treasury contract</>}
            </button>
          )}

          {/* TREASURY CONTRACT MODE: Execute button (when approved, treasury deployed, proposal confirmed on-chain) */}
          {isTreasuryDeployed && !isOnChainProposalMissing && request.status === 'approved' && (
            <button
              onClick={() => { void handleTreasuryExecute() }}
              disabled={isTreasuryExec || isWrongChain || !address}
              style={{
                width: '100%', minHeight: 48, fontSize: 14, fontWeight: 700,
                border: 'none', background: (!isTreasuryExec && !isWrongChain && address) ? 'var(--accent)' : 'var(--surface-strong)',
                color: (!isTreasuryExec && !isWrongChain && address) ? 'var(--bg)' : 'var(--subtle)',
                cursor: (!isTreasuryExec && !isWrongChain && address) ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: isTreasuryExec ? 0.7 : 1,
              }}
            >
              {isTreasuryExec ? <><Loader2 size={16} className="animate-spin" /> Sending via treasury contract…</> : <><Lock size={16} /> Send via treasury contract</>}
            </button>
          )}

          {/* BROWSER-ONLY MODE: Send button (when approved, no treasury) */}
          {!isTreasuryDeployed && request.status === 'approved' && (
            <>
              <button
                onClick={() => { void executeRequest() }}
                disabled={isLocalExec || !canLocalExec}
                style={{
                  width: '100%', minHeight: 48, fontSize: 14, fontWeight: 700,
                  border: 'none', background: canLocalExec ? 'var(--accent)' : 'var(--surface-strong)',
                  color: canLocalExec ? 'var(--bg)' : 'var(--subtle)', cursor: canLocalExec ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: isLocalExec ? 0.7 : 1,
                }}
              >
                {isLocalExec ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : <><PlayCircle size={16} /> Send payment (direct transfer)</>}
              </button>
              {!canLocalExec && localExecBlockReason && (
                <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>{localExecBlockReason}</div>
              )}
            </>
          )}

          {/* Executing state */}
          {request.status === 'executing' && (
            <div className="flex items-center justify-center gap-3 py-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Waiting for confirmation…</span>
            </div>
          )}

          {/* Executed */}
          {request.status === 'executed' && (
            <div className="flex items-center justify-center gap-2 py-3" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}>
              <CheckCircle2 size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>Payment sent and confirmed</span>
            </div>
          )}

          {/* Pending — waiting for approvals */}
          {(request.status === 'pending' || request.status === 'partial') && !canDecide && !isAnyPending && (
            <div className="flex items-center gap-2 p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <Clock size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {stats.remainingApprovals} more approval{stats.remainingApprovals !== 1 ? 's' : ''} needed.
                {!isApprover && policy.approverAddresses.length > 0 && ' Your wallet is not on the list of allowed approvers.'}
              </span>
            </div>
          )}

          {/* Cancel */}
          {!['executed', 'failed', 'cancelled', 'rejected', 'executing'].includes(request.status) && (
            <button
              onClick={() => setConfirmAction('cancel')}
              style={{ minHeight: 44, fontSize: 12, background: 'none', border: '1px solid var(--border)', color: 'var(--subtle)', cursor: 'pointer' }}
            >
              Cancel request
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
