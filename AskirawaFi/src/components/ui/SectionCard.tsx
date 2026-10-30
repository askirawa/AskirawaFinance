/** Replacement for Card + CardHeader + CardBody for table/list sections.
 *  More opinionated: handles the standard header pattern with a title,
 *  optional subtitle, and optional right-side actions.
 */

interface SectionCardProps {
  title?: React.ReactNode
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  noPad?: boolean
  style?: React.CSSProperties
}

export default function SectionCard({ title, subtitle, actions, children, noPad, style }: SectionCardProps) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            {title && (
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                {title}
              </div>
            )}
            {subtitle && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {subtitle}
              </div>
            )}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      )}
      <div style={noPad ? {} : { padding: '0' }}>
        {children}
      </div>
    </div>
  )
}
