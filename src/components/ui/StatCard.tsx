import Spinner from './Spinner'

interface StatCardProps {
  label: string
  value: string | number | null | undefined
  note?: string
  accent?: boolean
  icon?: React.ReactNode
  trend?: { direction: 'up' | 'down' | 'neutral'; label: string }
  /** Mono section counter shown top-right, e.g. "01" */
  counter?: string
}

export default function StatCard({ label, value, note, accent: _accent, icon, trend, counter }: StatCardProps) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 112,
        position: 'relative',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--subtle)',
        }}>
          {label}
        </span>
        {counter ? (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: 'var(--subtle)',
            letterSpacing: '0.06em',
          }}>{counter}</span>
        ) : icon ? (
          <span style={{ color: 'var(--subtle)', opacity: 0.7 }}>{icon}</span>
        ) : null}
      </div>

      {/* Value */}
      {value === null || value === undefined ? (
        <Spinner size={16} />
      ) : (
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 28,
          fontWeight: 700,
          color: 'var(--ink)',
          letterSpacing: '-0.03em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}>
          {value}
        </div>
      )}

      {/* Footer row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        {note && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: 'var(--subtle)',
            letterSpacing: '0.06em',
          }}>{note}</span>
        )}
        {trend && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.06em',
            color: trend.direction === 'up'
              ? 'var(--success)'
              : trend.direction === 'down'
              ? 'var(--danger)'
              : 'var(--muted)',
          }}>
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '·'} {trend.label}
          </span>
        )}
      </div>
    </div>
  )
}
