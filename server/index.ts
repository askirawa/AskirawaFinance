/**
 * Askirawa Finance backend server.
 * Provides SIWE authentication and organization management via a SQLite database.
 *
 * Start: bun run server/index.ts
 * Env: SESSION_SECRET (required), DATABASE_URL (optional, defaults to ./askira.db)
 *
 * Only authenticated sessions may access /api/org and /api/profile.
 *
 * IMPORTANT, what this server is and is not:
 *  - It stores organization labels (names, owner/admin/member) off-chain. Those roles do NOT grant any
 *    treasury permission: approvals and payments are enforced only by the treasury contract.
 *  - The treasury web app does not call this server. Nothing here is proof of identity beyond "this
 *    session signed a fresh sign-in message with this wallet".
 *
 * Env: SESSION_SECRET (required in production; signs the session cookie), ALLOWED_ORIGINS (comma list,
 *      required for cross-origin browser use), SIWE_ALLOWED_DOMAINS (comma list of hosts, for example
 *      "app.example.com"), SIWE_CHAIN_IDS (default 5042,5042002), PORT, DATABASE_URL.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { validateSiwe } from './siwe'

const PORT = Number(process.env.PORT ?? 3001)

// SESSION_SECRET must be set in production. In development, a random value is generated
// and printed to stderr so the developer is aware — sessions will not survive restarts.
let SESSION_SECRET = process.env.SESSION_SECRET
if (!SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[server] FATAL: SESSION_SECRET environment variable is not set.')
    console.error('[server] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
    process.exit(1)
  } else {
    SESSION_SECRET = randomBytes(32).toString('hex')
    console.warn('[server] WARNING: SESSION_SECRET not set — using a random ephemeral secret.')
    console.warn('[server] Sessions will be invalidated on every server restart.')
    console.warn('[server] Set SESSION_SECRET in .env for persistent sessions.')
  }
}
const PRODUCTION = process.env.NODE_ENV === 'production'
const csv = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const ALLOWED_ORIGINS = csv(process.env.ALLOWED_ORIGINS)
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
const SIWE_DOMAINS = csv(process.env.SIWE_ALLOWED_DOMAINS)
if (PRODUCTION && SIWE_DOMAINS.length === 0) {
  console.error('[server] FATAL: SIWE_ALLOWED_DOMAINS must be set in production (for example app.example.com).')
  process.exit(1)
}
const SIWE_CHAIN_IDS = (csv(process.env.SIWE_CHAIN_IDS).length ? csv(process.env.SIWE_CHAIN_IDS) : ['5042', '5042002']).map(Number)

/** The session cookie carries "<sid>.<hmac>". A forged or edited cookie fails before the database is touched. */
const mac = (sid: string) => createHmac('sha256', SESSION_SECRET as string).update(sid).digest('hex')
function signSid(sid: string): string { return `${sid}.${mac(sid)}` }
function unsignSid(value: string): string | null {
  const i = value.lastIndexOf('.')
  if (i < 1) return null
  const sid = value.slice(0, i)
  const given = Buffer.from(value.slice(i + 1), 'utf8')
  const want = Buffer.from(mac(sid), 'utf8')
  return given.length === want.length && timingSafeEqual(given, want) ? sid : null
}

/** Small in-memory limiter (per process). Enough to blunt guessing and spam; use a gateway for real traffic. */
const hits = new Map<string, number[]>()
function limited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k)
  return recent.length > max
}

// Dynamic import so the module is not loaded when building the frontend
const {
  upsertNonce, consumeNonce, createSession, getSession, deleteSession,
  createOrg, getOrgByMember, getMembers, getMemberRole, addMember, updateDisplayName, logAction,
} = await import('./db.js')

// Simple cookie session helper
function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {}
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      return [k.trim(), decodeURIComponent(v.join('='))]
    })
  )
}

function sessionCookie(sid: string, maxAge = 86400, secure = PRODUCTION): string {
  const value = sid ? signSid(sid) : ''
  return `askira_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/${secure ? '; Secure' : ''}`
}

