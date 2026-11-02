/**
 * Pending transaction hashes survive a page reload. Only the hash is kept here (a pointer, never proof).
 * After a reload the receipt is read from the network again, so "confirmed" always comes from the chain.
 */
import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import type { Hex } from 'viem'
import { TREASURY_CHAIN_ID } from './config'

const KEY = 'askirawa_pending_tx_v2'

export interface StoredTx { hash: Hex; chainId: number; startedAt: number }

function read(): StoredTx[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const isStored = (x: unknown): x is StoredTx => {
      if (typeof x !== 'object' || x === null) return false
      const r = x as Record<string, unknown>
      return typeof r.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(r.hash) && typeof r.chainId === 'number' && typeof r.startedAt === 'number'
    }
    return (parsed as unknown[]).filter(isStored)
  } catch {
    return []
  }
}

function write(list: StoredTx[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-20)))
  } catch {
    // storage unavailable: tracking after reload is simply not offered
  }
}

export function rememberPendingTx(hash: Hex) {
  write([...read().filter((t) => t.hash !== hash), { hash, chainId: TREASURY_CHAIN_ID, startedAt: Date.now() }])
}

export function forgetPendingTx(hash: Hex) {
  write(read().filter((t) => t.hash !== hash))
}

export type ResumedPhase = 'pending' | 'confirmed' | 'failed' | 'unknown'
export interface ResumedTx { hash: Hex; phase: ResumedPhase; startedAt: number }

/** Re-checks transactions that were submitted before this page was loaded. Runs once per page load. */
export function useResumedTransactions() {
  const client = usePublicClient({ chainId: TREASURY_CHAIN_ID })
  const queryClient = useQueryClient()
  // Read once when the page loads: these are the transactions that were in flight before the reload.
  const [stored] = useState(() => read().filter((t) => t.chainId === TREASURY_CHAIN_ID))
  const [items, setItems] = useState<ResumedTx[]>(() => stored.map((t) => ({ hash: t.hash, phase: 'pending' as ResumedPhase, startedAt: t.startedAt })))

  useEffect(() => {
    if (!client || stored.length === 0) return
    let cancelled = false
    for (const t of stored) {
      const patch = (phase: ResumedPhase) => {
        if (cancelled) return
        setItems((prev) => prev.map((x) => (x.hash === t.hash ? { ...x, phase } : x)))
      }
      client.waitForTransactionReceipt({ hash: t.hash, timeout: 10 * 60_000 }).then(
        (receipt) => {
          forgetPendingTx(t.hash)
          patch(receipt.status === 'success' ? 'confirmed' : 'failed')
          void queryClient.invalidateQueries()
        },
        () => patch('unknown'),
      )
    }
    return () => { cancelled = true }
  }, [client, queryClient, stored])

  const dismiss = (hash: Hex) => {
    forgetPendingTx(hash)
    setItems((prev) => prev.filter((x) => x.hash !== hash))
  }
  return { items, dismiss }
}
