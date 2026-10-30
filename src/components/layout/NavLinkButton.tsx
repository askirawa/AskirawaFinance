import type { NavItem } from './navItems'

interface NavLinkButtonProps {
  item: NavItem
  active: boolean
  /** Unread/pending count. Only shown when greater than zero. */
  count?: number
  height?: number
  fontSize?: number
  onSelect: () => void
}

/** One navigation row. Shows a count only for real data (for example unread notifications). */
export default function NavLinkButton({ item, active, count = 0, height = 48, fontSize = 14, onSelect }: NavLinkButtonProps) {
  return (
    <button
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        height,
        padding: '0 20px',
        border: 'none',
        borderLeft: active ? '3px solid var(--ink)' : '3px solid transparent',
        background: active ? 'var(--nav-active-bg)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--muted)',
        cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif",
        fontSize,
        fontWeight: active ? 600 : 400,
        transition: 'background 0.15s, color 0.15s',
        textAlign: 'left',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = 'var(--surface-hover)'
          e.currentTarget.style.color = 'var(--ink-2)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--muted)'
        }
      }}
    >
      <span style={{ flexShrink: 0, display: 'flex', opacity: active ? 1 : 0.7 }}>{item.icon}</span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {item.label}
      </span>
      {count > 0 && (
        <span
          aria-label={`${count} unread`}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--bg)',
            background: 'var(--ink)',
            minWidth: 20,
            height: 20,
            padding: '0 6px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