function authenticated(req: Request): string | null {
  const cookies = parseCookies(req.headers.get('cookie'))
  const raw = cookies['askira_session']
  const sid = raw ? unsignSid(raw) : null
  if (!sid) return null
  return getSession(sid)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function originAllowed(origin: string | null): origin is string {
  if (!origin) return false
  return (ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : PRODUCTION ? [] : DEV_ORIGINS).includes(origin)
}

/** Only an exactly allow-listed origin gets credentialed CORS headers. Everyone else gets none. */
function cors(res: Response, origin: string | null): Response {
  res.headers.set('Vary', 'Origin')
  if (!originAllowed(origin)) return res
  res.headers.set('Access-Control-Allow-Origin', origin)
  res.headers.set('Access-Control-Allow-Credentials', 'true')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  return res
}

async function readJson<T>(req: Request): Promise<T | null> {
  if (Number(req.headers.get('content-length') ?? 0) > 8192) return null
  try { return (await req.json()) as T } catch { return null }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const origin = req.headers.get('origin')
    const ip = server.requestIP(req)?.address ?? 'unknown'
    const secureCookie = PRODUCTION || req.headers.get('x-forwarded-proto') === 'https'

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }), origin)
    }

    const respond = (res: Response) => cors(res, origin)

    // ─ Health ──────────────────────────────────────────────────────────────
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return respond(json({ ok: true, timestamp: Date.now() }))
    }

    // ─ Auth: get nonce ─────────────────────────────────────────────────────
    if (url.pathname === '/api/auth/nonce' && req.method === 'GET') {
      if (limited(`nonce:${ip}`, 20)) return respond(json({ error: 'Too many requests' }, 429))
      const address = url.searchParams.get('address')
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return respond(json({ error: 'Invalid address' }, 400))
      }
      const nonce = randomBytes(16).toString('hex')
      upsertNonce(address, nonce)
      return respond(json({ nonce }))
    }

    // ─ Auth: verify SIWE ───────────────────────────────────────────────────
    if (url.pathname === '/api/auth/verify' && req.method === 'POST') {
      if (limited(`verify:${ip}`, 10)) return respond(json({ error: 'Too many requests' }, 429))
      const body = await readJson<{ address: string; message: string; signature: string; nonce: string }>(req)
      if (!body) return respond(json({ error: 'Invalid request body' }, 400))
      const { address, message, signature, nonce } = body
      if (typeof address !== 'string' || typeof message !== 'string' || typeof signature !== 'string' || typeof nonce !== 'string' || !address || !message || !signature || !nonce) {
        return respond(json({ error: 'Missing fields' }, 400))
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !/^0x[0-9a-fA-F]+$/.test(signature)) {
        return respond(json({ error: 'Invalid address or signature' }, 400))
      }

      // 1. The signed text must name the issued nonce, an allowed domain/chain and a short window.
      const allowedDomains = SIWE_DOMAINS.length ? SIWE_DOMAINS : (originAllowed(origin) ? [new URL(origin).host] : [])
      const checked = validateSiwe(message, { expectedAddress: address, nonce, allowedDomains, allowedChainIds: SIWE_CHAIN_IDS })
      if (!checked.ok) return respond(json({ error: `Sign-in message rejected: ${checked.reason}` }, 401))

      // 2. The nonce is single use and bound to this address.
      if (!consumeNonce(address, nonce)) {
        return respond(json({ error: 'Invalid or expired nonce' }, 401))
      }

      // 3. The wallet must really have signed exactly that text.
      try {
        const { verifyMessage } = await import('viem')
        const valid = await verifyMessage({
          address: address as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        })
        if (!valid) return respond(json({ error: 'Signature verification failed' }, 401))
      } catch {
        return respond(json({ error: 'Signature verification failed' }, 401))
      }

      const sid = randomBytes(32).toString('hex')
      createSession(sid, address)
      logAction(null, address, 'login')

      const res = json({ ok: true, address })
      res.headers.set('Set-Cookie', sessionCookie(sid, 86400, secureCookie))
      return respond(res)
    }

    // ─ Auth: sign out ──────────────────────────────────────────────────────
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const address = authenticated(req)
      if (address) {
        const raw = parseCookies(req.headers.get('cookie'))['askira_session']
        const sid = raw ? unsignSid(raw) : null
        if (sid) deleteSession(sid)
        logAction(null, address, 'logout')
      }
      const res = json({ ok: true })
      res.headers.set('Set-Cookie', sessionCookie('', 0, secureCookie))
      return respond(res)
    }

    // ─ Protected routes — require session ─────────────────────────────────
    const address = authenticated(req)

    if (url.pathname.startsWith('/api/org') || url.pathname.startsWith('/api/profile')) {
      if (!address) return respond(json({ error: 'Unauthorized' }, 401))
    }

    // ─ GET /api/org ───────────────────────────────────────────────────────
    if (url.pathname === '/api/org' && req.method === 'GET') {
      const org = getOrgByMember(address!)
      if (!org) return respond(json({ error: 'Not in any organization' }, 404))
      const members = getMembers(org.id)
      const myRole = getMemberRole(org.id, address!)
      return respond(json({ org, members, myRole }))
    }

    // ─ POST /api/org ──────────────────────────────────────────────────────
    if (url.pathname === '/api/org' && req.method === 'POST') {
      const existing = getOrgByMember(address!)
      if (existing) return respond(json({ error: 'Already in an organization' }, 409))
      const body = await readJson<{ name: string }>(req)
      if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) return respond(json({ error: 'Name required' }, 400))
      const org = createOrg(body.name.trim(), address!)
      logAction(org.id, address!, 'create_org', org.name)
      return respond(json({ org }))
    }

    // ─ POST /api/org/members ──────────────────────────────────────────────
    if (url.pathname === '/api/org/members' && req.method === 'POST') {
      const org = getOrgByMember(address!)
      if (!org) return respond(json({ error: 'Not in any organization' }, 404))
      const role = getMemberRole(org.id, address!)
      if (role !== 'owner' && role !== 'admin') return respond(json({ error: 'Insufficient permissions' }, 403))

      const body = await readJson<{ walletAddress: string; role: string }>(req)
      if (!body || typeof body.walletAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/i.test(body.walletAddress)) {
        return respond(json({ error: 'Invalid address' }, 400))
      }
      const newRole = (body.role === 'admin' ? 'admin' : 'member') as 'admin' | 'member'
      // Only owner can add admins
      if (newRole === 'admin' && role !== 'owner') return respond(json({ error: 'Only owner can add admins' }, 403))
      addMember(org.id, body.walletAddress, newRole)
      logAction(org.id, address!, 'invite_member', `${body.walletAddress} as ${newRole}`)
      return respond(json({ ok: true }))
    }

    // ─ PATCH /api/profile ─────────────────────────────────────────────────
    if (url.pathname === '/api/profile' && req.method === 'PATCH') {
      const org = getOrgByMember(address!)
      if (!org) return respond(json({ error: 'Not in any organization' }, 404))
      const body = await readJson<{ displayName: string }>(req)
      if (!body || typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.length > 100) return respond(json({ error: 'Display name required' }, 400))
      updateDisplayName(org.id, address!, body.displayName.trim())
      return respond(json({ ok: true }))
    }

    return respond(json({ error: 'Not found' }, 404))
  },
})

console.log(`[server] Askirawa Finance backend running on http://localhost:${server.port}`)
