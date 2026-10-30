import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { isAddress, parseUnits } from 'viem'
import { Plus, X, Zap, ArrowUpRight, Info, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import { WalletRequired } from '../components/WalletGate'
import {
  AUTOMATION_REGISTRY_ADDRESS,
  AUTOMATION_REGISTRY_ABI,
  AUTOMATION_REGISTRY_CHAIN_ID,
  FREQUENCY_SECONDS,
  formatAddress,
  formatDate,
  type AutomationRecord,
} from '../lib/contract'
import { ARC_MAINNET_CHAIN_ID } from '../config'
import { useUserAutomations } from '../hooks/useAutomations'
import { parseOnchainError } from '../lib/utils'
import { buildTxExplorerUrl } from '../onchain-facts'

// Compute minimum selectable date once at module load time (not inside render)
function getTomorrowDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}
const MIN_DATE = getTomorrowDate()

// --- Form state ---
interface FormState {
  name: string
  recipient: string
  amount: string
  frequency: string
  executionDate: string
  note: string
}

const EMPTY_FORM: FormState = {
  name: '',
  recipient: '',
  amount: '',
  frequency: 'Monthly',
  executionDate: '',
  note: '',
}

function validateForm(f: FormState): string | null {
  if (!f.name.trim()) return 'Automation name is required.'
  if (!isAddress(f.recipient)) return 'Recipient must be a valid 0x address.'
  const amt = parseFloat(f.amount)
  if (!f.amount || isNaN(amt) || amt <= 0) return 'Enter a valid USDC amount greater than zero.'
  if (!f.executionDate) return 'Select an execution date.'
  const ts = Math.floor(new Date(f.executionDate).getTime() / 1000)
  if (ts <= Math.floor(Date.now() / 1000)) return 'Execution date must be in the future.'
  return null
}

