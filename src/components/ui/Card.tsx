import { cn } from '../../lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  /** Apply the chamfered top-right corner clip */
  chamfer?: boolean
  /** Hero (light) variant */
  hero?: boolean
}

interface CardSectionProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  /** Mono label shown on the left of the header strip (e.g. "Summary") */
  label?: string
  /** Optional right-side content in the header strip */
  action?: React.ReactNode
}

export default function Card({ children, className, style, onClick, chamfer, hero }: CardProps) {
  const chamferStyle: React.CSSProperties = chamfer
    ? { clipPath: 'polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%)' }
    : {}

  return (
    <div
      className={cn(className)}
      style={{
        background: hero
          ? 'linear-gradient(135deg, #F2F2F2 0%, #E0E0E0 100%)'
          : 'var(--surface)',
        border: hero ? '1px solid #CCCCCC' : '1px solid var(--border)',
        position: 'relative',
        ...chamferStyle,
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className, style, label, action }: CardSectionProps) {
  if (label) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: '1px solid var(--border)',
          ...style,
        }}
        className={className}
      >
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--subtle)',
        }}>
          {label}
        </span>
        {action ?? children}
      </div>
    )
  }

  return (
    <div
      className={cn('flex items-center justify-between px-6 py-4', className)}
      style={{ borderBottom: '1px solid var(--border)', ...style }}
    >
      {children}
    </div>
  )
}

export function CardBody({ children, className, style }: CardSectionProps) {
  return (
    <div className={cn('px-6 py-5', className)} style={style}>
      {children}
    </div>
  )
}
