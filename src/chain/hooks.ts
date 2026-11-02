/**
 * Read hooks. Every value shown in the app comes from the treasury contracts through these hooks.
 * Browser storage is never consulted for balances, approvals, payments or schedules.
 */
import { useMemo } from 'react'
import { useAccount, usePublicClient, useReadContracts } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { zeroAddress, type Address } from 'viem'
import { recurringModuleAbi, treasuryAbi } from './abi'
import {
  RECURRING_MODULE_ADDRESS,
  TREASURY_ADDRESS,
  TREASURY_CHAIN_ID,
  isModuleConfigured,
  isTreasuryConfigured,
} from './config'
import { decodeModuleAction, type ModuleActionView } from './decode'

const POLL_MS = 15_000
const treasuryBase = { address: TREASURY_ADDRESS ?? zeroAddress, abi: treasuryAbi, chainId: TREASURY_CHAIN_ID } as const
const moduleBase = {
  address: RECURRING_MODULE_ADDRESS ?? zeroAddress,
  abi: recurringModuleAbi,
  chainId: TREASURY_CHAIN_ID,
} as const

export type TreasuryState = 'unconfigured' | 'loading' | 'no-contract' | 'error' | 'ready'

export interface TreasuryOverview {
  state: TreasuryState
  balance: bigint
  quorum: number
  paused: boolean
  approvers: readonly Address[]
  proposers: readonly Address[]
  guardian: Address | null
  requestCount: number
  epoch: bigint
  payrollDelay: number
  configDelay: number
  coolingEnd: bigint
  recovery: Address | null
  refetch: () => void
}

export function useTreasuryOverview(): TreasuryOverview {
  const publicClient = usePublicClient({ chainId: TREASURY_CHAIN_ID })
  const code = useQuery({
    queryKey: ['treasury-code', TREASURY_ADDRESS, TREASURY_CHAIN_ID],
    enabled: isTreasuryConfigured && !!publicClient,
    queryFn: async () => (await publicClient!.getCode({ address: TREASURY_ADDRESS! })) ?? '0x',
    staleTime: 60_000,
  })
  const reads = useReadContracts({
    contracts: [
      { ...treasuryBase, functionName: 'balance' },
      { ...treasuryBase, functionName: 'quorum' },
      { ...treasuryBase, functionName: 'paused' },
      { ...treasuryBase, functionName: 'approvers' },
      { ...treasuryBase, functionName: 'proposers' },
      { ...treasuryBase, functionName: 'guardian' },
      { ...treasuryBase, functionName: 'nextProposalId' },
      { ...treasuryBase, functionName: 'currentEpoch' },
      { ...treasuryBase, functionName: 'payrollDelay' },
      { ...treasuryBase, functionName: 'configDelay' },
      { ...treasuryBase, functionName: 'coolingEnd' },
      { ...treasuryBase, functionName: 'recovery' },
    ],
    query: { enabled: isTreasuryConfigured && code.data !== undefined && code.data !== '0x', refetchInterval: POLL_MS },
  })

  const r = reads.data
  const ok = (i: number) => r?.[i]?.status === 'success'
  const val = <T,>(i: number, fallback: T): T => (ok(i) ? (r![i].result as T) : fallback)

  let state: TreasuryState = 'ready'
  if (!isTreasuryConfigured) state = 'unconfigured'
  else if (code.isLoading || (code.data !== '0x' && reads.isLoading)) state = 'loading'
  else if (code.data === '0x') state = 'no-contract'
  else if (code.isError || reads.isError || !ok(0)) state = 'error'

  const guardian = val<Address>(5, zeroAddress)
  const recovery = val<Address>(11, zeroAddress)
  return {
    state,
    balance: val(0, 0n),
    quorum: Number(val(1, 0)),
    paused: val(2, false),
    approvers: val<readonly Address[]>(3, []),
    proposers: val<readonly Address[]>(4, []),
    guardian: guardian === zeroAddress ? null : guardian,
    requestCount: Math.max(0, Number(val(6, 1n)) - 1),
    epoch: val(7, 0n),
    payrollDelay: Number(val(8, 0)),
    configDelay: Number(val(9, 0)),
    coolingEnd: val(10, 0n),
    recovery: recovery === zeroAddress ? null : recovery,
    refetch: () => void reads.refetch(),
  }
}

/** What the connected wallet can actually do on-chain. These flags come from the contract, never from the UI. */
export function useMyPermissions() {
  const { address } = useAccount()
  const overview = useTreasuryOverview()
  const isApprover = !!address && overview.approvers.some((a) => a.toLowerCase() === address.toLowerCase())
  const isProposerOnly = !!address && overview.proposers.some((a) => a.toLowerCase() === address.toLowerCase())
  const isGuardian = !!address && !!overview.guardian && overview.guardian.toLowerCase() === address.toLowerCase()
  return { address, isApprover, canCreate: isApprover || isProposerOnly, isGuardian, overview }
}

export interface PayrollLine {
  to: Address
  amount: bigint
}

export interface RequestView {
  id: number
  action: number
  /** Derived on-chain state, index into STATUS_VIEW. */
  status: number
  proposer: Address
  createdAt: bigint
  approvedAt: bigint
  executableAt: bigint
  expiresAt: bigint
  approvals: number
  rejections: number
  quorum: number
  totalAmount: bigint
  memoRef: `0x${string}`
  /** 0 none, 1 approved, 2 rejected by the connected wallet. */
  myVote: number
  payroll?: PayrollLine[]
  moduleAction?: ModuleActionView | null
}

