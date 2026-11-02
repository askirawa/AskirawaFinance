/** Small form building blocks shared by the Payroll and Recurring Payments wizards. */
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import Button from '../ui/Button'

export const DRAFT_LABEL = 'Draft saved on this device, not on-chain'
export const TAP = 'min-h-[44px]'

export const inputStyle: CSSProperties = { minHeight: 44, width: '100%' }
export const errorInputStyle: CSSProperties = { ...inputStyle, borderColor: 'var(--danger)' }

export function Field({ label, htmlFor, error, hint, children }: {
  label: string; htmlFor?: string; error?: string | null; hint?: ReactNode; children: ReactNode
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{error}</div>
      ) : hint ? (
        <div style={{ color: 'var(--subtle)', fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{hint}</div>
      ) : null}
    </div>
  )
}

type Tone = 'info' | 'warning' | 'danger' | 'success'
const TONE_ICON = { info: Info, warning: AlertTriangle, danger: XCircle, success: CheckCircle2 }

export function Notice({ tone = 'info', title, children, style }: {
  tone?: Tone; title?: string; children?: ReactNode; style?: CSSProperties
}) {
  const Icon = TONE_ICON[tone]
  const color = `var(--${tone})`
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'}
         style={{ display: 'flex', gap: 12, padding: '12px 14px', background: `var(--${tone}-dim)`, border: `1px solid var(--${tone}-border)`, ...style }}>
      <Icon size={18} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)', minWidth: 0 }}>
        {title && <strong style={{ display: 'block', color: 'var(--ink)', marginBottom: 2 }}>{title}</strong>}
        {children}
      </div>
    </div>
  )
}

/** Honest local-draft indicator. Nothing here is on-chain. */
export function DraftBar({ visible, onDiscard }: { visible: boolean; onDiscard: () => void }) {
  if (!visible) return null
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16, padding: '8px 12px', border: '1px dashed var(--border-strong)' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{DRAFT_LABEL}</span>
      <Button variant="ghost" size="sm" className={TAP} onClick={onDiscard}>Discard draft</Button>
    </div>
  )
}

export function WizardNav({ onBack, onNext, nextLabel = 'Next', nextDisabled, backLabel = 'Back', hideBack, extra }: {
  onBack: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean
  backLabel?: string; hideBack?: boolean; extra?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
      {hideBack ? <span /> : <Button variant="secondary" className={TAP} arrow={false} onClick={onBack}>{backLabel}</Button>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {extra}
        {onNext && <Button className={TAP} disabled={nextDisabled} onClick={onNext}>{nextLabel}</Button>}
      </div>
    </div>
  )
}

/** Row of label / value pairs used in review screens. */
export function Facts({ items }: { items: { label: string; value: ReactNode; tone?: 'danger' | 'warning' }[] }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', gap: 1, margin: 0, background: 'var(--border)', border: '1px solid var(--border)' }}>
      {items.map((f) => (
        <div key={f.label} style={{ background: 'var(--surface)', padding: '12px 14px', minWidth: 0 }}>
          <dt style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--subtle)', marginBottom: 4 }}>{f.label}</dt>
          <dd style={{ margin: 0, fontSize: 15, fontWeight: 600, color: f.tone ? `var(--${f.tone})` : 'var(--ink)', overflowWrap: 'anywhere' }}>{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Technical information stays behind a disclosure. */
export function Details({ summary = 'Details', children }: { summary?: string; children: ReactNode }) {
  return (
    <details style={{ border: '1px solid var(--border)', padding: '0 14px', background: 'var(--surface-muted)' }}>
      <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center', fontSize: 13, color: 'var(--muted)' }}>{summary}</summary>
      <div style={{ padding: '4px 0 14px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{children}</div>
    </details>
  )
}

export function plainDuration(seconds: number): string {
  if (seconds <= 0) return 'no waiting period'
  if (seconds < 60) return 'less than a minute'
  if (seconds < 3600) {
    const m = Math.ceil(seconds / 60)
    return `${m} minute${m === 1 ? '' : 's'}`
  }
  if (seconds < 86400) {
    const h = Math.round(seconds / 360) / 10
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  const d = Math.round(seconds / 8640) / 10
  return `${d} day${d === 1 ? '' : 's'}`
}

/** Days approvers get to approve (mirrors useTreasuryActions: 7 days, longer only if the safety wait needs it, max 30). */
export function approvalWindowDays(delaySeconds: number): number {
  return Math.min(29, Math.max(7, Math.ceil((delaySeconds + 3660) / 86400)))
}

export function loadDraft(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

export function clearDraft(key: string) {
  try { localStorage.removeItem(key) } catch { /* storage unavailable */ }
}

/** Persists the unsent form only. Never used for payments, approvals or schedules. */
export function useDraftSaver(key: string, value: unknown, hasContent: boolean) {
  useEffect(() => {
    try {
      if (hasContent) localStorage.setItem(key, JSON.stringify(value))
      else localStorage.removeItem(key)
    } catch { /* storage unavailable or full: the draft is simply not kept */ }
  }, [key, value, hasContent])
}

export function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}
