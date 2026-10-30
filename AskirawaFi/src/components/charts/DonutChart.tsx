/**
 * DonutChart — SVG donut chart for category breakdown.
 * No external charting library.
 */

import type { CategorySlice } from '../../lib/analytics'
import { formatUsdcBigint } from '../../lib/analytics'

interface DonutChartProps {
  slices: CategorySlice[]
  size?: number
}

const USDC_DECIMALS = 6

function toFloat(raw: bigint): number {
  return Number(raw) / 10 ** USDC_DECIMALS
}

export default function DonutChart({ slices, size = 180 }: DonutChartProps) {
  const total = slices.reduce((s, sl) => s + sl.amountRaw, 0n)

  if (total === 0n || slices.length === 0) {
    return (
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12 }}>
        No data
      </div>
    )
  }

  const cx = size / 2
  const cy = size / 2
  const R = size * 0.38
  const r = size * 0.22
  const totalFloat = toFloat(total)

  // Build arc paths
  let startAngle = -Math.PI / 2
  const arcs: { path: string; color: string; label: string; pct: number; slice: CategorySlice }[] = []

  for (const sl of slices) {
    if (sl.amountRaw === 0n) continue
    const pct = toFloat(sl.amountRaw) / totalFloat
    const angle = pct * 2 * Math.PI
    const endAngle = startAngle + angle

    const x1 = cx + R * Math.cos(startAngle)
    const y1 = cy + R * Math.sin(startAngle)
    const x2 = cx + R * Math.cos(endAngle)
    const y2 = cy + R * Math.sin(endAngle)
    const ix1 = cx + r * Math.cos(endAngle)
    const iy1 = cy + r * Math.sin(endAngle)
    const ix2 = cx + r * Math.cos(startAngle)
    const iy2 = cy + r * Math.sin(startAngle)

    const large = angle > Math.PI ? 1 : 0

    const path = [
      `M ${x1} ${y1}`,
      `A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${r} ${r} 0 ${large} 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ')

    arcs.push({ path, color: sl.color, label: sl.label, pct, slice: sl })
    startAngle = endAngle
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-label="Category breakdown donut chart"
      >
        {arcs.map((arc, i) => (
          <path key={i} d={arc.path} fill={arc.color} opacity={0.85}>
            <title>{`${arc.label}: $${formatUsdcBigint(arc.slice.amountRaw)} USDC (${(arc.pct * 100).toFixed(1)}%)`}</title>
          </path>
        ))}

        {/* Center label */}
        <text x={cx} y={cy - 5} textAnchor="middle" fontSize={11} fill="var(--muted)">Total</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink-2)">
          {`$${formatUsdcBigint(total).split('.')[0]}`}
        </text>
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: size + 40 }}>
        {arcs.map((arc, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: arc.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: 'var(--ink-2)' }}>{arc.label}</span>
            <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              {(arc.pct * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
