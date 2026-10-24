/**
 * AskirawaFi Automation Registry
 * Deployed on Arc Mainnet (chain ID 5042)
 * Address: 0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434
 */

import { ARC_MAINNET_CHAIN_ID } from '../config'

export const AUTOMATION_REGISTRY_ADDRESS =
  '0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434' as const

export const AUTOMATION_REGISTRY_CHAIN_ID = ARC_MAINNET_CHAIN_ID

export const AUTOMATION_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'automationCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'createAutomation',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'frequency', type: 'uint256' },
      { name: 'executionTime', type: 'uint256' },
      { name: 'note', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAutomation',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'frequency', type: 'uint256' },
      { name: 'executionTime', type: 'uint256' },
      { name: 'note', type: 'string' },
      { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setAutomationStatus',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'active', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/** Seconds-per-period for each frequency option */
export const FREQUENCY_SECONDS: Record<string, number> = {
  Once: 0,
  Daily: 86400,
  Weekly: 604800,
  Monthly: 2592000,
}

export function secondsToFrequency(s: number): string {
  if (s === 86400) return 'Daily'
  if (s === 604800) return 'Weekly'
  if (s === 2592000) return 'Monthly'
  return 'Once'
}

export interface AutomationRecord {
  id: number
  name: string
  owner: string
  recipient: string
  /** Raw bigint from contract */
  amountRaw: bigint
  /** Formatted as USDC string (6 decimals) */
  amountFormatted: string
  frequency: string
  executionTime: number
  note: string
  active: boolean
}

export function parseAutomationTuple(tuple: readonly unknown[]): AutomationRecord {
  const amountRaw = tuple[4] as bigint
  const decimals = 6
  const divisor = BigInt(10 ** decimals)
  const whole = amountRaw / divisor
  const frac = amountRaw % divisor
  const amountFormatted = `${whole}.${frac.toString().padStart(decimals, '0')}`

  return {
    id: Number(tuple[0]),
    name: tuple[1] as string,
    owner: tuple[2] as string,
    recipient: tuple[3] as string,
    amountRaw,
    amountFormatted,
    frequency: secondsToFrequency(Number(tuple[5])),
    executionTime: Number(tuple[6]),
    note: tuple[7] as string,
    active: tuple[8] as boolean,
  }
}

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

// ─── PayrollBatch contract ────────────────────────────────────────────────────
//
// NOT YET DEPLOYED. Deploy to Arc Mainnet and set VITE_PAYROLL_BATCH_ADDRESS
// in .env before enabling atomic batch execution.
//
// Deployment prerequisites:
//   1. forge build  (already passes)
//   2. Deploy PayrollBatch(usdcAddress, ownerAddress) on Arc Mainnet
//      usdcAddress = 0x3600000000000000000000000000000000000000 (verified: symbol=USDC, decimals=6)
//      ownerAddress = the treasury wallet that will call executeBatch
//   3. Set VITE_PAYROLL_BATCH_ADDRESS=<deployed address> in .env
//   4. The treasury wallet must call USDC.approve(payrollBatchAddress, batchTotal)
//      before each executeBatch call (exact amount, not unlimited).

/**
 * Address of the deployed PayrollBatch contract on Arc Mainnet.
 * null = contract not yet deployed; the UI falls back to individual transfers.
 */
const _rawPayrollBatchAddress = import.meta.env.VITE_PAYROLL_BATCH_ADDRESS as string | undefined
export const PAYROLL_BATCH_ADDRESS: `0x${string}` | null =
  (_rawPayrollBatchAddress?.startsWith('0x') && _rawPayrollBatchAddress.length === 42)
    ? (_rawPayrollBatchAddress as `0x${string}`)
    : null

export const PAYROLL_BATCH_ABI = [
  // ─── executeBatch ──────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'executeBatch',
    inputs: [
      { name: 'batchId',    type: 'bytes32'   },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts',    type: 'uint256[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ─── view helpers ─────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'isBatchExecuted',
    inputs: [{ name: 'batchId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowanceFrom',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'usdc',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_BATCH_SIZE',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  // ─── events ───────────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'BatchExecuted',
    inputs: [
      { name: 'batchId',   type: 'bytes32', indexed: true  },
      { name: 'executor',  type: 'address', indexed: true  },
      { name: 'count',     type: 'uint256', indexed: false },
      { name: 'totalUsdc', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentSent',
    inputs: [
      { name: 'batchId',   type: 'bytes32', indexed: true  },
      { name: 'recipient', type: 'address', indexed: true  },
      { name: 'amount',    type: 'uint256', indexed: false },
    ],
  },
  // ─── errors ───────────────────────────────────────────────────────────────
  { type: 'error', name: 'BatchAlreadyExecuted', inputs: [{ name: 'batchId', type: 'bytes32' }] },
  { type: 'error', name: 'EmptyBatch',           inputs: [] },
  { type: 'error', name: 'BatchTooLarge',        inputs: [{ name: 'size', type: 'uint256' }, { name: 'max', type: 'uint256' }] },
  { type: 'error', name: 'ArrayLengthMismatch',  inputs: [{ name: 'recipientsLen', type: 'uint256' }, { name: 'amountsLen', type: 'uint256' }] },
  { type: 'error', name: 'ZeroRecipient',        inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'ZeroAmount',           inputs: [{ name: 'index', type: 'uint256' }] },
] as const

// ─── AskirawaFiTreasury contract ──────────────────────────────────────────────
//
// ⚠  UNAUDITED — HACKATHON DEMONSTRATION ONLY.
//    Do NOT deploy to hold substantial real-user funds until a professional
//    security audit has been completed and all findings resolved.
//
// NOT YET DEPLOYED. Deploy to Arc Mainnet and set VITE_TREASURY_ADDRESS
// in .env before enabling on-chain approval enforcement.
//
// Deployment prerequisites:
//   1. forge build  (already passes — 45/45 tests green)
//   2. Deploy AskirawaFiTreasury(usdcAddress, ownerAddress, approvers[], quorum)
//      usdcAddress = 0x3600000000000000000000000000000000000000 (verified)
//      ownerAddress = treasury admin wallet
//      approvers[]  = authorized approver wallet addresses
//      quorum       = number of approvals required (e.g. 2 for 2-of-3)
//   3. Set VITE_TREASURY_ADDRESS=<deployed address> in .env
//   4. Fund the treasury: call USDC.approve(treasuryAddress, amount)
//      then treasury.deposit(amount) from the treasury admin wallet.

/**
 * Address of the deployed AskirawaFiTreasury contract on Arc Mainnet.
 * null = not yet deployed; the UI falls back to localStorage-only mode.
 */
// Validate format: must start with "0x" and be exactly 42 characters (0x + 40 hex digits).
// A malformed value is treated as unset — produces isTreasuryDeployed=false rather than
// silently firing contract reads against a non-contract address.
const _rawTreasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS as string | undefined
export const TREASURY_ADDRESS: `0x${string}` | null =
  (_rawTreasuryAddress?.startsWith('0x') && _rawTreasuryAddress.length === 42)
    ? (_rawTreasuryAddress as `0x${string}`)
    : null

export const TREASURY_ABI = [
  // ─── Deposit ───────────────────────────────────────────────────────────────
  {
    type: 'function', name: 'deposit',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [], stateMutability: 'nonpayable',
  },
  // ─── Propose ───────────────────────────────────────────────────────────────
  {
    type: 'function', name: 'proposeTransfer',
    inputs: [
      { name: 'proposalId', type: 'bytes32' },
      { name: 'recipient',  type: 'address' },
      { name: 'amount',     type: 'uint256' },
      { name: 'expiresAt',  type: 'uint64'  },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'proposePayroll',
    inputs: [
      { name: 'proposalId', type: 'bytes32'   },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts',    type: 'uint256[]' },
      { name: 'expiresAt',  type: 'uint64'    },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'proposeConfigChange',
    inputs: [
      { name: 'proposalId',   type: 'bytes32'   },
      { name: 'newApprovers', type: 'address[]' },
      { name: 'newQuorum',    type: 'uint8'     },
      { name: 'expiresAt',    type: 'uint64'    },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
  // ─── Vote / Cancel / Execute ──────────────────────────────────────────────
  {
    type: 'function', name: 'vote',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [], stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'cancel',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [], stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'execute',
    inputs: [
      { name: 'proposalId', type: 'bytes32'   },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts',    type: 'uint256[]' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
  // ─── View ──────────────────────────────────────────────────────────────────
  {
    type: 'function', name: 'balance',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'owner',
    inputs: [], outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'quorum',
    inputs: [], outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'approverCount',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'approvers',
    inputs: [], outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'isApprover',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'proposals',
    inputs: [{ name: 'proposalId', type: 'bytes32' }],
    outputs: [
      { name: 'txType',        type: 'uint8'   },
      { name: 'executed',      type: 'bool'    },
      { name: 'cancelled',     type: 'bool'    },
      { name: 'expiresAt',     type: 'uint64'  },
      { name: 'contentHash',   type: 'bytes32' },
      { name: 'proposer',      type: 'address' },
      { name: 'approvalCount', type: 'uint16'  },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'voted',
    inputs: [
      { name: 'proposalId', type: 'bytes32' },
      { name: 'voter',      type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  // ─── Events ───────────────────────────────────────────────────────────────
  {
    type: 'event', name: 'Deposited',
    inputs: [
      { name: 'from',   type: 'address', indexed: true  },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Proposed',
    inputs: [
      { name: 'proposalId', type: 'bytes32', indexed: true  },
      { name: 'proposer',   type: 'address', indexed: true  },
      { name: 'txType',     type: 'uint8',   indexed: false },
      { name: 'expiresAt',  type: 'uint64',  indexed: false },
    ],
  },
  {
    type: 'event', name: 'Voted',
    inputs: [
      { name: 'proposalId',   type: 'bytes32', indexed: true  },
      { name: 'approver',     type: 'address', indexed: true  },
      { name: 'approvalCount',type: 'uint16',  indexed: false },
      { name: 'quorumNeeded', type: 'uint8',   indexed: false },
    ],
  },
  {
    type: 'event', name: 'Executed',
    inputs: [
      { name: 'proposalId', type: 'bytes32', indexed: true  },
      { name: 'txType',     type: 'uint8',   indexed: false },
      { name: 'totalUsdc',  type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PaymentSent',
    inputs: [
      { name: 'proposalId', type: 'bytes32', indexed: true  },
      { name: 'recipient',  type: 'address', indexed: true  },
      { name: 'amount',     type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Cancelled',
    inputs: [
      { name: 'proposalId', type: 'bytes32', indexed: true  },
      { name: 'by',         type: 'address', indexed: true  },
    ],
  },
  {
    type: 'event', name: 'ApproversUpdated',
    inputs: [
      { name: 'newApprovers', type: 'address[]', indexed: false },
      { name: 'newQuorum',    type: 'uint8',     indexed: false },
    ],
  },
] as const

export function formatDate(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
