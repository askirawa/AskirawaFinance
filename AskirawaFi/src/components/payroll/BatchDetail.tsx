/**
 * BatchDetail — shows full details of a payroll batch including payment statuses,
 * tx hashes, and execution controls.
 */

import {
  X,
  ArrowUpRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Info,
  PlayCircle,
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
} from '../../lib/payroll'
import { useUsdcBalance, useBatchRunner } from '../../hooks/usePayroll'
import { buildTxExplorerUrl } from '../../onchain-facts'
import { ARC_MAINNET_CHAIN_ID } from '../../config'
import { useNotifications } from '../../context/NotificationContext'

interface BatchDetailProps {
  batch: PayrollBatch
  onClose: () => void
  onUpdate: (updated: PayrollBatch) => void
}

function PaymentRow({ payment, idx }: { payment: EmployeePayment; idx: number }) {
  const explorerUrl = payment.txHash
    ? buildTxExplorerUrl(ARC_MAINNET_CHAIN_ID, payment.txHash)
    : null

  const statusIcon = {
    pending: <Clock size={13} style={{ color: 'var(--muted)' }} />,
    processing: <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent)' }} />,
    confirmed: <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />,
    failed: <AlertCircle size={13} style={{ color: 'var(--danger)' }} />,
  }[payment.status]

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td className="px-5 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
        <span style={{ color: 'var(--subtle)', marginRight: 6, fontSize: 11 }}>#{idx + 1}</span>
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
              payment.status === 'failed' ? 'Failed' : 'Pending'}
          </Badge>
        </div>
        {payment.errorMessage && (
          <div className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>{payment.errorMessage}</div>
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

export default function BatchDetail({ batch, onClose, onUpdate }: BatchDetailProps) {
  const { isConnected, chainId, address } = useAccount()
  const { emit } = useNotifications()
  const { switchChain, isPending: isSwitching } = useSwitchChain() as {
    switchChain: (params: { chainId: number }) => void
    isPending: boolean
  }
  const { rawBalance, formatted: balanceFormatted } = useUsdcBalance()
  const isWrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID

  const stats = getBatchStats(batch)
  const pendingRaw = sumBatchAmounts(batch.payments.filter(p => p.status === 'pending'))
  const hasPending = batch.payments.some(p => p.status === 'pending')
  const hasEnoughBalance = rawBalance >= pendingRaw

  const { runBatch, isRunning, currentIndex, runError, canExecute } = useBatchRunner(
    batch, onUpdate, { onNotify: emit, actorAddress: address ?? undefined }
  )

  const executeCheck = canExecute()

  const isTerminal = batch.status === 'completed' || batch.status === 'failed'
  const canRun = hasPending && !isTerminal && !isRunning

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{ background: 'rgba(5,12,18,0.85)', backdropFilter: 'blur(6px)', padding: '32px 16px' }}
    >
      <div
        className="w-full max-w-4xl rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-2)', border: '1px solid var(--border-strong)' }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                {formatBatchId(batch.id)}
              </span>
              <Badge variant={batchStatusVariant(batch.status)}>
                {BATCH_STATUS_LABELS[batch.status]}
              </Badge>
            </div>
            <h2 className="display font-bold text-xl" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
              {batch.name}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              <span>Created {formatTs(batch.createdAt)}</span>
              {batch.createdBy && <span>by {batch.createdBy.slice(0, 6)}…{batch.createdBy.slice(-4)}</span>}
              {batch.scheduleType === 'scheduled' && batch.scheduledDate && (
                <span style={{ color: 'var(--warning)' }}>
                  Scheduled: {new Date(batch.scheduledDate).toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-lg transition-colors shrink-0"
            style={{
              width: 36,
              height: 36,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Stats row */}
        <div
          className="grid grid-cols-2 md:grid-cols-5 gap-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          {[
            { label: 'Employees', value: String(stats.employeeCount) },
            { label: 'Total', value: `${stats.totalFormatted} USDC` },
            { label: 'Confirmed', value: String(stats.confirmedCount) },
            { label: 'Pending', value: String(stats.pendingCount) },
            { label: 'Failed', value: String(stats.failedCount) },
          ].map(({ label, value }, i) => (
            <div
              key={label}
              className="px-5 py-3"
              style={{ borderRight: i < 4 ? '1px solid var(--border)' : 'none' }}
            >
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)', fontSize: 10 }}>{label}</div>
              <div className="font-bold mono text-sm display" style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Execution controls */}
        {canRun && (
          <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                {/* Balance check */}
                <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>
                  Your USDC balance:{' '}
                  <span className="font-semibold mono" style={{ color: hasEnoughBalance ? 'var(--accent)' : 'var(--danger)' }}>
                    {balanceFormatted ?? '—'} USDC
                  </span>
                  {' · '}
                  Pending total:{' '}
                  <span className="font-semibold mono" style={{ color: 'var(--ink-2)' }}>
                    {formatUsdcBigint(pendingRaw)} USDC
                  </span>
                </div>
                {!isConnected && (
                  <div className="text-xs" style={{ color: 'var(--warning)' }}>Connect wallet to execute</div>
                )}
                {isConnected && isWrongChain && (
                  <div className="text-xs" style={{ color: 'var(--warning)' }}>Switch to Arc Mainnet to execute</div>
                )}
                {isConnected && !isWrongChain && !hasEnoughBalance && (
                  <div className="text-xs" style={{ color: 'var(--danger)' }}>Insufficient USDC balance</div>
                )}
                {runError && (
                  <div className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{runError}</div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isWrongChain && (
                  <button
                    onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
                    disabled={isSwitching}
                    className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold"
                    style={{
                      background: 'var(--warning)',
                      color: '#0d1810',
                      border: 'none',
                      cursor: isSwitching ? 'not-allowed' : 'pointer',
                      minHeight: 38,
                      opacity: isSwitching ? 0.7 : 1,
                    }}
                  >
                    {isSwitching ? 'Switching…' : 'Switch Network'}
                  </button>
                )}

                <button
                  onClick={() => { void runBatch() }}
                  disabled={!executeCheck.ok || isRunning}
                  className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-opacity"
                  style={{
                    background: executeCheck.ok && !isRunning ? 'var(--accent)' : 'var(--surface-muted)',
                    color: executeCheck.ok && !isRunning ? '#021a0e' : 'var(--subtle)',
                    border: 'none',
                    cursor: executeCheck.ok && !isRunning ? 'pointer' : 'not-allowed',
                    minHeight: 38,
                  }}
                >
                  {isRunning ? (
                    <>
                      <Spinner size={14} />
                      Executing {currentIndex !== null ? `(${currentIndex + 1}/${stats.pendingCount})` : '…'}
                    </>
                  ) : (
                    <>
                      <PlayCircle size={15} />
                      {batch.scheduleType === 'scheduled' ? 'Execute Now' : 'Execute Payroll'}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Live progress */}
            {isRunning && currentIndex !== null && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
                  <span>Processing payment {currentIndex + 1} of {stats.pendingCount}</span>
                  <span>
                    {Math.round((currentIndex / Math.max(stats.pendingCount, 1)) * 100)}%
                  </span>
                </div>
                <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--surface-muted)' }}>
                  <div
                    className="rounded-full transition-all"
                    style={{
                      height: 4,
                      background: 'var(--accent)',
                      width: `${Math.round((currentIndex / Math.max(stats.pendingCount, 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Scheduling notice */}
            {batch.scheduleType === 'scheduled' && batch.scheduledDate && !isRunning && (
              <div
                className="flex items-start gap-2 mt-3 rounded-xl p-3 text-xs"
                style={{ background: 'rgba(232,184,76,0.06)', border: '1px solid rgba(232,184,76,0.15)', color: 'var(--warning)' }}
              >
                <Info size={13} className="mt-0.5 shrink-0" />
                <span>
                  This batch was scheduled for {new Date(batch.scheduledDate).toLocaleString()}.
                  It has not executed automatically — click <strong>Execute Now</strong> to run it manually.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Payment table */}
        <div className="overflow-x-auto" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
          <table className="w-full" style={{ minWidth: 700 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr style={{ background: 'var(--bg-2)' }}>
                {['Employee', 'Wallet', 'Amount', 'Status', 'Tx Hash', 'Confirmed At'].map(h => (
                  <th
                    key={h}
                    className="text-left text-xs uppercase tracking-wider px-5 py-3"
                    style={{ color: 'var(--subtle)', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: '0.07em' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batch.payments.map((payment, idx) => (
                <PaymentRow key={payment.id} payment={payment} idx={idx} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-6 py-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {batch.note && (
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Note: {batch.note}
            </div>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded-lg px-4 py-2 text-sm font-medium"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--ink-2)',
              cursor: 'pointer',
              minHeight: 36,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
