/**
 * useTreasury — On-chain AskirawaFiTreasury contract integration.
 *
 * ⚠  UNAUDITED — HACKATHON DEMONSTRATION ONLY.
 *    Do NOT use for substantial production funds until an independent
 *    security audit has been completed and findings resolved.
 *
 * When VITE_TREASURY_ADDRESS is unset, TREASURY_ADDRESS is null and
 * every hook returns an `isDeployed: false` indicator. The existing
 * localStorage-based approval flows continue to work unchanged.
 *
 * When deployed:
 *   - useTreasuryBalance()   reads on-chain USDC balance held by the contract.
 *   - useTreasuryPropose()   submits a transfer or payroll proposal on-chain.
 *   - useTreasuryVote()      casts an on-chain approval vote.
 *   - useTreasuryExecute()   executes a fully-approved proposal on-chain.
 *   - useTreasuryCancel()    cancels a proposal (owner only).
 *   - useTreasuryProposal()  reads a single proposal's current state.
 *   - useTreasuryConfig()    reads quorum, approver count, and owner.
 *   - useIsApprover()        checks if the connected wallet is an approver.
 *
 * Proposal ID derivation:
 *   proposalId = keccak256(abi.encodePacked(offChainId, chainId, contractAddress))
 *   The frontend generates this deterministically from the localStorage record ID.
 *   This links the on-chain proposal to its off-chain record.
 *
 * The localStorage record is kept as a cache/display layer.
 * On-chain state is authoritative for execution.
 */

import { useCallback, useState } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  usePublicClient,
} from 'wagmi'
import { keccak256, encodePacked } from 'viem'
import { TREASURY_ADDRESS, TREASURY_ABI } from '../lib/contract'
import { ARC_MAINNET_CHAIN_ID } from '../config'

const CHAIN_ID = ARC_MAINNET_CHAIN_ID

// ─── Deployment guard ─────────────────────────────────────────────────────────

export const isTreasuryDeployed = !!TREASURY_ADDRESS

/** Stable read-only guard. Returns false and logs a disclosure when not deployed. */
function assertDeployed(): `0x${string}` {
  if (!TREASURY_ADDRESS) {
    throw new Error(
      'AskirawaFiTreasury not deployed. ' +
      'Set VITE_TREASURY_ADDRESS in .env after deploying the contract.'
    )
  }
  return TREASURY_ADDRESS
}

// ─── Proposal ID helper ───────────────────────────────────────────────────────

/**
 * Derive a deterministic bytes32 proposal ID from the off-chain record ID.
 * Binds to the contract address so the same off-chain ID on a different
 * contract produces a different proposal ID.
 */
export function deriveProposalId(offChainId: string): `0x${string}` {
  if (!TREASURY_ADDRESS) return `0x${'0'.repeat(64)}`
  return keccak256(
    encodePacked(
      ['string', 'uint256', 'address'],
      [offChainId, BigInt(CHAIN_ID), TREASURY_ADDRESS]
    )
  )
}

// ─── useWrongNetwork ──────────────────────────────────────────────────────────

/**
 * Returns true when a wallet is connected on a chain that is NOT Arc Mainnet.
 * Used to surface a proactive wrong-network warning before any treasury write
 * call, rather than letting the call fail silently with a string error.
 *
 * Also returns the required chain ID so the UI can ask wagmi to switch.
 */
export function useWrongNetwork() {
  const { chainId, isConnected } = useAccount()
  return {
    isWrongNetwork: isConnected && chainId !== CHAIN_ID,
    requiredChainId: CHAIN_ID,
    connectedChainId: chainId ?? null,
  }
}

// ─── useTreasuryBalance ───────────────────────────────────────────────────────

/**
 * Reads the USDC balance held by the deployed treasury contract.
 * Returns null when not deployed.
 */
