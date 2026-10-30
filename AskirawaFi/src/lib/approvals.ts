/**
 * AskirawaFi — Treasury Approval Workflows
 *
 * AUTHORIZATION ARCHITECTURE NOTE:
 * The existing AskirawaFi contract (0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434)
 * is an Automation Registry that stores single-recipient automation rules.
 * It does NOT implement multi-party approval logic, transfer thresholds,
 * or keeper-enforced execution guards.
 *
 * This means:
 *   - Approval requests and decisions are stored in browser localStorage.
 *   - Approver identities are connected wallet addresses (no on-chain role registry).
 *   - "Approval" is a locally-recorded consent — it does NOT cryptographically prevent
 *     the requester from executing a transfer before approval is complete.
 *   - Execution remains a direct USDC ERC-20 transfer() from the connected wallet.
 *   - The approval threshold is enforced by the UI only, not by any contract.
 *
 * What is needed for production-grade approval enforcement:
 *   1. A treasury multisig or approval contract (e.g. Gnosis Safe, a custom
 *      TreasuryApproval.sol) that holds funds and only releases them when
 *      the required signature count is met.
 *   2. On-chain role registry mapping approver addresses to permissions.
 *   3. Execution logic that verifies approval state before transfer.
 *   4. Nonce or execution ID to prevent replay/duplicate execution.
 *
 * Until that infrastructure exists, the UI clearly labels all approval state
 * as "Locally recorded — not cryptographically enforced."
 */

// ─── Request types ────────────────────────────────────────────────────────────

export type ApprovalRequestStatus =
  | 'draft'
  | 'pending'
  | 'partial'       // some but not all approvals collected
  | 'approved'      // all required approvals collected, awaiting execution
  | 'rejected'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'cancelled'
  | 'expired'

export type RequestType =
  | 'transfer'
  | 'payroll_batch'
  | 'recurring_schedule'
  | 'other'

export interface ApprovalDecision {
  approverAddress: string
  decision: 'approved' | 'rejected'
  reason?: string
  timestamp: number
}

export interface ApprovalRequest {
  id: string
  type: RequestType
  /** Human-readable label for the request */
  title: string
  /** Wallet address of the person who created this request */
  requesterAddress: string
  /** Target recipient (for transfer/payroll, the treasury contract or direct address) */
  recipientAddress: string
  /** USDC amount as a string — no float arithmetic */
  amountUsdc: string
  /** Description / business justification */
  description: string
  /** How many distinct approvals are required before execution */
  requiredApprovals: number
  /** Decisions recorded so far */
  decisions: ApprovalDecision[]
  status: ApprovalRequestStatus
  createdAt: number           // unix ms
  updatedAt: number
  expiresAt?: number          // optional expiry
  /** If linked to a payroll batch id */
  linkedBatchId?: string
  /** If linked to a recurring schedule id */
  linkedScheduleId?: string
  /** Transaction hash once executed */
  txHash?: string
  /** Confirmed at timestamp */
  confirmedAt?: number
  /** Failure reason */
  errorMessage?: string
  /** Optional note added at execution time */
  executionNote?: string
}

// ─── Approval policy ─────────────────────────────────────────────────────────

/**
 * The ApprovalPolicy defines when approval is required and who can approve.
 *
 * IMPORTANT: This policy is stored in localStorage and enforced by the frontend
 * UI only. It is NOT enforced on-chain. A user with direct wallet access could
 * bypass it. Production enforcement requires a smart contract.
 */
export interface ApprovalPolicy {
  /** USDC threshold above which approval is required (as a string, bigint-parsed) */
  thresholdUsdc: string
  /** Number of approvals required for amounts at/above threshold */
  requiredApprovals: number
  /** Addresses allowed to approve requests. Empty = any connected wallet can approve. */
  approverAddresses: string[]
  /** Policy was last updated at (unix ms) */
  updatedAt: number
  /** Who last updated the policy (wallet address) */
  updatedBy?: string
}

export const DEFAULT_POLICY: ApprovalPolicy = {
  thresholdUsdc: '1000.00',
  requiredApprovals: 1,
  approverAddresses: [],    // open: any connected wallet can approve
  updatedAt: 0,
}

// ─── USDC decimal helpers ─────────────────────────────────────────────────────

export const USDC_DECIMALS = 6

