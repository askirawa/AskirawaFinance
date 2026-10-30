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

import { useCallback, useEffect, useState } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  usePublicClient,
} from 'wagmi'
import { keccak256, encodePacked } from 'viem'
import { TREASURY_ADDRESS, TREASURY_ABI } from '../lib/contract'
import { ARC_MAINNET_CHAIN_ID } from '../config'
import { friendlyTxError } from '../lib/approvals'

const CHAIN_ID = ARC_MAINNET_CHAIN_ID

// ─── Deployment guard ─────────────────────────────────────────────────────────

export const isTreasuryDeployed = !!TREASURY_ADDRESS

/** Stable read-only guard. Returns false and logs a disclosure when not deployed. */
function assertDeployed(): `0x${string}` {
  if (!TREASURY_ADDRESS) {
    throw new Error(
      'The treasury contract has not been set up yet, so this action is not available.'
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

// ─── useVoteEligibility ───────────────────────────────────────────────────────

export interface VoteEligibility {
  /** True only when the connected wallet may approve this request right now. */
  canVote: boolean
  /** Plain-English reason when canVote is false and the user should know why. */
  reason: string | null
  /** True while the wallet's approval status is still being loaded. */
  isLoading: boolean
}

/**
 * Mirrors the contract's vote() rules so the Approve button is only shown to a
 * wallet that is an approver, did not create the request, has not already approved
 * it, and only while the request is still open. The contract remains the final check.
 */
export function useVoteEligibility(proposalId: `0x${string}` | null): VoteEligibility {
  const { address } = useAccount()
  const { isApprover } = useIsApprover()
  const { proposal, isLoading: proposalLoading } = useTreasuryProposal(proposalId)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(t)
  }, [])

  const { data: votedData, isLoading: votedLoading } = useReadContract({
    address: TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    abi: TREASURY_ABI,
    functionName: 'voted',
    args: [proposalId ?? `0x${'0'.repeat(64)}`, address ?? '0x0000000000000000000000000000000000000000'],
    chainId: CHAIN_ID,
    // Re-read when the approval count changes so the button hides right after you approve
    scopeKey: `approvals-${proposal?.approvalCount ?? 0}`,
    query: { enabled: isTreasuryDeployed && !!proposalId && !!address },
  })

  const isLoading = proposalLoading || votedLoading
  const no = (reason: string | null): VoteEligibility => ({ canVote: false, reason, isLoading })

  if (!address) return no('Connect your wallet to approve.')
  if (isLoading || !proposal) return no(null)
  if (proposal.executed) return no(null)
  if (proposal.cancelled) return no(null)
  if (proposal.expiresAt !== 0 && nowSec >= proposal.expiresAt) {
    return no('This approval request has expired.')
  }
  if (!isApprover) return no('Only approvers can approve this request.')
  if (proposal.proposer.toLowerCase() === address.toLowerCase()) {
    return no('You created this request, so another approver must approve it.')
  }
  if (votedData === true) return no('You have already approved this request.')
  return { canVote: true, reason: null, isLoading }
}

// ─── useTreasuryVote ──────────────────────────────────────────────────────────

export function useTreasuryVote() {
  const { chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const vote = useCallback(async (proposalId: `0x${string}`): Promise<string | null> => {
    if (!isTreasuryDeployed) { setError('The treasury contract has not been set up yet, so this action is not available.'); return null }
    if (chainId !== CHAIN_ID) { setError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return null }
    if (!publicClient) { setError('Could not connect to the network. Refresh the page and try again.'); return null }

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
      if (receipt.status !== 'success') { setError('The network rejected your approval. Refresh the page and try again.'); return null }
      return hash
    } catch (err) {
      const msg = friendlyTxError(err, 'Your approval was not recorded. Check your wallet and try again.')
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
    if (!isTreasuryDeployed) { setError('The treasury contract has not been set up yet, so this action is not available.'); return null }
    if (chainId !== CHAIN_ID) { setError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return null }
    if (!publicClient) { setError('Could not connect to the network. Refresh the page and try again.'); return null }

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
      if (receipt.status !== 'success') { setError('The network rejected the cancellation. Refresh the page and try again.'); return null }
      return hash
    } catch (err) {
      const msg = friendlyTxError(err, 'The request was not cancelled. Check your wallet and try again.')
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
    if (!isTreasuryDeployed) { setError('The treasury contract has not been set up yet, so this action is not available.'); return null }
    if (chainId !== CHAIN_ID) { setError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return null }
    if (!publicClient) { setError('Could not connect to the network. Refresh the page and try again.'); return null }

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
      if (receipt.status !== 'success') { setError('The network rejected the request. Check that your wallet is allowed to submit requests, then try again.'); return null }
      return { hash, proposalId }
    } catch (err) {
      const msg = friendlyTxError(err, 'The request was not submitted. Check your wallet and try again.')
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  const proposePayroll = useCallback(async (
    params: ProposePayrollParams
  ): Promise<{ hash: string; proposalId: `0x${string}` } | null> => {
    if (!isTreasuryDeployed) { setError('The treasury contract has not been set up yet, so this action is not available.'); return null }
    if (chainId !== CHAIN_ID) { setError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return null }
    if (!publicClient) { setError('Could not connect to the network. Refresh the page and try again.'); return null }

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
      if (receipt.status !== 'success') { setError('The network rejected the payroll request. Check that your wallet is allowed to submit requests, then try again.'); return null }
      return { hash, proposalId }
    } catch (err) {
      const msg = friendlyTxError(err, 'The payroll request was not submitted. Check your wallet and try again.')
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
    if (!isTreasuryDeployed) { setError('The treasury contract has not been set up yet, so this action is not available.'); return null }
    if (chainId !== CHAIN_ID) { setError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return null }
    if (!publicClient) { setError('Could not connect to the network. Refresh the page and try again.'); return null }

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
        setError('The network rejected the payment. Check that it has all its approvals and has not expired, then try again.')
        return null
      }
      return hash
    } catch (err) {
      const msg = friendlyTxError(err, 'The payment was not sent. Check your wallet and try again.')
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
    if (!isTreasuryDeployed) { setError('The treasury contract has not been set up yet, so this action is not available.'); return null }
    if (chainId !== CHAIN_ID) { setError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return null }
    if (!publicClient) { setError('Could not connect to the network. Refresh the page and try again.'); return null }
    if (params.recipients.length === 0) { setError('Add at least one recipient before submitting.'); return null }
    if (params.recipients.length !== params.amounts.length) {
      setError('Each recipient needs an amount. Check the list and try again.')
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
        setError('The network rejected the payroll request. Check that your wallet is allowed to submit requests and that the expiry date is valid, then try again.')
        return null
      }

      return { hash, proposalId, frozenRecipients, frozenAmounts }
    } catch (err) {
      const msg = friendlyTxError(err, 'The request was not submitted. Check your wallet and try again.')
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
    if (!isTreasuryDeployed) { setError('The treasury contract has not been set up yet, so this action is not available.'); return null }
    if (chainId !== CHAIN_ID) { setError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return null }
    if (!publicClient) { setError('Could not connect to the network. Refresh the page and try again.'); return null }

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
        setError('The network rejected the payment. Check that it has all its approvals, has not expired and has not been changed, then try again.')
        return null
      }
      return hash
    } catch (err) {
      const msg = friendlyTxError(err, 'The payment was not sent. Check your wallet and try again.')
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
    if (!isTreasuryDeployed) { setError('The treasury contract has not been set up yet, so this action is not available.'); return null }
    if (chainId !== CHAIN_ID) { setError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return null }
    if (!publicClient) { setError('Could not connect to the network. Refresh the page and try again.'); return null }

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
        setError('The network rejected the request. Check that your wallet is allowed to submit requests and that the expiry date is valid, then try again.')
        return null
      }

      return { hash, proposalId, frozenRecipient, frozenAmount }
    } catch (err) {
      const msg = friendlyTxError(err, 'The recurring payment request was not submitted. Check your wallet and try again.')
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
    if (!isTreasuryDeployed) { setError('The treasury contract has not been set up yet, so this action is not available.'); return null }
    if (chainId !== CHAIN_ID) { setError('Your wallet is on the wrong network. Switch to Arc Mainnet and try again.'); return null }
    if (!publicClient) { setError('Could not connect to the network. Refresh the page and try again.'); return null }

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
        setError('The network rejected the payment. Check that it has all its approvals, has not expired and has not been changed, then try again.')
        return null
      }
      return hash
    } catch (err) {
      const msg = friendlyTxError(err, 'The payment was not sent. Check your wallet and try again.')
      setError(msg)
      return null
    } finally {
      setIsPending(false)
    }
  }, [chainId, publicClient, writeContractAsync])

  return { proposeExecution, executeExecution, isPending, error }
}
