/**
 * ApprovalRequestModal — create a new treasury approval request.
 *
 * Two modes, selected at runtime by isTreasuryDeployed:
 *
 *   ON-CHAIN MODE (isTreasuryDeployed = true)
 *     Step 1: collect details (including expiry days)
 *     Step 2: review
 *     Step 3: wallet confirmation — calls treasury.proposeTransfer() and waits
 *             for the transaction receipt before reporting success.
 *     Only after the receipt is confirmed does the modal:
 *       - store the local record with onChainProposalId + proposeTxHash
 *       - show the success screen
 *     A failed or rejected transaction is shown as an error; the modal stays open.
 *
 *   LOCAL MODE (isTreasuryDeployed = false)
 *     Step 1: collect details
 *     Step 2: review
 *     Confirm: saves to localStorage only. Clearly labeled as not on-chain enforced.
 *
 * Proposal ID derivation (on-chain mode):
 *   proposalId = keccak256(encodePacked(offChainId, chainId, contractAddress))
 *   The off-chain record ID is generated first, then used to derive the proposalId,
 *   so the two are permanently linked. The proposalId is stored on the local record.
 *
 * Expiry (on-chain mode):
 *   Defaults to 7 days. User can choose 1–30 days.
 *   Passed as a unix timestamp (seconds) to proposeTransfer.
 *   The contract enforces [now+1h, now+30d].
 */

import { useState, useCallback, useEffect } from 'react'
import { X, AlertCircle, Info, Lock, ChevronRight, ChevronLeft, CheckCircle2, Loader2, ExternalLink } from 'lucide-react'
import { useAccount } from 'wagmi'
import {
  type RequestType,
  validateApprovalRequest,
  formatUsdcBigint,
  parseUsdcString,
  requiresApproval,
  type ApprovalPolicy,
  REQUEST_TYPE_LABELS,
  generateId,
} from '../../lib/approvals'
import {
  isTreasuryDeployed,
  useTreasuryPropose,
} from '../../hooks/useTreasury'
import { ARC_MAINNET_CHAIN_ID } from '../../config'

interface SubmitResult {
  title: string
  type: RequestType
  recipientAddress: string
  amountUsdc: string
  description: string
  requiredApprovals: number
  requesterAddress: string
  /** Set when treasury is deployed and propose tx confirmed */
  onChainProposalId?: `0x${string}`
  proposeTxHash?: string
  onChainExpiresAt?: number
}

interface Props {
  policy: ApprovalPolicy
  onSubmit: (fields: SubmitResult) => void
  onClose: () => void
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
      {children}
      {required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
    </label>
  )
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return (
    <div className="flex items-center gap-1.5 mt-1.5" style={{ color: 'var(--danger)', fontSize: 12 }}>
      <AlertCircle size={12} />
      {msg}
    </div>
  )
}

function Field({ label, error, required, children }: { label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
      <FieldError msg={error} />
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-muted)', border: '1px solid var(--border)',
  minHeight: 44, padding: '10px 12px', color: 'var(--ink)', fontSize: 14,
  outline: 'none', boxSizing: 'border-box',
}

// ─── Step 1: Request details ──────────────────────────────────────────────────

interface FormState {
  title: string
  type: RequestType
  recipientAddress: string
  amountUsdc: string
  description: string
  expiryDays: number   // on-chain mode only: 1–30
}

const EMPTY: FormState = {
  title: '',
  type: 'transfer',
  recipientAddress: '',
  amountUsdc: '',
  description: '',
  expiryDays: 7,
}

