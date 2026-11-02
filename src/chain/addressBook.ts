/**
 * Display names for wallet addresses and request titles.
 * These are LABELS kept in this browser only. They carry no authority and are never used as proof of
 * identity, approval or payment. The UI says so wherever names are entered.
 */
import { useCallback, useEffect, useState } from 'react'
import { keccak256, toBytes } from 'viem'

const KEY = 'askirawa_labels_v2'
type Labels = Record<string, string>

function read(): Labels {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Labels
  } catch {
    return {}
  }
}

export function memoRefFor(title: string): `0x${string}` {
  const clean = title.trim()
  return clean ? keccak256(toBytes(clean)) : (`0x${'0'.repeat(64)}`)
}

export function useLabels() {
  const [labels, setLabels] = useState<Labels>(read)
  useEffect(() => {
    const onStorage = () => setLabels(read())
    window.addEventListener('storage', onStorage)
    window.addEventListener('askirawa-labels', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('askirawa-labels', onStorage)
    }
  }, [])

  const save = useCallback((entries: Labels) => {
    const next = { ...read(), ...entries }
    localStorage.setItem(KEY, JSON.stringify(next))
    window.dispatchEvent(new Event('askirawa-labels'))
  }, [])

  const nameOf = useCallback((address: string) => labels[`addr:${address.toLowerCase()}`], [labels])
  const titleOf = useCallback((memoRef: string) => labels[`memo:${memoRef.toLowerCase()}`], [labels])
  const saveName = useCallback((address: string, name: string) => save({ [`addr:${address.toLowerCase()}`]: name.trim() }), [save])
  const saveTitle = useCallback((title: string) => {
    const ref = memoRefFor(title)
    if (title.trim()) save({ [`memo:${ref.toLowerCase()}`]: title.trim() })
    return ref
  }, [save])

  return { nameOf, titleOf, saveName, saveTitle }
}
