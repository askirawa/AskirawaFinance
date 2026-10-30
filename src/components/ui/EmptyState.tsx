import { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      style={{ color: 'var(--muted)' }}
    >
      <div
        className="mb-4 flex items-center justify-center rounded-2xl"
        style={{
          width: 52,
          height: 52,
          background: 'var(--surface-muted)',
          border: '1px solid var(--border)',
          color: 'var(--subtle)',
        }}
      >
        <Icon size={22} strokeWidth={1.5} />
      </div>
      <p className="mb-1 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
        {title}
      </p>
      <p className="text-xs max-w-xs" style={{ color: 'var(--muted)' }}>
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
