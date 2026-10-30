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
        flexWrap: 'wrap',
      }}
    >
      <div>
        {eyebrow && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              marginBottom: 6,
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1
          className="display"
          style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--ink)',
            letterSpacing: '-0.025em',
            lineHeight: 1.2,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--muted)', lineHeight: 1.6 }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  )
}
