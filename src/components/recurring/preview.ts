/**
 * Preview of payment dates. Mirrors ScheduleMath.add in the contract (UTC, Gregorian):
 * Daily +24h, Weekly +7 days, Monthly = calendar months from the ANCHOR with last-day clamping,
 * always computed from the anchor, never from a previously clamped date.
 * This is for display only. The contract calculates the real dates.
 */
export type FrequencyIndex = 0 | 1 | 2

const DAY = 86_400

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

export function daysInMonth(year: number, month0: number): number {
  if (month0 === 1) return isLeapYear(year) ? 29 : 28
  return [3, 5, 8, 10].includes(month0) ? 30 : 31
}

/** Payment number n (0 = the anchor itself), in unix seconds. */
export function paymentAt(anchor: number, frequency: FrequencyIndex, n: number): number {
  if (frequency === 0) return anchor + n * DAY
  if (frequency === 1) return anchor + n * 7 * DAY
  const d = new Date(anchor * 1000)
  const months = d.getUTCFullYear() * 12 + d.getUTCMonth() + n
  const year = Math.floor(months / 12)
  const month0 = months % 12
  const day = Math.min(d.getUTCDate(), daysInMonth(year, month0))
  const secondsOfDay = ((anchor % DAY) + DAY) % DAY
  return Date.UTC(year, month0, day) / 1000 + secondsOfDay
}

/** Next `count` payment dates. A payment due after `endTime` (when set) is not listed. */
export function previewDates(anchor: number, frequency: FrequencyIndex, count = 3, endTime = 0): number[] {
  const out: number[] = []
  for (let n = 0; n < count; n++) {
    const t = paymentAt(anchor, frequency, n)
    if (endTime > 0 && t > endTime) break
    out.push(t)
  }
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "2025-03-31 00:00 UTC" */
export function utcLabel(seconds: number | bigint): string {
  const d = new Date(Number(seconds) * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export function todayUtc(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** "YYYY-MM-DD" (from an <input type="date">) as unix seconds at 00:00 UTC. Null when it is not a real date. */
export function dateInputToUnix(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1970 || y > 9999 || mo < 1 || mo > 12 || da < 1 || da > daysInMonth(y, mo - 1)) return null
  return Date.UTC(y, mo - 1, da) / 1000
}

export const FREQUENCY_HELP = [
  'Every 24 hours from the start date.',
  'Every 7 days from the start date.',
  'The same day each month. In shorter months the last day of the month is used.',
] as const