// --- Automation row ---
function AutomationRow({ a }: { a: AutomationRecord }) {
  return (
    <div
      className="grid gap-4 rounded-xl p-5"
      style={{
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      }}
    >
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>
          Automation #{a.id}
        </div>
        <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{a.name}</div>
        {a.note && <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{a.note}</div>}
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>Amount</div>
        <div className="text-sm mono font-semibold" style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
          {parseFloat(a.amountFormatted).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{a.frequency}</div>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>Recipient</div>
        <div className="text-xs mono" style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
          {formatAddress(a.recipient)}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>First run: {formatDate(a.executionTime)}</div>
      </div>
      <div className="flex items-start gap-2">
        <Badge variant={a.active ? 'active' : 'neutral'}>
          {a.active ? 'Active' : 'Paused'}
        </Badge>
      </div>
    </div>
  )
}

// --- Main page ---
export default function Automations() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain() as { switchChain: (params: { chainId: number }) => void; isPending: boolean }
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const { automations, isLoading, error, refetch } = useUserAutomations(address)

  const isWrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID

  const {
    writeContract,
    data: txHash,
    isPending: isSigning,
    reset: resetWrite,
  } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  // Handle success — useEffect so this runs exactly once when isSuccess flips,
  // not on every subsequent render while the same txHash is still in state.
  useEffect(() => {
    if (!isSuccess || !txHash) return
    toast.success('Automation created on Arc.', {
      description: (
        <a
          href={buildTxExplorerUrl(AUTOMATION_REGISTRY_CHAIN_ID, txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1"
          style={{ color: 'var(--accent)' }}
        >
          View on explorer <ArrowUpRight size={11} />
        </a>
      ) as unknown as string,
    })
    resetWrite()
    setShowForm(false)
    setForm(EMPTY_FORM)
    refetch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, txHash])

  function handleChange(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setFormError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isConnected || !address) {
      setFormError('Connect your wallet first.')
      return
    }
    if (isWrongChain) {
      switchChain({ chainId: ARC_MAINNET_CHAIN_ID })
      return
    }
    const err = validateForm(form)
    if (err) { setFormError(err); return }

    const frequencySeconds = BigInt(FREQUENCY_SECONDS[form.frequency] ?? 0)
    const executionTime = BigInt(Math.floor(new Date(form.executionDate).getTime() / 1000))
    const amountRaw = parseUnits(form.amount, 6)

    try {
      writeContract({
        address: AUTOMATION_REGISTRY_ADDRESS,
        abi: AUTOMATION_REGISTRY_ABI,
        functionName: 'createAutomation',
        args: [
          form.name,
          form.recipient as `0x${string}`,
          amountRaw,
          frequencySeconds,
          executionTime,
          form.note,
        ],
        chainId: AUTOMATION_REGISTRY_CHAIN_ID,
      })
    } catch (caughtErr) {
      setFormError(parseOnchainError(caughtErr))
    }
  }

  const isSubmitting = isSigning || isConfirming
  const minDate = MIN_DATE

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>
          Treasury Automation
        </div>
        <h1 className="display text-3xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          Automations
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Create and manage programmable USDC rules on Arc Mainnet.
        </p>
      </div>

      {/* Keeper notice */}
      <div
        className="flex items-start gap-3 rounded-xl px-4 py-3 text-xs"
        style={{ background: 'var(--warning-dim)', border: '1px solid rgba(232,184,76,0.2)', color: 'var(--warning)' }}
      >
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          Registering an automation on-chain stores your rule in the contract. Automatic execution of recurring payments requires a separate keeper service, which is not yet deployed. Rules registered now will be ready when the keeper is live.
        </span>
      </div>

      {/* Create form */}
      {showForm && (
        <Card>
          <CardHeader>
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>
                New Automation
              </div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Create automation</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                Define when and where your treasury should make a USDC payment.
              </p>
            </div>
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setFormError(null) }}
              className="flex items-center justify-center rounded-lg"
              style={{
                width: 34, height: 34, background: 'var(--surface-muted)',
                border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                  Automation name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="e.g. Monthly Payroll"
                  required
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all"
                  style={{
                    background: 'var(--surface-muted)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink)',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Recipient */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                  Recipient address *
                </label>
                <input
                  type="text"
                  value={form.recipient}
                  onChange={(e) => handleChange('recipient', e.target.value)}
                  placeholder="0x..."
                  required
                  className="w-full rounded-lg px-3 py-2.5 text-sm mono outline-none transition-all"
                  style={{
                    background: 'var(--surface-muted)',
                    border: `1px solid ${form.recipient && !isAddress(form.recipient) ? 'var(--danger)' : 'var(--border)'}`,
                    color: 'var(--ink)',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontVariantNumeric: 'tabular-nums',
                  }}
                />
                {form.recipient && !isAddress(form.recipient) && (
                  <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>Not a valid Ethereum address.</p>
                )}
              </div>

              {/* Amount + Frequency */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                    USDC amount *
                  </label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(e) => handleChange('amount', e.target.value)}
                    min="0.01"
                    step="0.01"
                    placeholder="1000.00"
                    required
                    className="w-full rounded-lg px-3 py-2.5 text-sm mono outline-none"
                    style={{
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--border)',
                      color: 'var(--ink)',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                    Frequency *
                  </label>
                  <select
                    value={form.frequency}
                    onChange={(e) => handleChange('frequency', e.target.value)}
                    className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                    style={{
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--border)',
                      color: 'var(--ink)',
                      fontFamily: 'inherit',
                    }}
                  >
                    {Object.keys(FREQUENCY_SECONDS).map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Execution date */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                  First execution date *
                </label>
                <input
                  type="date"
                  value={form.executionDate}
                  onChange={(e) => handleChange('executionDate', e.target.value)}
                  min={minDate}
                  required
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{
                    background: 'var(--surface-muted)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink)',
                    fontFamily: 'inherit',
                    colorScheme: 'dark',
                  }}
                />
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                  Note (optional)
                </label>
                <textarea
                  value={form.note}
                  onChange={(e) => handleChange('note', e.target.value)}
                  placeholder="Describe the treasury rule…"
                  rows={2}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-y"
                  style={{
                    background: 'var(--surface-muted)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink)',
                    fontFamily: 'inherit',
                    minHeight: 72,
                  }}
                />
              </div>

              {/* Error */}
              {formError && (
                <div
                  className="rounded-lg px-4 py-3 text-xs font-medium"
                  style={{ background: 'rgba(232,109,122,0.1)', border: '1px solid rgba(232,109,122,0.25)', color: 'var(--danger)' }}
                >
                  {formError}
                </div>
              )}

              {/* Transaction state feedback */}
              {isSigning && (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
                  <Spinner size={16} /> Confirm in your wallet…
                </div>
              )}
              {isConfirming && (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
                  <Spinner size={16} /> Waiting for confirmation…
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setFormError(null) }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold"
                  style={{
                    background: 'var(--surface-muted)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink-2)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                {isWrongChain ? (
                  <button
                    type="button"
                    onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
                    disabled={isSwitching}
                    className="rounded-lg px-4 py-2 text-sm font-semibold"
                    style={{
                      background: 'var(--warning)',
                      color: '#0d1810',
                      border: 'none',
                      cursor: isSwitching ? 'not-allowed' : 'pointer',
                      opacity: isSwitching ? 0.6 : 1,
                    }}
                  >
                    {isSwitching ? 'Switching…' : 'Switch to Arc Mainnet'}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isSubmitting || !isConnected}
                    className="rounded-lg px-5 py-2 text-sm font-bold"
                    style={{
                      background: 'var(--accent)',
                      color: '#021a0e',
                      border: 'none',
                      cursor: isSubmitting || !isConnected ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting || !isConnected ? 0.6 : 1,
                    }}
                  >
                    {isSubmitting ? 'Creating…' : 'Create Automation'}
                  </button>
                )}
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="text-sm" style={{ color: 'var(--muted)' }}>
          {isConnected && !isLoading
            ? `${automations.length} on-chain automation${automations.length !== 1 ? 's' : ''}`
            : isLoading
            ? 'Loading…'
            : 'Connect wallet to view automations'}
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <button
              onClick={refetch}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}
            >
              <RefreshCw size={13} />
              Refresh
            </button>
          )}
          {!showForm && (
            <button
              onClick={() => {
                if (!isConnected) { toast.error('Connect your wallet first.'); return }
                setShowForm(true)
              }}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#021a0e', border: 'none', cursor: 'pointer' }}
            >
              <Plus size={15} /> New Automation
            </button>
          )}
        </div>
      </div>

      {/* Automations list */}
      {!isConnected ? (
        <WalletRequired message="Connect your Arc wallet to view and create on-chain automations." />
      ) : isLoading ? (
        <Card>
          <CardBody className="flex items-center justify-center py-12 gap-3">
            <Spinner size={22} />
            <span className="text-sm" style={{ color: 'var(--muted)' }}>Loading on-chain automations…</span>
          </CardBody>
        </Card>
      ) : error ? (
        <Card style={{ border: '1px solid rgba(232,109,122,0.2)' }}>
          <CardBody>
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              Unable to load automations. Check your connection and try again.
            </p>
            <button
              onClick={refetch}
              className="mt-3 text-xs font-medium"
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}
            >
              Retry
            </button>
          </CardBody>
        </Card>
      ) : automations.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No automations yet"
          description="Create your first automation to register a USDC payment rule on Arc Mainnet."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#021a0e', border: 'none', cursor: 'pointer' }}
            >
              <Plus size={14} /> New Automation
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {automations.map((a) => (
            <AutomationRow key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  )
}