function StepDetails({
  form,
  errors,
  policy,
  onUpdate,
}: {
  form: FormState
  errors: ReturnType<typeof validateApprovalRequest>['errors']
  policy: ApprovalPolicy
  onUpdate: (k: keyof FormState, v: string | number) => void
}) {
  let amountRaw = 0n
  try { amountRaw = parseUsdcString(form.amountUsdc) } catch { /* noop */ }
  const needsApproval = requiresApproval(form.amountUsdc, policy)
  const showThresholdNote = form.amountUsdc.trim() && !isNaN(Number(form.amountUsdc))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Field label="Title" error={errors.title} required>
        <input
          style={inputStyle}
          placeholder="For example: Q4 vendor payment to Acme Corp"
          value={form.title}
          onChange={e => onUpdate('title', e.target.value)}
          maxLength={120}
        />
      </Field>

      <Field label="Type" required>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: 8 }}>
          {(['transfer', 'payroll_batch', 'recurring_schedule', 'other'] as RequestType[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onUpdate('type', t)}
              style={{
                padding: '0 12px',
                minHeight: 44,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: form.type === t ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                background: form.type === t ? 'var(--accent-dim)' : 'var(--surface-muted)',
                color: form.type === t ? 'var(--accent)' : 'var(--muted)',
                textAlign: 'left',
              }}
            >
              {REQUEST_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Recipient wallet address" error={errors.recipientAddress} required>
        <input
          style={inputStyle}
          placeholder="0x..."
          value={form.recipientAddress}
          onChange={e => onUpdate('recipientAddress', e.target.value)}
          spellCheck={false}
        />
      </Field>

      <Field label="Amount (USDC)" error={errors.amountUsdc} required>
        <div style={{ position: 'relative' }}>
          <input
            style={{ ...inputStyle, paddingRight: 60 }}
            placeholder="0.00"
            value={form.amountUsdc}
            onChange={e => onUpdate('amountUsdc', e.target.value)}
          />
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 12, fontWeight: 600, pointerEvents: 'none' }}>
            USDC
          </span>
        </div>
        {showThresholdNote && amountRaw > 0n && (
          <div className="flex items-center gap-1.5 mt-1.5" style={{ fontSize: 12, color: needsApproval ? 'var(--warning)' : 'var(--accent)' }}>
            <Info size={12} />
            {needsApproval
              ? `This amount is ${policy.thresholdUsdc} USDC or more, so it needs ${policy.requiredApprovals} approval${policy.requiredApprovals !== 1 ? 's' : ''}.`
              : `This amount is below ${policy.thresholdUsdc} USDC, so no approval is needed.`
            }
          </div>
        )}
      </Field>

      {/* Expiry — only shown when the treasury contract is set up */}
      {isTreasuryDeployed && (
        <Field label="Request expires after">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
            <input
              type="range"
              min={1}
              max={30}
              value={form.expiryDays}
              onChange={e => onUpdate('expiryDays', Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', minWidth: 60, textAlign: 'right' }}>
              {form.expiryDays} day{form.expiryDays !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Approvers have {form.expiryDays} day{form.expiryDays !== 1 ? 's' : ''} to vote before this request expires.
          </div>
        </Field>
      )}

      <Field label="Business reason" error={errors.description} required>
        <textarea
          style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
          placeholder="What is this payment for?"
          value={form.description}
          onChange={e => onUpdate('description', e.target.value)}
          maxLength={600}
          rows={3}
        />
        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--subtle)', marginTop: 4 }}>
          {form.description.length}/600
        </div>
      </Field>
    </div>
  )
}

// ─── Step 2: Review ───────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-all', minWidth: 0, maxWidth: '100%' }}>{children}</span>
    </div>
  )
}

