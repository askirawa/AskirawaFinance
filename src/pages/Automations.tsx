import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { isAddress, parseUnits } from 'viem'
import { Plus, X, Zap, ArrowUpRight, Info, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
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
  if (!f.name.trim()) return 'Enter a name for this automation.'
  if (!isAddress(f.recipient)) return 'Enter a valid recipient wallet address. It starts with 0x.'
  const amt = parseFloat(f.amount)
  if (!f.amount || isNaN(amt) || amt <= 0) return 'Enter a USDC amount greater than zero.'
  if (!f.executionDate) return 'Choose the date of the first payment.'
  const ts = Math.floor(new Date(f.executionDate).getTime() / 1000)
  if (ts <= Math.floor(Date.now() / 1000)) return 'The first payment date must be in the future. Choose a later date.'
  return null
}

const CANCELLED_MESSAGE = 'Transaction cancelled. Nothing was sent.'

// Turns a wallet/network error into a short message that says what to do next
function friendlyError(err: unknown): string {
  const msg = parseOnchainError(err)
  if (msg === 'Transaction cancelled.') return CANCELLED_MESSAGE
  if (msg.startsWith('Wrong network')) return 'Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'
  if (msg.startsWith('Insufficient balance')) return 'Your wallet does not have enough USDC to cover the network fee. Add funds and try again.'
  if (msg.startsWith('Network error')) return 'Could not reach the network. Check your connection and try again.'
  if (msg.startsWith('Transaction failed')) return 'The network rejected this transaction. Check the details and try again.'
  return 'Something went wrong and nothing was saved. Try again in a moment.'
}