export function parseUsdcString(value: string): bigint {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid USDC amount: "${value}"`)
  }
  const [whole, frac = ''] = trimmed.split('.')
  const fracPadded = frac.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, '0')
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded)
}

export function formatUsdcBigint(raw: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS)
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '') || '0'
  return `${Number(whole).toLocaleString('en-US')}.${fracStr}`
}

// ─── Policy helpers ───────────────────────────────────────────────────────────

/** Returns true if an amount (string) is at or above the policy threshold */
export function requiresApproval(amountUsdc: string, policy: ApprovalPolicy): boolean {
  try {
    const amount = parseUsdcString(amountUsdc)
    const threshold = parseUsdcString(policy.thresholdUsdc)
    return amount >= threshold
  } catch {
    return false
  }
}

/** Returns true if `address` is in the approver list, or if the list is empty (open) */
export function isAuthorizedApprover(address: string, policy: ApprovalPolicy): boolean {
  if (policy.approverAddresses.length === 0) return true
  return policy.approverAddresses.some(a => a.toLowerCase() === address.toLowerCase())
}

// ─── Derived request state ────────────────────────────────────────────────────

export interface RequestStats {
  approvedCount: number
  rejectedCount: number
  remainingApprovals: number
  isFullyApproved: boolean
  hasRejection: boolean
  progressLabel: string
}

export function getRequestStats(req: ApprovalRequest): RequestStats {
  const uniqueApprovers = new Set<string>()
  let approvedCount = 0
  let hasRejection = false

  for (const d of req.decisions) {
    const addr = d.approverAddress.toLowerCase()
    if (uniqueApprovers.has(addr)) continue
    uniqueApprovers.add(addr)
    if (d.decision === 'approved') approvedCount++
    if (d.decision === 'rejected') hasRejection = true
  }

  const remainingApprovals = Math.max(0, req.requiredApprovals - approvedCount)
  const isFullyApproved = approvedCount >= req.requiredApprovals

  const progressLabel =
    req.requiredApprovals === 1
      ? isFullyApproved ? 'Approved' : 'Awaiting approval'
      : `${approvedCount} of ${req.requiredApprovals} approvals`

  return {
    approvedCount,
    rejectedCount: Array.from(uniqueApprovers).filter(a => {
      const d = req.decisions.find(d => d.approverAddress.toLowerCase() === a)
      return d?.decision === 'rejected'
    }).length,
    remainingApprovals,
    isFullyApproved,
    hasRejection,
    progressLabel,
  }
}

/** Derive the correct status from the current decision set */
export function deriveRequestStatus(req: ApprovalRequest): ApprovalRequestStatus {
  if (req.status === 'executed' || req.status === 'failed' || req.status === 'cancelled' || req.status === 'expired') {
    return req.status
  }
  const stats = getRequestStats(req)
  if (stats.hasRejection) return 'rejected'
  if (stats.isFullyApproved) return 'approved'
  if (stats.approvedCount > 0) return 'partial'
  return 'pending'
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface RequestValidationResult {
  valid: boolean
  errors: Partial<Record<'title' | 'recipientAddress' | 'amountUsdc' | 'description', string>>
}

export function validateApprovalRequest(fields: {
  title: string
  recipientAddress: string
  amountUsdc: string
  description: string
}): RequestValidationResult {
  const errors: RequestValidationResult['errors'] = {}

  if (!fields.title.trim()) errors.title = 'Request title is required.'

  if (!fields.recipientAddress.trim()) {
    errors.recipientAddress = 'Recipient address is required.'
  } else if (!/^0x[0-9a-fA-F]{40}$/.test(fields.recipientAddress.trim())) {
    errors.recipientAddress = 'Invalid Ethereum address.'
  }

  if (!fields.amountUsdc.trim()) {
    errors.amountUsdc = 'Amount is required.'
  } else {
    try {
      const raw = parseUsdcString(fields.amountUsdc)
      if (raw <= 0n) errors.amountUsdc = 'Amount must be greater than zero.'
    } catch {
      errors.amountUsdc = 'Invalid amount. Use decimal format (e.g. 5000.00).'
    }
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

// ─── Status display helpers ───────────────────────────────────────────────────

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'active'

export const REQUEST_STATUS_LABELS: Record<ApprovalRequestStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  partial: 'Partial',
  approved: 'Approved',
  rejected: 'Rejected',
  executing: 'Executing',
  executed: 'Executed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  transfer: 'Treasury Transfer',
  payroll_batch: 'Payroll Batch',
  recurring_schedule: 'Recurring Schedule',
  other: 'Other',
}

export function requestStatusVariant(status: ApprovalRequestStatus): BadgeVariant {
  if (status === 'executed') return 'success'
  if (status === 'approved') return 'active'
  if (status === 'partial') return 'warning'
  if (status === 'rejected' || status === 'failed' || status === 'cancelled' || status === 'expired') return 'danger'
  return 'neutral'
}

// ─── ID / display helpers ─────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function formatRequestId(id: string): string {
  return `APR-${id.split('-')[0].toUpperCase()}`
}

export function formatTs(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const REQUESTS_KEY = 'askirawafi_approvals_v1'
const POLICY_KEY   = 'askirawafi_approval_policy_v1'

export function loadRequests(): ApprovalRequest[] {
  try {
    const raw = localStorage.getItem(REQUESTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ApprovalRequest[]
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function saveRequests(requests: ApprovalRequest[]): void {
  localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests))
}

export function upsertRequest(
  requests: ApprovalRequest[],
  req: ApprovalRequest
): ApprovalRequest[] {
  const idx = requests.findIndex(r => r.id === req.id)
  if (idx === -1) return [...requests, req]
  const next = [...requests]
  next[idx] = req
  return next
}

export function loadPolicy(): ApprovalPolicy {
  try {
    const raw = localStorage.getItem(POLICY_KEY)
    if (!raw) return { ...DEFAULT_POLICY }
    return { ...DEFAULT_POLICY, ...(JSON.parse(raw) as Partial<ApprovalPolicy>) }
  } catch { return { ...DEFAULT_POLICY } }
}

export function savePolicy(policy: ApprovalPolicy): void {
  localStorage.setItem(POLICY_KEY, JSON.stringify(policy))
}
