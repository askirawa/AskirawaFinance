import { useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, type LucideIcon } from 'lucide-react'
import SectionCard from '../ui/SectionCard'
import { addressUrl, NETWORK } from '../../chain/config'
import { shortAddress } from '../../chain/format'

const MONO = "'JetBrains Mono', monospace"

/** A titled section with a white feature icon and a padded body. */
export function Panel({ icon: Icon, title, subtitle, actions, children }: {
  icon: LucideIcon; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode
}) {
  return (
    <SectionCard
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <span className="feature-icon" style={{ display: 'inline-flex' }}><Icon size={16} /></span>{title}
      </span>}
      subtitle={subtitle}
      actions={actions}
    >
      <div style={{ padding: 16 }}>{children}</div>
    </SectionCard>
  )
}

/** Label on the left, value on the right; stacks on narrow screens. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: '0 0 190px', fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--subtle)', paddingTop: 2 }}>{label}</div>
      <div style={{ flex: '1 1 240px', minWidth: 0, color: 'var(--ink-2)', fontSize: 14, overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  )
}

export const note: CSSProperties = { margin: '12px 0 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }

export function CopyButton({ value, label = 'Copy address' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch {
      setDone(false)
    }
  }
  return (
    <button type="button" onClick={() => void copy()} aria-label={label}
      style={{ minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: 'pointer', fontSize: 12, padding: '0 10px' }}>
      <span className="feature-icon" style={{ display: 'inline-flex' }}>{done ? <Check size={14} /> : <Copy size={14} />}</span>
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

/** Short address, explorer link and copy button. */
export function AddressLine({ address }: { address: string | null }) {
  if (!address) return <span style={{ color: 'var(--muted)' }}>Not set up</span>
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <span className="mono" title={address} style={{ fontSize: 13 }}>{shortAddress(address)}</span>
      <a href={addressUrl(address)} target="_blank" rel="noopener noreferrer"
        style={{ color: 'var(--ink-2)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, textDecoration: 'underline', minHeight: 44 }}>
        View on {NETWORK.name} explorer <ExternalLink size={13} />
      </a>
      <CopyButton value={address} />
    </span>
  )
}

/** Plain-language duration from seconds. */
export function duration(seconds: number): string {
  if (seconds <= 0) return 'none'
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (seconds % 86400 === 0) return plural(seconds / 86400, 'day')
  if (seconds % 3600 === 0) return plural(seconds / 3600, 'hour')
  if (seconds >= 86400) return `${plural(Math.floor(seconds / 86400), 'day')} ${plural(Math.round((seconds % 86400) / 3600), 'hour')}`
  if (seconds >= 3600) return plural(Math.round(seconds / 3600), 'hour')
  return plural(Math.max(1, Math.round(seconds / 60)), 'minute')
}
