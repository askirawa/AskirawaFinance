import { hexToString, keccak256, stringToBytes, stringToHex, type Hex } from 'viem'

/** Short readable memos are stored as ASCII in the bytes32; longer ones are hashed. */
export function memoToBytes32(memo: string): Hex {
  const t = memo.trim()
  if (!t) return `0x${'0'.repeat(64)}`
  return stringToBytes(t).length <= 31 ? stringToHex(t, { size: 32 }) : keccak256(stringToBytes(t))
}

/** Returns the memo text when the bytes32 holds printable ASCII, else null. */
export function bytes32ToMemo(ref: Hex): string | null {
  try {
    const s = hexToString(ref, { size: 32 }).replace(/\0+$/g, '')
    return s.length > 0 && /^[\x20-\x7e]+$/.test(s) ? s : null
  } catch {
    return null
  }
}
