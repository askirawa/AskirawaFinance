import { cn } from '../../lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  children?: React.ReactNode
}

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-lg border transition-all cursor-pointer font-[inherit] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:   'bg-[var(--accent)] text-[#021a0e] border-transparent hover:bg-[var(--accent-hover)] focus-visible:outline-[var(--accent)]',
  secondary: 'bg-[var(--surface-strong)] text-[var(--ink)] border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus-visible:outline-[var(--border-focus)]',
  ghost:     'bg-transparent text-[var(--muted)] border-transparent hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
  danger:    'bg-[var(--danger-dim)] text-[var(--danger)] border-[var(--danger-border)] hover:bg-[rgba(232,96,122,0.18)] focus-visible:outline-[var(--danger)]',
  warning:   'bg-[var(--warning-dim)] text-[var(--warning)] border-[var(--warning-border)] hover:bg-[rgba(232,184,76,0.18)] focus-visible:outline-[var(--warning)]',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1.5 h-7',
  md: 'text-sm px-4 py-2 h-9',
  lg: 'text-sm px-5 py-2.5 h-10',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <svg
          className="animate-spin"
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children && <span>{children}</span>}
    </button>
  )
}
