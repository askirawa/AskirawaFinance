import { cn } from '../../lib/utils'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'active'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const VARIANT_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  success: { color: 'var(--success)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' },
  active: { color: 'var(--success)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' },
  warning: { color: 'var(--warning)', background: 'var(--warning-dim)', border: '1px solid rgba(232,184,76,0.25)' },
  danger: { color: 'var(--danger)', background: 'rgba(232,109,122,0.1)', border: '1px solid rgba(232,109,122,0.25)' },
  neutral: { color: 'var(--muted)', background: 'var(--surface-muted)', border: '1px solid var(--border)' },
}

export default function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}
      style={VARIANT_STYLES[variant]}
    >
      {children}
    </span>
  )
}
