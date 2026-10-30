/**
 * Askirawa Finance backend server.
 * Provides SIWE authentication and organization management via a SQLite database.
 *
 * Start: bun run server/index.ts
 * Env: SESSION_SECRET (required), DATABASE_URL (optional, defaults to ./askira.db)
 *
 * All routes are protected: only authenticated sessions may access /api/org and /api/profile.
 * SIWE message verification is done server-side; the frontend never controls role values.
 */

import { randomBytes } from 'crypto'

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
void SESSION_SECRET // used as a startup gate; cookie signing is handled by session IDs in SQLite

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

function sessionCookie(sid: string, maxAge = 86400): string {
  return `askira_session=${encodeURIComponent(sid)}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/`
}

function authenticated(req: Request): string | null {
  const cookies = parseCookies(req.headers.get('cookie'))
  const sid = cookies['askira_session']
  if (!sid) return null
  return getSession(sid)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function cors(res: Response, origin: string): Response {
  res.headers.set('Access-Control-Allow-Origin', origin)
  res.headers.set('Access-Control-Allow-Credentials', 'true')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  return res
}

// ─── SIWE message verification (manual, no external lib needed) ───────────────
function verifySiweMessage(message: string, signature: string, expectedAddress: string): boolean {
  try {
    // Dynamic import of viem's verifyMessage
    // We do synchronous validation of the message fields before the async signature check
    const lines = message.split('\n')
    const nonceLineIdx = lines.findIndex(l => l.startsWith('Nonce: '))
    const expiryLineIdx = lines.findIndex(l => l.startsWith('Expiration Time: '))
    if (nonceLineIdx < 0) return false
    if (expiryLineIdx >= 0) {
      const expiry = new Date(lines[expiryLineIdx].replace('Expiration Time: ', ''))
      if (expiry < new Date()) return false
    }
    // We extract the address from line 2 (SIWE standard)
    const addrLine = lines[1]?.trim()
    if (!addrLine || addrLine.toLowerCase() !== expectedAddress.toLowerCase()) return false

    // Signature check using viem's verifyMessage — we import synchronously here
    // In production, use ethers.utils.verifyMessage or viem's verifyMessage
    // For now, we perform a basic check: the address in the message matches the claimed address.
    // Full ecrecover verification happens below if viem is importable.
    void signature // used below
    return true // fallback: trust address-match; full ecrecover done in route handler
  } catch {
    return false
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const origin = req.headers.get('origin') ?? 'http://localhost:5173'

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
      const body = await req.json() as { address: string; message: string; signature: string; nonce: string }
      const { address, message, signature, nonce } = body
      if (!address || !message || !signature || !nonce) {
        return respond(json({ error: 'Missing fields' }, 400))
      }

      // Consume the nonce (prevents replay)
      if (!consumeNonce(address, nonce)) {
        return respond(json({ error: 'Invalid or expired nonce' }, 401))
      }

      // Validate SIWE message structure
      if (!verifySiweMessage(message, signature, address)) {
        return respond(json({ error: 'SIWE message invalid' }, 401))
      }

      // Verify the EIP-191 signature with viem
      try {
        const { verifyMessage } = await import('viem')
        const valid = await verifyMessage({
          address: address as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        })
        if (!valid) {
          return respond(json({ error: 'Signature verification failed' }, 401))
        }
      } catch {
        // viem not available or other error — fall back to address-match only
        // This should not happen in production; log and reject to be safe
        return respond(json({ error: 'Signature verification unavailable' }, 500))
      }

      const sid = randomBytes(32).toString('hex')
      createSession(sid, address)
      logAction(null, address, 'login')

      const res = json({ ok: true, address })
      res.headers.set('Set-Cookie', sessionCookie(sid))
      return respond(res)
    }

    // ─ Auth: sign out ──────────────────────────────────────────────────────
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const address = authenticated(req)
      if (address) {
        const cookies = parseCookies(req.headers.get('cookie'))
        deleteSession(cookies['askira_session'])
        logAction(null, address, 'logout')
      }
      const res = json({ ok: true })
      res.headers.set('Set-Cookie', sessionCookie('', 0))
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
      const body = await req.json() as { name: string }
      if (!body.name?.trim()) return respond(json({ error: 'Name required' }, 400))
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

      const body = await req.json() as { walletAddress: string; role: string }
      if (!body.walletAddress || !/^0x[0-9a-fA-F]{40}$/i.test(body.walletAddress)) {
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
      const body = await req.json() as { displayName: string }
      if (!body.displayName?.trim()) return respond(json({ error: 'Display name required' }, 400))
      updateDisplayName(org.id, address!, body.displayName.trim())
      return respond(json({ ok: true }))
    }

    return respond(json({ error: 'Not found' }, 404))
  },
})

console.log(`[server] Askirawa Finance backend running on http://localhost:${server.port}`)
