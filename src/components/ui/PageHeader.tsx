interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
  action?: React.ReactNode
}

export default function PageHeader({ eyebrow, title, subtitle, action }: PageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 28,
        paddingBottom: 20,
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 260px' }}>
        {eyebrow && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 10,
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
            }}>
              {eyebrow}
            </span>
          </div>
        )}
        <h1
          style={{
            margin: 0,
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 'clamp(28px, 6vw, 44px)',
            fontWeight: 700,
            color: 'var(--ink)',
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{
            margin: '10px 0 0',
            fontSize: 15,
            color: 'var(--muted)',
            lineHeight: 1.6,
            maxWidth: 540,
          }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div style={{ flexShrink: 0, maxWidth: '100%' }}>{action}</div>}
    </div>
  )
}