export function useTreasuryBalance() {
  const { data, isLoading, refetch } = useReadContract({
    address: TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    abi: TREASURY_ABI,
    functionName: 'balance',
    chainId: CHAIN_ID,
    query: { enabled: isTreasuryDeployed },
  })
  const raw = typeof data === 'bigint' ? data : 0n
  const divisor = 10n ** 6n
  const formatted = isTreasuryDeployed
    ? `${(Number(raw / divisor)).toLocaleString('en-US')}.${(raw % divisor).toString().padStart(6, '0').replace(/0+$/, '') || '0'}`
    : null
  return { raw, formatted, isLoading, refetch, isDeployed: isTreasuryDeployed }
}

// ─── useTreasuryConfig ────────────────────────────────────────────────────────

export function useTreasuryConfig() {
  const { data: quorum } = useReadContract({
    address: TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    abi: TREASURY_ABI,
    functionName: 'quorum',
    chainId: CHAIN_ID,
    query: { enabled: isTreasuryDeployed },
  })
  const { data: approverCount } = useReadContract({
    address: TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    abi: TREASURY_ABI,
    functionName: 'approverCount',
    chainId: CHAIN_ID,
    query: { enabled: isTreasuryDeployed },
  })
  const { data: owner } = useReadContract({
    address: TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    abi: TREASURY_ABI,
    functionName: 'owner',
    chainId: CHAIN_ID,
    query: { enabled: isTreasuryDeployed },
  })
  return {
    quorum: typeof quorum === 'number' ? quorum : null,
    approverCount: typeof approverCount === 'bigint' ? Number(approverCount) : null,
    owner: typeof owner === 'string' ? owner : null,
    isDeployed: isTreasuryDeployed,
  }
}

// ─── useIsApprover ────────────────────────────────────────────────────────────

export function useIsApprover() {
  const { address } = useAccount()
  const { data } = useReadContract({
    address: TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    abi: TREASURY_ABI,
    functionName: 'isApprover',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: CHAIN_ID,
    query: { enabled: isTreasuryDeployed && !!address },
  })
  return { isApprover: typeof data === 'boolean' ? data : false, isDeployed: isTreasuryDeployed }
}

// ─── useTreasuryProposal ──────────────────────────────────────────────────────

export interface OnChainProposal {
  txType: number
  executed: boolean
  cancelled: boolean
  expiresAt: number
  contentHash: `0x${string}`
  proposer: `0x${string}`
  approvalCount: number
}

export function useTreasuryProposal(proposalId: `0x${string}` | null) {
  const { data, isLoading, refetch } = useReadContract({
    address: TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    abi: TREASURY_ABI,
    functionName: 'proposals',
    args: [proposalId ?? `0x${'0'.repeat(64)}`],
    chainId: CHAIN_ID,
    query: { enabled: isTreasuryDeployed && !!proposalId },
  })

  let proposal: OnChainProposal | null = null
  if (data && Array.isArray(data) && data.length === 7) {
    proposal = {
      txType:        Number(data[0]),
      executed:      Boolean(data[1]),
      cancelled:     Boolean(data[2]),
      expiresAt:     Number(data[3]),
      contentHash:   data[4],
      proposer:      data[5],
      approvalCount: Number(data[6]),
    }
  }

  return { proposal, isLoading, refetch, isDeployed: isTreasuryDeployed }
}

// ─── useTreasuryVote ──────────────────────────────────────────────────────────