function StepReview({ form, policy, requesterAddress }: {
  form: FormState
  policy: ApprovalPolicy
  requesterAddress: string
}) {
  let amountRaw = 0n
  try { amountRaw = parseUsdcString(form.amountUsdc) } catch { /* noop */ }
  const needsApproval = requiresApproval(form.amountUsdc, policy)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header notice — mode aware */}
      {isTreasuryDeployed ? (
        <div className="flex items-start gap-3 p-4" style={{ background: 'var(--success-dim)', border: '1px solid var(--success-dim)' }}>
          <Lock size={16} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--success)' }}>Checked by the treasury contract</strong>
            <br />
            Selecting <strong>Submit request</strong> opens your wallet to sign a transaction.
            The request is only recorded after the network confirms it.
            Approvers can act on it after that.
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-4" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <Info size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--ink)' }}>Saved in this browser only — not enforced by a contract</strong>
            <br />
            Approvals are kept in this browser. Sending pays USDC directly from your wallet without the required approvals being checked.
            The treasury contract has not been set up yet.
          </div>
        </div>
      )}

      {/* Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        <Row label="Title">{form.title}</Row>
        <Row label="Type">{REQUEST_TYPE_LABELS[form.type]}</Row>
        <Row label="Requested by">{requesterAddress.slice(0, 6)}…{requesterAddress.slice(-4)}</Row>
        <Row label="Recipient">{form.recipientAddress.slice(0, 10)}…{form.recipientAddress.slice(-6)}</Row>
        <Row label="Amount">
          <span style={{ color: amountRaw > 0n ? 'var(--ink)' : 'var(--muted)' }}>
            {amountRaw > 0n ? formatUsdcBigint(amountRaw) : '—'} USDC
          </span>
        </Row>
        {isTreasuryDeployed && (
          <Row label="Expires in">{form.expiryDays} day{form.expiryDays !== 1 ? 's' : ''}</Row>
        )}
        <Row label="Approvals">
          {needsApproval
            ? `${policy.requiredApprovals} approval${policy.requiredApprovals !== 1 ? 's' : ''} needed`
            : 'None needed (below the approval limit)'
          }
        </Row>
        <div style={{ paddingBottom: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 4 }}>Business reason</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{form.description}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

type SubmittedState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; proposalId?: `0x${string}`; txHash?: string }
  | { status: 'error'; message: string }

export default function ApprovalRequestModal({ policy, onSubmit, onClose }: Props) {
  const { address, chainId } = useAccount()
  const [step, setStep] = useState<1 | 2>(1)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<ReturnType<typeof validateApprovalRequest>['errors']>({})
  const [submitState, setSubmitState] = useState<SubmittedState>({ status: 'idle' })

  const { proposeTransfer } = useTreasuryPropose()

  const isWrongChain = isTreasuryDeployed && chainId !== ARC_MAINNET_CHAIN_ID

  const update = useCallback((k: keyof FormState, v: string | number) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: undefined }))
  }, [])

  function handleNext() {
    const result = validateApprovalRequest({
      title: form.title,
      recipientAddress: form.recipientAddress,
      amountUsdc: form.amountUsdc,
      description: form.description,
    })
    if (!result.valid) { setErrors(result.errors); return }
    setErrors({})
    setStep(2)
  }

  async function handleSubmit() {
    if (!address) return
    setSubmitState({ status: 'submitting' })

    const needsApproval = requiresApproval(form.amountUsdc, policy)

    // Generate the off-chain record ID now, before the tx, so proposalId is derived from it
    const offChainId = generateId()

    if (isTreasuryDeployed) {
      // ── TREASURY CONTRACT MODE ───────────────────────────────────────────────────────
      // Validate chain before opening wallet
      if (isWrongChain) {
        setSubmitState({ status: 'error', message: 'Your wallet is on the wrong network. Switch to Arc Mainnet and try again.' })
        return
      }

      let amount: bigint
      try {
        amount = parseUsdcString(form.amountUsdc)
      } catch {
        setSubmitState({ status: 'error', message: 'The amount is not valid, so nothing was sent. Go back, enter a number such as 5000.00 and try again.' })
        return
      }

      const expiresAt = Math.floor(Date.now() / 1000) + form.expiryDays * 86400

      const result = await proposeTransfer({
        offChainId,
        recipient: form.recipientAddress as `0x${string}`,
        amount,
        expiresAt,
      })

      if (!result) {
        // useTreasuryPropose sets its own error; show a plain summary
        setSubmitState({ status: 'error', message: 'The request was not submitted. If you cancelled in your wallet, nothing was sent. Otherwise check your wallet and try again.' })
        return
      }

      // Transaction confirmed — now save the local record with the on-chain IDs
      onSubmit({
        title: form.title,
        type: form.type,
        recipientAddress: form.recipientAddress,
        amountUsdc: form.amountUsdc,
        description: form.description,
        requiredApprovals: needsApproval ? policy.requiredApprovals : 0,
        requesterAddress: address,
        onChainProposalId: result.proposalId,
        proposeTxHash: result.hash,
        onChainExpiresAt: expiresAt,
      })

      setSubmitState({ status: 'success', proposalId: result.proposalId, txHash: result.hash })
    } else {
      // ── BROWSER-ONLY MODE ──────────────────────────────────────────────────────────
      onSubmit({
        title: form.title,
        type: form.type,
        recipientAddress: form.recipientAddress,
        amountUsdc: form.amountUsdc,
        description: form.description,
        requiredApprovals: needsApproval ? policy.requiredApprovals : 0,
        requesterAddress: address,
      })
      setSubmitState({ status: 'success' })
    }
  }

  const isSubmitting = submitState.status === 'submitting'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isSubmitting, onClose])

  const isSuccess = submitState.status === 'success'
  const isError = submitState.status === 'error'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12,
      }}
      role="dialog"
      aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget && !isSubmitting) onClose() }}
    >
      <div
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          width: 'min(560px, 100%)',
          maxHeight: '90dvh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              {isSuccess
                ? isTreasuryDeployed ? 'Request submitted' : 'Request saved'
                : step === 1 ? 'New approval request' : 'Review request'}
            </div>
            {!isSuccess && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                Step {step} of 2
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: isSubmitting ? 'not-allowed' : 'pointer', color: 'var(--muted)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isSubmitting ? 0.4 : 1 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '24px 24px 24px' }}>
          {isSuccess ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-4">
              <div style={{ width: 52, height: 52, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle2 size={24} style={{ color: 'var(--accent)' }} />
              </div>
              <div style={{ width: '100%' }}>
                {isTreasuryDeployed ? (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Request submitted</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>
                      The network confirmed your request on Arc Mainnet.
                      Approvers can now approve it from the request details.
                    </div>
                    {submitState.status === 'success' && submitState.txHash && (
                      <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', padding: '10px 14px', fontSize: 12, textAlign: 'left' }}>
                        <div style={{ color: 'var(--muted)', marginBottom: 4 }}>Transaction hash</div>
                        <a
                          href={`https://explorer.arc.io/tx/${submitState.txHash}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1"
                          style={{ color: 'var(--accent)', wordBreak: 'break-all', fontWeight: 600 }}
                        >
                          {submitState.txHash.slice(0, 12)}…{submitState.txHash.slice(-8)}
                          <ExternalLink size={11} style={{ flexShrink: 0 }} />
                        </a>
                        {submitState.status === 'success' && submitState.proposalId && (
                          <>
                            <div style={{ color: 'var(--muted)', marginBottom: 4, marginTop: 10 }}>Contract reference</div>
                            <div style={{ color: 'var(--ink)', fontWeight: 600, wordBreak: 'break-all' }}>
                              {submitState.proposalId.slice(0, 12)}…{submitState.proposalId.slice(-8)}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Request saved in this browser</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                      The request is saved in this browser only. Other people cannot see it from their own devices.
                      Approvals are not enforced by a contract.
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : step === 1 ? (
            <StepDetails form={form} errors={errors} policy={policy} onUpdate={update} />
          ) : (
            <StepReview form={form} policy={policy} requesterAddress={address ?? ''} />
          )}

          {/* Wrong-chain warning in review step */}
          {step === 2 && isWrongChain && !isSuccess && (
            <div className="flex items-center gap-2 p-3 mt-4" style={{ background: 'var(--warning-dim)', border: '1px solid var(--warning-border)' }}>
              <AlertCircle size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--warning)' }}>Your wallet is on the wrong network. Switch to Arc Mainnet to continue.</span>
            </div>
          )}

          {/* Error banner */}
          {isError && (
            <div className="flex items-start gap-2 p-3 mt-4" style={{ background: 'var(--danger-dim)', border: '1px solid var(--danger-border)' }}>
              <AlertCircle size={14} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13, color: 'var(--danger)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{submitState.message}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5" style={{ borderTop: '1px solid var(--border)' }}>
          {isSuccess ? (
            <button
              onClick={onClose}
              className="w-full text-sm font-semibold"
              style={{ minHeight: 44, background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
            >
              Done
            </button>
          ) : step === 1 ? (
            <>
              <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', minHeight: 44, padding: '0 20px', fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleNext}
                className="flex items-center gap-2 px-5 text-sm font-semibold"
                style={{ minHeight: 44, background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
              >
                Review <ChevronRight size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setStep(1); setSubmitState({ status: 'idle' }) }}
                disabled={isSubmitting}
                className="flex items-center gap-2"
                style={{ background: 'none', border: '1px solid var(--border)', minHeight: 44, padding: '0 20px', fontSize: 13, color: 'var(--muted)', cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.5 : 1 }}
              >
                <ChevronLeft size={16} /> Back
              </button>
              <button
                onClick={() => { void handleSubmit() }}
                disabled={!address || isSubmitting || isWrongChain}
                className="px-6 text-sm font-semibold transition-opacity flex items-center gap-2"
                style={{
                  minHeight: 44,
                  background: (!address || isWrongChain) ? 'var(--surface-strong)' : 'var(--accent)',
                  color: (!address || isWrongChain) ? 'var(--subtle)' : 'var(--bg)',
                  border: 'none',
                  cursor: (!address || isSubmitting || isWrongChain) ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.8 : 1,
                }}
              >
                {isSubmitting ? (
                  <><Loader2 size={15} className="animate-spin" />{isTreasuryDeployed ? 'Confirm in your wallet…' : 'Saving…'}</>
                ) : (
                  isTreasuryDeployed ? 'Submit request' : 'Save request'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