// --- Automation row ---
function AutomationRow({ a }: { a: AutomationRecord }) {
  return (
    <div
      className="grid gap-4 p-5"
      style={{
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
      }}
    >
      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>
          Automation {a.id}
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
        <div className="text-xs mono" style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
          {formatAddress(a.recipient)}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>First payment: {formatDate(a.executionTime)}</div>
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
    error: writeError,
    reset: resetWrite,
  } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  // Handle success — useEffect so this runs exactly once when isSuccess flips,
  // not on every subsequent render while the same txHash is still in state.
  useEffect(() => {
    if (!isSuccess || !txHash) return
    toast.success('Automation saved on Arc.', {
      description: (
        <a
          href={buildTxExplorerUrl(AUTOMATION_REGISTRY_CHAIN_ID, txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1"
          style={{ color: 'var(--accent)' }}
        >
          View transaction <ArrowUpRight size={11} />
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
      setFormError('Connect your wallet to create an automation.')
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
      setFormError(friendlyError(caughtErr))
    }
  }

  const isSubmitting = isSigning || isConfirming
  const shownError = formError ?? (writeError ? friendlyError(writeError) : null)
  const errorIsCancel = shownError === CANCELLED_MESSAGE
  const minDate = MIN_DATE

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Treasury Automation"
        title="Automations"
        subtitle="An automation is a saved rule for a recurring USDC payment: who gets paid, how much, and how often."
      />

      {/* How it works + service disclosure */}
      <div
        className="flex items-start gap-3 px-4 py-3 text-xs"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)', lineHeight: 1.6 }}
      >
        <Info size={13} className="mt-0.5 shrink-0" />
        <span style={{ minWidth: 0 }}>
          When you create an automation, its rule is saved in the Automation Registry, a contract on Arc Mainnet that keeps a public list of automation rules, including the name, amount, recipient and schedule you enter. Saving a rule does not move any money.
        </span>
      </div>

      <div
        className="flex items-start gap-3 px-4 py-3 text-xs"
        style={{ background: 'var(--warning-dim)', border: '1px solid var(--warning-border)', color: 'var(--warning)', lineHeight: 1.6 }}
      >
        <Info size={13} className="mt-0.5 shrink-0" />
        <span style={{ minWidth: 0 }}>
          The automation service that sends these payments on schedule is not running yet, so no payments will be sent automatically. Rules you save now will be ready once the service is live.
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
                Choose who gets paid, how much, and how often.
              </p>
            </div>
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setFormError(null); resetWrite() }}
              aria-label="Close"
              className="flex items-center justify-center shrink-0"
              style={{
                width: 44, height: 44, background: 'var(--surface-muted)',
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
                  placeholder="e.g. Monthly office rent"
                  required
                  className="w-full px-3 py-2.5 text-sm outline-none transition-all"
                  style={{
                    minHeight: 44,
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
                  className="w-full px-3 py-2.5 text-sm mono outline-none transition-all"
                  style={{
                    minHeight: 44,
                    background: 'var(--surface-muted)',
                    border: `1px solid ${form.recipient && !isAddress(form.recipient) ? 'var(--danger)' : 'var(--border)'}`,
                    color: 'var(--ink)',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontVariantNumeric: 'tabular-nums',
                  }}
                />
                {form.recipient && !isAddress(form.recipient) && (
                  <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>This is not a valid wallet address. It should start with 0x and be 42 characters long.</p>
                )}
              </div>

              {/* Amount + How often */}
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
                    className="w-full px-3 py-2.5 text-sm mono outline-none"
                    style={{
                      minHeight: 44,
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
                    How often *
                  </label>
                  <select
                    value={form.frequency}
                    onChange={(e) => handleChange('frequency', e.target.value)}
                    className="w-full px-3 py-2.5 text-sm outline-none"
                    style={{
                      minHeight: 44,
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
                  First payment date *
                </label>
                <input
                  type="date"
                  value={form.executionDate}
                  onChange={(e) => handleChange('executionDate', e.target.value)}
                  min={minDate}
                  required
                  className="w-full px-3 py-2.5 text-sm outline-none"
                  style={{
                    minHeight: 44,
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
                  placeholder="What is this payment for?"
                  rows={2}
                  className="w-full px-3 py-2.5 text-sm outline-none resize-y"
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
              {shownError && (
                <div
                  role={errorIsCancel ? 'status' : 'alert'}
                  className="px-4 py-3 text-xs font-medium"
                  style={errorIsCancel
                    ? { background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)' }
                    : { background: 'var(--danger-dim)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }}
                >
                  {shownError}
                </div>
              )}

              {/* Transaction state feedback */}
              {isSigning && (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
                  <Spinner size={16} /> Confirm in your wallet to continue…
                </div>
              )}
              {isConfirming && (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
                  <Spinner size={16} /> Waiting for the network to confirm…
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setFormError(null); resetWrite() }}
                  className="px-4 py-2 text-sm font-semibold"
                  style={{
                    minHeight: 44,
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
                    className="px-4 py-2 text-sm font-semibold"
                    style={{
                      minHeight: 44,
                      background: 'var(--warning)',
                      color: 'var(--bg)',
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
                    className="px-5 py-2 text-sm font-bold"
                    style={{
                      minHeight: 44,
                      background: 'var(--accent)',
                      color: 'var(--bg)',
                      border: 'none',
                      cursor: isSubmitting || !isConnected ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting || !isConnected ? 0.6 : 1,
                    }}
                  >
                    {isSubmitting ? 'Saving…' : 'Create automation'}
                  </button>
                )}
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm" style={{ color: 'var(--muted)' }}>
          {isConnected && !isLoading
            ? `${automations.length} automation${automations.length !== 1 ? 's' : ''} saved on Arc`
            : isLoading
            ? 'Loading…'
            : 'Connect your wallet to see your automations'}
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <button
              onClick={refetch}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium"
              style={{ minHeight: 44, background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}
            >
              <RefreshCw size={13} />
              Refresh
            </button>
          )}
          {!showForm && (
            <button
              onClick={() => {
                if (!isConnected) { toast.error('Connect your wallet to create an automation.'); return }
                setShowForm(true)
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold"
              style={{ minHeight: 44, background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
            >
              <Plus size={15} /> New automation
            </button>
          )}
        </div>
      </div>

      {/* Automations list */}
      {!isConnected ? (
        <WalletRequired message="Connect your wallet to see and create automations." />
      ) : isLoading ? (
        <Card>
          <CardBody className="flex items-center justify-center py-12 gap-3">
            <Spinner size={22} />
            <span className="text-sm" style={{ color: 'var(--muted)' }}>Loading your automations…</span>
          </CardBody>
        </Card>
      ) : error ? (
        <Card style={{ border: '1px solid var(--danger-border)' }}>
          <CardBody>
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              Could not load your automations. Check your connection, then select Retry.
            </p>
            <button
              onClick={refetch}
              className="mt-3 text-xs font-medium"
              style={{ minHeight: 44, padding: '0 8px', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}
            >
              Retry
            </button>
          </CardBody>
        </Card>
      ) : automations.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No automations yet"
          description="Create your first automation to save a recurring USDC payment rule."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold"
              style={{ minHeight: 44, background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
            >
              <Plus size={14} /> New automation
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
