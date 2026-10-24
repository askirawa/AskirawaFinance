interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
  action?: React.ReactNode
  /** Optional mono counter shown next to eyebrow, e.g. "01" */
  counter?: string
}

export default function PageHeader({ eyebrow, title, subtitle, action, counter }: PageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 36,
        paddingBottom: 24,
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      <div>
        {eyebrow && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 10,
          }}>
            {counter && (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: 'var(--subtle)',
                letterSpacing: '0.10em',
              }}>{counter}</span>
            )}
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
            fontSize: 'clamp(32px, 6vw, 44px)',
            fontWeight: 700,
            color: 'var(--ink)',
            letterSpacing: '-0.03em',
            lineHeight: 1.0,
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
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  )
}
