/** Askirawa Finance logo mark and wordmark, shared by the sidebar and the mobile drawer. */
export default function BrandMark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <div style={{
        width: 30,
        height: 30,
        background: 'var(--ink)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 800,
          fontSize: 14,
          color: 'var(--bg)',
          lineHeight: 1,
        }}>A</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: 14,
          color: 'var(--ink)',
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
        }}>
          Askirawa Finance
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--subtle)',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
        }}>
          USDC Treasury on Arc
        </div>
      </div>
    </div>
  )
}
