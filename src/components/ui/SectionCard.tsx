/** SectionCard — the standard editorial card for table/list sections.
 *  Square corners, mono header strip, chamfered top-right corner, hairline border.
 */

interface SectionCardProps {
  title?: React.ReactNode
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  noPad?: boolean
  style?: React.CSSProperties
  /** Mono label for the header strip, e.g. "Recent activity" */
  label?: string
  /** Apply chamfered top-right corner */
  chamfer?: boolean
}

export default function SectionCard({ title, subtitle, actions, children, noPad: _noPad, style, label, chamfer }: SectionCardProps) {
  const chamferStyle: React.CSSProperties = chamfer
    ? { clipPath: 'polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%)' }
    : {}

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        ...chamferStyle,
        ...style,
      }}
    >
      {/* Header strip */}
      {(title || actions || label) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div>
            {label && (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--subtle)',
                display: 'block',
                marginBottom: title ? 2 : 0,
              }}>
                {label}
              </span>
            )}
            {title && (
              <div style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
              }}>
                {title}
              </div>
            )}
            {subtitle && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {subtitle}
              </div>
            )}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
        </div>
      )}
      <div className="table-scroll">{children}</div>
    </div>
  )
}
