import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUsdcAmount(value: string | number): string {
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(n)) return '0.00'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function parseOnchainError(error: unknown): string {
  const e = error as { message?: string; code?: number; shortMessage?: string; reason?: string }
  const msg = (e?.shortMessage || e?.reason || e?.message || '').toLowerCase()
  if (msg.includes('user rejected') || e?.code === 4001) return 'Transaction cancelled.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance'))
    return 'Insufficient balance. Please add funds and try again.'
  if (msg.includes('wrong network') || msg.includes('chain'))
    return 'Wrong network. Please switch to Arc Mainnet.'
  if (msg.includes('reverted')) {
    const m = msg.match(/reason="([^"]+)"/)
    return m ? `Transaction failed: ${m[1]}` : 'Transaction failed. Please try again.'
  }
  if (msg.includes('network') || msg.includes('timeout'))
    return 'Network error. Check your connection and retry.'
  return e?.shortMessage || e?.reason || 'Something went wrong. Please try again.'
}
