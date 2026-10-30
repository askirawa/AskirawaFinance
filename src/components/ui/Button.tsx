import { ArrowUpRight } from 'lucide-react'
import { cn } from '../../lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  /** Show the ↗ arrow icon on the right (editorial style). Defaults true for primary. */
  arrow?: boolean
  children?: React.ReactNode
}

// Square-cornered, left-aligned text, arrow pushed right
const BASE =
  'inline-flex items-center font-semibold border transition-all cursor-pointer font-[inherit] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-white'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:   'bg-[var(--ink)] text-[var(--bg)] border-[var(--ink)] hover:bg-[var(--ink-2)] hover:border-[var(--ink-2)]',
  secondary: 'bg-transparent text-[var(--ink)] border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:border-[var(--ink)]',
  ghost:     'bg-transparent text-[var(--muted)] border-transparent hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
  danger:    'bg-[var(--danger-dim)] text-[var(--danger)] border-[var(--danger-border)] hover:bg-[rgba(200,92,106,0.18)]',
  warning:   'bg-[var(--warning-dim)] text-[var(--warning)] border-[var(--warning-border)] hover:bg-[rgba(200,151,58,0.18)]',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 gap-2 h-8',
  md: 'text-sm px-4 gap-2 h-10',
  lg: 'text-sm px-5 gap-3 h-14',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  arrow,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const showArrow = arrow ?? (variant === 'primary' && !icon)

  return (
    <button
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      style={{ borderRadius: 0 }}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <svg
          className="animate-spin shrink-0"
          width={13}
          height={13}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children && <span className="flex-1">{children}</span>}
      {showArrow && !loading && (
        <ArrowUpRight size={13} strokeWidth={1.5} className="shrink-0 opacity-70" />
      )}
    </button>
  )
}
