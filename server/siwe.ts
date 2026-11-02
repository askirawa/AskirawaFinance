/**
 * Sign-In With Ethereum (EIP-4361) message validation, kept pure so it can be unit tested.
 *
 * The server issues a nonce, the wallet signs a message that CONTAINS that nonce, and the server checks
 * that the message really names the issued nonce, this app's domain, an allowed chain and a short validity
 * window. Without this binding an old signature for any other message could be replayed with a fresh nonce.
 * The signature itself is verified separately (see index.ts).
 */
export interface SiweRules {
  expectedAddress: string
  /** The nonce the server issued and the client claims to be answering. */
  nonce: string
  /** Hosts allowed in the message domain, for example "app.example.com" or "localhost:5173". */
  allowedDomains: string[]
  allowedChainIds: number[]
  now?: number
  /** Longest accepted gap between "Issued At" and "Expiration Time". */
  maxLifetimeMs?: number
  /** How old "Issued At" may be. */
  maxAgeMs?: number
}

export type SiweResult = { ok: true } | { ok: false; reason: string }

const HEADER = ' wants you to sign in with your Ethereum account:'

function field(lines: string[], name: string): string | undefined {
  const prefix = `${name}: `
  const hits = lines.filter((l) => l.startsWith(prefix))
  if (hits.length !== 1) return undefined // missing or duplicated: ambiguous, reject
  return hits[0].slice(prefix.length).trim()
}

export function validateSiwe(message: string, rules: SiweRules): SiweResult {
  const now = rules.now ?? Date.now()
  const maxLifetime = rules.maxLifetimeMs ?? 24 * 3600_000
  const maxAge = rules.maxAgeMs ?? 10 * 60_000
  if (message.length > 2000) return { ok: false, reason: 'message too long' }
  const lines = message.split('\n')
  if (!lines[0]?.endsWith(HEADER)) return { ok: false, reason: 'not a sign-in message' }
  const domain = lines[0].slice(0, -HEADER.length).trim()
  if (!domain || !rules.allowedDomains.includes(domain)) return { ok: false, reason: 'domain not allowed' }
  if (lines[1]?.trim().toLowerCase() !== rules.expectedAddress.toLowerCase()) return { ok: false, reason: 'address mismatch' }
  if (field(lines, 'Version') !== '1') return { ok: false, reason: 'unsupported version' }
  const chain = Number(field(lines, 'Chain ID'))
  if (!Number.isInteger(chain) || !rules.allowedChainIds.includes(chain)) return { ok: false, reason: 'chain not allowed' }
  const msgNonce = field(lines, 'Nonce')
  if (!msgNonce || msgNonce !== rules.nonce) return { ok: false, reason: 'nonce does not match the issued nonce' }
  const issued = Date.parse(field(lines, 'Issued At') ?? '')
  const expires = Date.parse(field(lines, 'Expiration Time') ?? '')
  if (Number.isNaN(issued) || Number.isNaN(expires)) return { ok: false, reason: 'issued-at and expiration time are required' }
  if (issued > now + 2 * 60_000) return { ok: false, reason: 'issued in the future' }
  if (now - issued > maxAge) return { ok: false, reason: 'message too old' }
  if (expires <= now) return { ok: false, reason: 'message expired' }
  if (expires - issued > maxLifetime) return { ok: false, reason: 'validity window too long' }
  return { ok: true }
}