/** Newest-first list of requests, read from the contract. */
export function useRequests(limit = 40) {
  const { address } = useAccount()
  const overview = useTreasuryOverview()
  const ready = overview.state === 'ready'
  const ids = useMemo(() => {
    const out: number[] = []
    for (let id = overview.requestCount; id >= 1 && out.length < limit; id--) out.push(id)
    return out
  }, [overview.requestCount, limit])

  const me = address ?? zeroAddress
  const first = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...treasuryBase, functionName: 'getProposal' as const, args: [BigInt(id)] as const },
      { ...treasuryBase, functionName: 'status' as const, args: [BigInt(id)] as const },
      { ...treasuryBase, functionName: 'voteOf' as const, args: [BigInt(id), me] as const },
    ]),
    query: { enabled: ready && ids.length > 0, refetchInterval: POLL_MS },
  })

  const detailTargets = useMemo(() => {
    const list: { id: number; action: number }[] = []
    ids.forEach((id, i) => {
      const p = first.data?.[i * 3]
      if (p?.status === 'success') list.push({ id, action: Number((p.result as { action: number }).action) })
    })
    return list
  }, [ids, first.data])

  const details = useReadContracts({
    contracts: detailTargets.map((t) =>
      t.action === 1
        ? { ...treasuryBase, functionName: 'getPayroll' as const, args: [BigInt(t.id), 0n, 100n] as const }
        : { ...treasuryBase, functionName: 'getPayload' as const, args: [BigInt(t.id)] as const },
    ),
    query: { enabled: ready && detailTargets.length > 0, refetchInterval: POLL_MS * 2 },
  })

  const items: RequestView[] = useMemo(() => {
    const detailById = new Map<number, unknown>()
    detailTargets.forEach((t, i) => {
      const d = details.data?.[i]
      if (d?.status === 'success') detailById.set(t.id, d.result)
    })
    const out: RequestView[] = []
    ids.forEach((id, i) => {
      const p = first.data?.[i * 3]
      const s = first.data?.[i * 3 + 1]
      const v = first.data?.[i * 3 + 2]
      if (p?.status !== 'success' || s?.status !== 'success') return
      const pr = p.result as {
        action: number; proposer: Address; createdAt: bigint; approvedAt: bigint; executableAt: bigint
        expiresAt: bigint; approvals: number; rejections: number; quorum: number; totalAmount: bigint
        memoRef: `0x${string}`
      }
      const detail = detailById.get(id)
      const view: RequestView = {
        id,
        action: Number(pr.action),
        status: Number(s.result),
        proposer: pr.proposer,
        createdAt: pr.createdAt,
        approvedAt: pr.approvedAt,
        executableAt: pr.executableAt,
        expiresAt: pr.expiresAt,
        approvals: Number(pr.approvals),
        rejections: Number(pr.rejections),
        quorum: Number(pr.quorum),
        totalAmount: pr.totalAmount,
        memoRef: pr.memoRef,
        myVote: v?.status === 'success' ? Number(v.result) : 0,
      }
      if (Number(pr.action) === 1 && detail) view.payroll = (detail as readonly PayrollLine[]).map((l) => ({ ...l }))
      if (Number(pr.action) === 4 && detail) view.moduleAction = decodeModuleAction(detail as `0x${string}`)
      out.push(view)
    })
    return out
  }, [ids, first.data, details.data, detailTargets])

  return {
    items,
    isLoading: overview.state === 'loading' || first.isLoading,
    isError: first.isError,
    refetch: () => {
      void first.refetch()
      void details.refetch()
    },
  }
}

export interface ScheduleView {
  id: number
  recipient: Address
  amount: bigint
  frequency: number
  status: number
  startTime: bigint
  nextDue: bigint
  nextRetryAt: bigint
  endTime: bigint
  executedCount: number
  maxExecutions: number
  failures: number
  totalPaid: bigint
  executor: Address
  createdByProposal: bigint
  memoRef: `0x${string}`
  dueNow: boolean
}

export function useSchedules(limit = 50) {
  const overview = useTreasuryOverview()
  const enabled = overview.state === 'ready' && isModuleConfigured
  const count = useReadContracts({
    contracts: [{ ...moduleBase, functionName: 'scheduleCount' }],
    query: { enabled, refetchInterval: POLL_MS },
  })
  const total = count.data?.[0]?.status === 'success' ? Number(count.data[0].result) : 0
  const ids = useMemo(() => {
    const out: number[] = []
    for (let id = total; id >= 1 && out.length < limit; id--) out.push(id)
    return out
  }, [total, limit])
  const reads = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...moduleBase, functionName: 'getSchedule' as const, args: [BigInt(id)] as const },
      { ...moduleBase, functionName: 'isDue' as const, args: [BigInt(id)] as const },
    ]),
    query: { enabled: enabled && ids.length > 0, refetchInterval: POLL_MS },
  })
  const items: ScheduleView[] = useMemo(() => {
    const out: ScheduleView[] = []
    ids.forEach((id, i) => {
      const s = reads.data?.[i * 2]
      const d = reads.data?.[i * 2 + 1]
      if (s?.status !== 'success') return
      const r = s.result as unknown as ScheduleView
      out.push({
        id,
        recipient: r.recipient,
        amount: r.amount,
        frequency: Number(r.frequency),
        status: Number(r.status),
        startTime: r.startTime,
        nextDue: r.nextDue,
        nextRetryAt: r.nextRetryAt,
        endTime: r.endTime,
        executedCount: Number(r.executedCount),
        maxExecutions: Number(r.maxExecutions),
        failures: Number(r.failures),
        totalPaid: r.totalPaid,
        executor: r.executor,
        createdByProposal: r.createdByProposal,
        memoRef: r.memoRef,
        dueNow: d?.status === 'success' ? Boolean(d.result) : false,
      })
    })
    return out
  }, [ids, reads.data])
  return { items, isLoading: count.isLoading || reads.isLoading, moduleConfigured: isModuleConfigured }
}
