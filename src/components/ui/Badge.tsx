import { cn } from '../../lib/utils'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'active'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

// Monochrome-first: only semantic states get color; neutral stays pure gray
const VARIANT_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  success: { color: 'var(--success)', background: 'var(--success-dim)', border: '1px solid var(--success-border)' },
  active:  { color: 'var(--success)', background: 'var(--success-dim)', border: '1px solid var(--success-border)' },
  warning: { color: 'var(--warning)', background: 'var(--warning-dim)', border: '1px solid var(--warning-border)' },
  danger:  { color: 'var(--danger)',  background: 'var(--danger-dim)',  border: '1px solid var(--danger-border)' },
  neutral: { color: 'var(--muted)',   background: 'var(--surface-2)',   border: '1px solid var(--border)' },
}

export default function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5', className)}
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        borderRadius: 0,
        ...VARIANT_STYLES[variant],
      }}
    >
      {children}
    </span>
  )
}
