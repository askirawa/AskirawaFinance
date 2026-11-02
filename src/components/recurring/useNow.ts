import { useEffect, useState } from 'react'

/** Current unix seconds, refreshed every 30 seconds so "due in" and retry texts stay honest. */
export function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}
