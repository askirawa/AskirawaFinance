import { describe, expect, test } from 'bun:test'
import { validateSiwe } from './siwe'

// PLACEHOLDER address: tests only compare strings.
const ADDR = '0x1111111111111111111111111111111111111111'
const NOW = Date.parse('2026-11-02T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

function msg(over: Partial<Record<string, string>> = {}) {
  const f = { domain: 'app.example.com', address: ADDR, version: '1', chain: '5042', nonce: 'abc123', issued: iso(NOW - 1000), exp: iso(NOW + 3600_000), ...over }
  return [
    `${f.domain} wants you to sign in with your Ethereum account:`, f.address, '', 'Sign in to Askirawa Finance.', '',
    'URI: https://app.example.com', `Version: ${f.version}`, `Chain ID: ${f.chain}`, `Nonce: ${f.nonce}`, `Issued At: ${f.issued}`, `Expiration Time: ${f.exp}`,
  ].join('\n')
}
const rules = { expectedAddress: ADDR, nonce: 'abc123', allowedDomains: ['app.example.com'], allowedChainIds: [5042, 5042002], now: NOW }

describe('validateSiwe', () => {
  test('accepts a well formed message', () => expect(validateSiwe(msg(), rules)).toEqual({ ok: true }))
  test('rejects a message whose nonce is not the issued one (replay of an old signature)', () => {
    const r = validateSiwe(msg({ nonce: 'old-nonce' }), rules)
    expect(r.ok).toBe(false)
  })
  test('rejects when the same nonce line appears twice', () => {
    const dup = msg() + '\nNonce: abc123'
    expect(validateSiwe(dup, rules).ok).toBe(false)
  })
  test('rejects another domain', () => expect(validateSiwe(msg({ domain: 'evil.example' }), rules).ok).toBe(false))
  test('rejects another address', () => expect(validateSiwe(msg({ address: '0x2222222222222222222222222222222222222222' }), rules).ok).toBe(false))
  test('rejects a chain that is not allowed', () => expect(validateSiwe(msg({ chain: '1' }), rules).ok).toBe(false))
  test('rejects an expired message', () => expect(validateSiwe(msg({ exp: iso(NOW - 1) }), rules).ok).toBe(false))
  test('rejects a message with no expiration', () => {
    const noExp = msg().split('\n').filter((l) => !l.startsWith('Expiration Time')).join('\n')
    expect(validateSiwe(noExp, rules).ok).toBe(false)
  })
  test('rejects an old issued-at', () => expect(validateSiwe(msg({ issued: iso(NOW - 11 * 60_000) }), rules).ok).toBe(false))
  test('rejects an issued-at in the future', () => expect(validateSiwe(msg({ issued: iso(NOW + 10 * 60_000), exp: iso(NOW + 3600_000) }), rules).ok).toBe(false))
  test('rejects an overlong validity window', () => expect(validateSiwe(msg({ exp: iso(NOW + 48 * 3600_000) }), rules).ok).toBe(false))
  test('rejects an unsupported version', () => expect(validateSiwe(msg({ version: '2' }), rules).ok).toBe(false))
  test('rejects plain text', () => expect(validateSiwe('hello', rules).ok).toBe(false))
})
