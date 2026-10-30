/**
 * useAnalytics — aggregates payroll, recurring, and approval records
 * into a unified AnalyticsSummary for the Analytics dashboard.
 *
 * Also reads the live USDC balance of the connected wallet from Arc Mainnet.
 */

import { useMemo } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { loadBatches } from '../lib/payroll'
import { loadSchedules } from '../lib/recurring'
import { loadRequests } from '../lib/approvals'
import {
  payrollToTxRecords,
  recurringToTxRecords,
  approvalsToTxRecords,
  deduplicateTxRecords,
  filterTxRecords,
  computeSummary,
  buildDailyBuckets,
  buildCategoryBreakdown,
  buildDateRange,
  generateTransactionCsv,
  downloadCsv,
  formatUsdcBigint,
  type TxFilter,
  type DateRangePreset,
  type AnalyticsTx,
} from '../lib/analytics'

// ─── USDC contract on Arc Mainnet ─────────────────────────────────────────────
// Arc Mainnet chain ID: 5042
// USDC address imported from onchain-facts via getUsdc()

import { getUsdc } from '../onchain-facts'

const ARC_MAINNET_CHAIN_ID = 5042
const USDC_INFO = getUsdc(ARC_MAINNET_CHAIN_ID)

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalytics(filter: TxFilter) {
  const { address, isConnected, chainId } = useAccount()
  const isCorrectChain = chainId === ARC_MAINNET_CHAIN_ID

  // Live USDC balance of connected wallet
  const { data: usdcBalanceRaw, isLoading: balanceLoading, refetch: refetchBalance } = useReadContract({
    address: USDC_INFO?.address as `0x${string}` | undefined,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address && isCorrectChain && !!USDC_INFO },
  })

  const usdcBalanceFormatted = useMemo(() => {
    if (!usdcBalanceRaw) return null
    return formatUsdcBigint(usdcBalanceRaw)
  }, [usdcBalanceRaw])

  // Load all source records from localStorage
  const allTxRecords = useMemo((): AnalyticsTx[] => {
    const batches = loadBatches()
    const schedules = loadSchedules()
    const requests = loadRequests()

    const payrollTxs = payrollToTxRecords(batches)
    const recurringTxs = recurringToTxRecords(schedules)
    const approvalTxs = approvalsToTxRecords(requests)

    return deduplicateTxRecords([...payrollTxs, ...recurringTxs, ...approvalTxs])
  }, []) // re-computed on mount; callers can force refresh by remounting or calling refresh

  // Apply filters
  const filteredRecords = useMemo(() => filterTxRecords(allTxRecords, filter), [allTxRecords, filter])

  // Summary metrics
  const summary = useMemo(() => computeSummary(filteredRecords), [filteredRecords])

  // Chart data
  const dailyBuckets = useMemo(
    () => buildDailyBuckets(filteredRecords, filter.dateRange),
    [filteredRecords, filter.dateRange]
  )

  const categoryBreakdown = useMemo(
    () => buildCategoryBreakdown(filteredRecords),
    [filteredRecords]
  )

  // Sorted transaction list (most recent first)
  const sortedRecords = useMemo(
    () => [...filteredRecords].sort((a, b) => b.timestamp - a.timestamp),
    [filteredRecords]
  )

  function exportCsv() {
    const rangeLabel = filter.dateRange.preset
    const fromLabel = new Date(filter.dateRange.from).toLocaleDateString()
    const toLabel = new Date(filter.dateRange.to).toLocaleDateString()
    const content = generateTransactionCsv({
      records: sortedRecords,
      summary,
      rangeLabel,
      fromLabel,
      toLabel,
    })
    const ts = new Date().toISOString().slice(0, 10)
    downloadCsv(content, `askirawafi-treasury-${ts}.csv`)
  }

  return {
    // Live wallet data
    address,
    isConnected,
    isCorrectChain,
    usdcBalanceFormatted,
    usdcBalanceRaw: usdcBalanceRaw,
    balanceLoading,
    refetchBalance,
    // Analytics
    allTxCount: allTxRecords.length,
    summary,
    dailyBuckets,
    categoryBreakdown,
    sortedRecords,
    exportCsv,
  }
}

// ─── Date range builder re-export ────────────────────────────────────────────

export { buildDateRange }
export type { DateRangePreset }
