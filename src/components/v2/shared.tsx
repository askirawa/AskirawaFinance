import type { CSSProperties, ReactNode } from 'react'
import { formatUnitsFixed, parseUnitsExact } from '../../onchain-money'
import { V2_USDC_DECIMALS, addressUrl } from '../../lib/v2/config'

export const mono: CSSProperties = { fontFamily: "'JetBrains Mono', monospace" }

export const inputStyle: CSSProperties = {
  width: '100%', height: 40, padding: '0 12px', background: 'var(--surface-2)', color: 'var(--ink)',
  border: '1px solid var(--border-strong)', borderRadius: 0, fontSize: 13, ...mono, outline: 'none',
}

export const labelStyle: CSSProperties = {
  ...mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--subtle)', marginBottom: 6, display: 'block',
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{hint}</span>}
    </label>
  )
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const c = { neutral: ['var(--muted)', 'var(--surface-2)', 'var(--border)'], warning: ['var(--warning)', 'var(--warning-dim)', 'var(--warning-border)'],
    danger: ['var(--danger)', 'var(--danger-dim)', 'var(--danger-border)'], success: ['var(--success)', 'var(--success-dim)', 'var(--success-border)'] }[tone]
  return <div style={{ color: c[0], background: c[1], border: `1px solid ${c[2]}`, padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>{children}</div>
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function AddressLink({ address }: { address: string }) {
  return (
    <a href={addressUrl(address)} target="_blank" rel="noopener noreferrer" style={{ ...mono, fontSize: 12, color: 'var(--ink-2)' }} title={address}>
      {shortAddr(address)}
    </a>
  )
}

/** Raw 6-decimal USDC units to a display string. */
export const usdc = (raw: bigint, digits = 2) => formatUnitsFixed(raw, V2_USDC_DECIMALS, digits)

/** Parse a user-typed USDC amount; returns null when invalid or zero. */
export function parseAmountInput(v: string): bigint | null {
  try {
    const n = parseUnitsExact(v.trim(), V2_USDC_DECIMALS)
    return n > 0n ? n : null
  } catch {
    return null
  }
}

export const grid: CSSProperties = { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }

export { bytes32ToMemo, memoToBytes32 } from '../../lib/v2/memo'