export function useTreasuryVote() {
  const { chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const vote = useCallback(async (proposalId: `0x${string}`): Promise<string | null> => {
    if (!isTreasuryDeployed) { setError('Contract not deployed.'); return null }
    if (chainId !== CHAIN_ID) { setError('Switch to Arc Mainnet.'); return null }
    if (!publicClient) { setError('Public client unavailable.'); return null }

    setIsPending(true)
    setError(null)
    try {
      const addr = assertDeployed()
      const hash = await writeContractAsync({
        address: addr,
        abi: TREASURY_ABI,
        functionName: 'vote',
        args: [proposalId],
        chainId: CHAIN_ID,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') { setError('Vote transaction reverted.'); return null }
      return hash
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || 'Vote failed.'
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  return { vote, isPending, error }
}

// ─── useTreasuryCancel ────────────────────────────────────────────────────────

export function useTreasuryCancel() {
  const { chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cancel = useCallback(async (proposalId: `0x${string}`): Promise<string | null> => {
    if (!isTreasuryDeployed) { setError('Contract not deployed.'); return null }
    if (chainId !== CHAIN_ID) { setError('Switch to Arc Mainnet.'); return null }
    if (!publicClient) { setError('Public client unavailable.'); return null }

    setIsPending(true)
    setError(null)
    try {
      const addr = assertDeployed()
      const hash = await writeContractAsync({
        address: addr,
        abi: TREASURY_ABI,
        functionName: 'cancel',
        args: [proposalId],
        chainId: CHAIN_ID,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') { setError('Cancel transaction reverted.'); return null }
      return hash
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || 'Cancel failed.'
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  return { cancel, isPending, error }
}

// ─── useTreasuryPropose ───────────────────────────────────────────────────────

export interface ProposeTransferParams {
  offChainId: string       // the localStorage request ID — used to derive proposalId
  recipient: `0x${string}`
  amount: bigint           // raw USDC (6 decimals)
  expiresAt: number        // unix timestamp (seconds)
}

export interface ProposePayrollParams {
  offChainId: string
  recipients: `0x${string}`[]
  amounts: bigint[]
  expiresAt: number
}

export function useTreasuryPropose() {
  const { chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const proposeTransfer = useCallback(async (
    params: ProposeTransferParams
  ): Promise<{ hash: string; proposalId: `0x${string}` } | null> => {
    if (!isTreasuryDeployed) { setError('Contract not deployed.'); return null }
    if (chainId !== CHAIN_ID) { setError('Switch to Arc Mainnet.'); return null }
    if (!publicClient) { setError('Public client unavailable.'); return null }

    setIsPending(true)
    setError(null)
    try {
      const addr = assertDeployed()
      const proposalId = deriveProposalId(params.offChainId)
      const hash = await writeContractAsync({
        address: addr,
        abi: TREASURY_ABI,
        functionName: 'proposeTransfer',
        args: [proposalId, params.recipient, params.amount, BigInt(params.expiresAt)],
        chainId: CHAIN_ID,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') { setError('Proposal transaction reverted.'); return null }
      return { hash, proposalId }
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || 'Proposal failed.'
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  const proposePayroll = useCallback(async (
    params: ProposePayrollParams
  ): Promise<{ hash: string; proposalId: `0x${string}` } | null> => {
    if (!isTreasuryDeployed) { setError('Contract not deployed.'); return null }
    if (chainId !== CHAIN_ID) { setError('Switch to Arc Mainnet.'); return null }
    if (!publicClient) { setError('Public client unavailable.'); return null }

    setIsPending(true)
    setError(null)
    try {
      const addr = assertDeployed()
      const proposalId = deriveProposalId(params.offChainId)
      const hash = await writeContractAsync({
        address: addr,
        abi: TREASURY_ABI,
        functionName: 'proposePayroll',
        args: [proposalId, params.recipients, params.amounts, BigInt(params.expiresAt)],
        chainId: CHAIN_ID,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') { setError('Payroll proposal transaction reverted.'); return null }
      return { hash, proposalId }
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || 'Payroll proposal failed.'
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  return { proposeTransfer, proposePayroll, isPending, error }
}

// ─── useTreasuryExecute ───────────────────────────────────────────────────────

export interface ExecuteTransferParams {
  proposalId: `0x${string}`
  recipients: `0x${string}`[]
  amounts: bigint[]
}

export function useTreasuryExecute() {
  const { chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(async (
    params: ExecuteTransferParams
  ): Promise<string | null> => {
    if (!isTreasuryDeployed) { setError('Contract not deployed.'); return null }
    if (chainId !== CHAIN_ID) { setError('Switch to Arc Mainnet.'); return null }
    if (!publicClient) { setError('Public client unavailable.'); return null }

    setIsPending(true)
    setError(null)
    try {
      const addr = assertDeployed()
      const hash = await writeContractAsync({
        address: addr,
        abi: TREASURY_ABI,
        functionName: 'execute',
        args: [params.proposalId, params.recipients, params.amounts],
        chainId: CHAIN_ID,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        setError('Execute transaction reverted. Verify quorum, expiry, and payload.')
        return null
      }
      return hash
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || 'Execution failed.'
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  return { execute, isPending, error }
}

// ─── useTreasuryPayroll ───────────────────────────────────────────────────────
//
// Wraps the full payroll-batch treasury lifecycle:
//   1. proposePayroll(proposalId, recipients[], amounts[], expiresAt)
//   2. vote(proposalId)         — called by distinct approvers
//   3. execute(proposalId, recipients[], amounts[])  — after quorum
//
// The recipients[] and amounts[] passed to propose are frozen at that point and
// must be passed unchanged to execute(). They are returned in ProposeResult so
// the caller can persist them and use them for execute without re-reading state.

export interface PayrollProposeParams {
  /** Off-chain batch ID — used to derive the on-chain proposalId. */
  offChainId: string
  recipients: `0x${string}`[]
  amounts: bigint[]          // raw USDC (6 decimals)
  expiresAt: number          // unix timestamp seconds
}

export interface PayrollProposeResult {
  hash: string
  proposalId: `0x${string}`
  /** The exact recipients frozen in the content hash — must be used for execute(). */
  frozenRecipients: `0x${string}`[]
  /** The exact amounts frozen in the content hash — must be used for execute(). */
  frozenAmounts: bigint[]
}

export function useTreasuryPayroll() {
  const { chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const propose = useCallback(async (
    params: PayrollProposeParams
  ): Promise<PayrollProposeResult | null> => {
    if (!isTreasuryDeployed) { setError('Treasury contract not deployed.'); return null }
    if (chainId !== CHAIN_ID) { setError('Switch to Arc Mainnet.'); return null }
    if (!publicClient) { setError('Public client unavailable.'); return null }
    if (params.recipients.length === 0) { setError('Batch is empty.'); return null }
    if (params.recipients.length !== params.amounts.length) {
      setError('Recipients and amounts arrays must be the same length.')
      return null
    }

    setIsPending(true)
    setError(null)
    try {
      const addr = assertDeployed()
      const proposalId = deriveProposalId(params.offChainId)

      // Freeze a snapshot of the arrays — these are what the content hash commits to.
      const frozenRecipients = [...params.recipients] as `0x${string}`[]
      const frozenAmounts = [...params.amounts]

      const hash = await writeContractAsync({
        address: addr,
        abi: TREASURY_ABI,
        functionName: 'proposePayroll',
        args: [proposalId, frozenRecipients, frozenAmounts, BigInt(params.expiresAt)],
        chainId: CHAIN_ID,
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        setError('proposePayroll transaction reverted. Check gas, expiry, and approver status.')
        return null
      }

      return { hash, proposalId, frozenRecipients, frozenAmounts }
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || 'Proposal failed.'
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  /**
   * Execute an approved payroll proposal.
   * MUST receive the exact same frozenRecipients and frozenAmounts that were
   * passed to propose(). Any substitution causes a PayloadHashMismatch revert.
   */
  const executePayroll = useCallback(async (params: {
    proposalId: `0x${string}`
    frozenRecipients: `0x${string}`[]
    frozenAmounts: bigint[]
  }): Promise<string | null> => {
    if (!isTreasuryDeployed) { setError('Treasury contract not deployed.'); return null }
    if (chainId !== CHAIN_ID) { setError('Switch to Arc Mainnet.'); return null }
    if (!publicClient) { setError('Public client unavailable.'); return null }

    setIsPending(true)
    setError(null)
    try {
      const addr = assertDeployed()
      const hash = await writeContractAsync({
        address: addr,
        abi: TREASURY_ABI,
        functionName: 'execute',
        args: [params.proposalId, params.frozenRecipients, params.frozenAmounts],
        chainId: CHAIN_ID,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        setError('Execute transaction reverted. Verify quorum, expiry, and that payload is unchanged.')
        return null
      }
      return hash
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || 'Execution failed.'
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  return { propose, executePayroll, isPending, error }
}

// ─── useTreasuryRecurringPropose ──────────────────────────────────────────────
//
// Proposes a single recurring payment period as a TRANSFER proposal.
// The recipient and amount are frozen at propose-time and returned so the
// caller can persist them for the later execute() call.
//
// Duplicate execution prevention: the caller is responsible for checking
// that no confirmed or processing ExecutionRecord already exists for the
// same scheduledFor period before calling propose().

export interface RecurringProposeParams {
  /** Off-chain execution record ID — used to derive the on-chain proposalId. */
  offChainExecId: string
  recipient: `0x${string}`
  amount: bigint             // raw USDC (6 decimals)
  expiresAt: number          // unix timestamp seconds
}

export interface RecurringProposeResult {
  hash: string
  proposalId: `0x${string}`
  frozenRecipient: `0x${string}`
  frozenAmount: bigint
}

export function useTreasuryRecurringPropose() {
  const { chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const proposeExecution = useCallback(async (
    params: RecurringProposeParams
  ): Promise<RecurringProposeResult | null> => {
    if (!isTreasuryDeployed) { setError('Treasury contract not deployed.'); return null }
    if (chainId !== CHAIN_ID) { setError('Switch to Arc Mainnet.'); return null }
    if (!publicClient) { setError('Public client unavailable.'); return null }

    setIsPending(true)
    setError(null)
    try {
      const addr = assertDeployed()
      const proposalId = deriveProposalId(params.offChainExecId)

      const frozenRecipient = params.recipient
      const frozenAmount = params.amount

      const hash = await writeContractAsync({
        address: addr,
        abi: TREASURY_ABI,
        functionName: 'proposeTransfer',
        args: [proposalId, frozenRecipient, frozenAmount, BigInt(params.expiresAt)],
        chainId: CHAIN_ID,
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        setError('proposeTransfer transaction reverted. Check approver status and expiry window.')
        return null
      }

      return { hash, proposalId, frozenRecipient, frozenAmount }
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || 'Recurring proposal failed.'
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  /**
   * Execute an approved recurring payment proposal.
   * MUST use the exact frozenRecipient and frozenAmount returned by proposeExecution().
   */
  const executeExecution = useCallback(async (params: {
    proposalId: `0x${string}`
    frozenRecipient: `0x${string}`
    frozenAmount: bigint
  }): Promise<string | null> => {
    if (!isTreasuryDeployed) { setError('Treasury contract not deployed.'); return null }
    if (chainId !== CHAIN_ID) { setError('Switch to Arc Mainnet.'); return null }
    if (!publicClient) { setError('Public client unavailable.'); return null }

    setIsPending(true)
    setError(null)
    try {
      const addr = assertDeployed()
      const hash = await writeContractAsync({
        address: addr,
        abi: TREASURY_ABI,
        functionName: 'execute',
        args: [params.proposalId, [params.frozenRecipient], [params.frozenAmount]],
        chainId: CHAIN_ID,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        setError('Execute transaction reverted. Check quorum, expiry, and payload integrity.')
        return null
      }
      return hash
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || 'Execution failed.'
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  return { proposeExecution, executeExecution, isPending, error }
}
