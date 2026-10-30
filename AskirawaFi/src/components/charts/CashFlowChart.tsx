/**
 * CashFlowChart — SVG bar chart showing daily outgoing vs incoming USDC.
 * No external charting library — pure SVG + React.
 */

import { useMemo } from 'react'
import type { DailyBucket } from '../../lib/analytics'
import { formatUsdcBigint } from '../../lib/analytics'

interface CashFlowChartProps {
  buckets: DailyBucket[]
  height?: number
}

const USDC_DECIMALS = 6

function toFloat(raw: bigint): number {
  return Number(raw) / 10 ** USDC_DECIMALS
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}

export default function CashFlowChart({ buckets, height = 160 }: CashFlowChartProps) {
  const data = useMemo(() => buckets.map(b => ({
    date: b.date,
    out: toFloat(b.outgoing),
    inc: toFloat(b.incoming),
  })), [buckets])

  const maxVal = useMemo(() => {
    const m = Math.max(...data.map(d => Math.max(d.out, d.inc)), 0.01)
    return m * 1.15   // 15% headroom
  }, [data])

  if (data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
        No activity in this period
      </div>
    )
  }

  const W = 800
  const H = height
  const PAD_LEFT = 58
  const PAD_RIGHT = 12
  const PAD_TOP = 12
  const PAD_BOTTOM = 28
  const chartW = W - PAD_LEFT - PAD_RIGHT
  const chartH = H - PAD_TOP - PAD_BOTTOM

  const n = data.length
  const slotW = chartW / n
  const barW = Math.max(4, Math.min(slotW * 0.35, 18))
  const barGap = Math.max(1, barW * 0.25)

  function barX(i: number, isOut: boolean): number {
    const center = PAD_LEFT + i * slotW + slotW / 2
    return isOut ? center - barW - barGap / 2 : center + barGap / 2
  }
  function barY(val: number): number {
    return PAD_TOP + chartH * (1 - val / maxVal)
  }
  function barH(val: number): number {
    return Math.max(0, chartH * (val / maxVal))
  }

  // Y axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    y: PAD_TOP + chartH * (1 - f),
    label: f === 0 ? '0' : formatUsdcBigint(BigInt(Math.round(maxVal * f * 10 ** USDC_DECIMALS))).split('.')[0],
  }))

  // X axis: show at most 8 labels
  const step = Math.ceil(n / 8)
  const xLabels = data
    .map((d, i) => ({ i, label: shortDate(d.date) }))
    .filter(({ i }) => i % step === 0 || i === n - 1)

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', minWidth: 280, display: 'block' }}
        aria-label="Cash flow bar chart"
      >
        {/* Grid lines */}
        {yTicks.map(t => (
          <line
            key={t.y}
            x1={PAD_LEFT} x2={W - PAD_RIGHT}
            y1={t.y} y2={t.y}
            stroke="var(--border)" strokeWidth={0.8}
          />
        ))}

        {/* Y axis labels */}
        {yTicks.map(t => (
          <text
            key={t.y}
            x={PAD_LEFT - 6}
            y={t.y + 4}
            textAnchor="end"
            fontSize={10}
            fill="var(--subtle)"
          >
            {t.label}
          </text>
        ))}

        {/* Bars */}
        {data.map((d, i) => (
          <g key={d.date}>
            {/* Outgoing */}
            {d.out > 0 && (
              <rect
                x={barX(i, true)}
                y={barY(d.out)}
                width={barW}
                height={barH(d.out)}
                fill="var(--danger)"
                opacity={0.75}
                rx={2}
              >
                <title>{`${d.date} Outgoing: $${d.out.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC`}</title>
              </rect>
            )}
            {/* Incoming */}
            {d.inc > 0 && (
              <rect
                x={barX(i, false)}
                y={barY(d.inc)}
                width={barW}
                height={barH(d.inc)}
                fill="var(--accent)"
                opacity={0.75}
                rx={2}
              >
                <title>{`${d.date} Incoming: $${d.inc.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC`}</title>
              </rect>
            )}
          </g>
        ))}

        {/* X axis labels */}
        {xLabels.map(({ i, label }) => (
          <text
            key={i}
            x={PAD_LEFT + i * slotW + slotW / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize={10}
            fill="var(--subtle)"
          >
            {label}
          </text>
        ))}

        {/* Legend */}
        <rect x={W - 160} y={6} width={10} height={10} fill="var(--danger)" opacity={0.75} rx={2} />
        <text x={W - 146} y={15} fontSize={10} fill="var(--muted)">Outgoing</text>
        <rect x={W - 95} y={6} width={10} height={10} fill="var(--accent)" opacity={0.75} rx={2} />
        <text x={W - 81} y={15} fontSize={10} fill="var(--muted)">Incoming</text>
      </svg>
    </div>
  )
}
