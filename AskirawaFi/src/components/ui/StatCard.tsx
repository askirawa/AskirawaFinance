import Spinner from './Spinner'

interface StatCardProps {
  label: string
  value: string | number | null | undefined
  note?: string
  accent?: boolean
  icon?: React.ReactNode
  trend?: { direction: 'up' | 'down' | 'neutral'; label: string }
}

export default function StatCard({ label, value, note, accent, icon, trend }: StatCardProps) {
  return (
    <div
      style={{
        background: accent ? 'rgba(53,217,139,0.06)' : 'var(--surface)',
        border: `1px solid ${accent ? 'var(--accent-border)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 112,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
          }}
        >
          {label}
        </span>
        {icon && (
          <span style={{ color: accent ? 'var(--accent)' : 'var(--subtle)', opacity: 0.8 }}>
            {icon}
          </span>
        )}
      </div>

      {value === null || value === undefined ? (
        <Spinner size={16} />
      ) : (
        <div
          className="display"
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: accent ? 'var(--accent)' : 'var(--ink)',
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.2,
          }}
        >
          {value}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        {note && (
          <span style={{ fontSize: 11, color: 'var(--subtle)' }}>{note}</span>
        )}
        {trend && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: trend.direction === 'up'
                ? 'var(--success)'
                : trend.direction === 'down'
                ? 'var(--danger)'
                : 'var(--muted)',
            }}
          >
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '·'} {trend.label}
          </span>
        )}
      </div>
    </div>
  )
}
