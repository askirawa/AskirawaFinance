import { cn } from '../../lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
}

interface CardSectionProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export default function Card({ children, className, style, onClick }: CardProps) {
  return (
    <div
      className={cn('rounded-2xl', className)}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className, style }: CardSectionProps) {
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
  return <div className={cn('px-6 py-5', className)} style={style}>{children}</div>
}
