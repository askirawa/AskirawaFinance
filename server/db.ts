/**
 * SQLite database layer for Askirawa Finance org management.
 * Uses bun:sqlite — available in all Bun runtimes without extra packages.
 */
import { Database } from 'bun:sqlite'
import path from 'path'

const DB_PATH = process.env.DATABASE_URL ?? path.join(process.cwd(), 'askira.db')

const db = new Database(DB_PATH, { create: true })

// Enable WAL for durability across pause/resume
db.exec('PRAGMA journal_mode=WAL;')
db.exec('PRAGMA foreign_keys=ON;')

db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    ownerAddress TEXT NOT NULL COLLATE NOCASE,
    createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS members (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    orgId         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    walletAddress TEXT NOT NULL COLLATE NOCASE,
    role          TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
    displayName   TEXT,
    joinedAt      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(orgId, walletAddress)
  );

  CREATE TABLE IF NOT EXISTS nonces (
    address   TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
    nonce     TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid       TEXT NOT NULL PRIMARY KEY,
    address   TEXT NOT NULL COLLATE NOCASE,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    orgId     INTEGER REFERENCES organizations(id),
    actorAddr TEXT NOT NULL,
    action    TEXT NOT NULL,
    detail    TEXT,
    ts        TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

export type Role = 'owner' | 'admin' | 'member'

export interface Organization {
  id: number
  name: string
  ownerAddress: string
  createdAt: string
}

export interface Member {
  id: number
  orgId: number
  walletAddress: string
  role: Role
  displayName: string | null
  joinedAt: string
}

// ─── Nonces ──────────────────────────────────────────────────────────────────

export function upsertNonce(address: string, nonce: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 300 // 5 min
  db.query('INSERT OR REPLACE INTO nonces(address, nonce, expiresAt) VALUES(?, ?, ?)')
    .run(address.toLowerCase(), nonce, expiresAt)
}

export function consumeNonce(address: string, nonce: string): boolean {
  const row = db.query<{ nonce: string; expiresAt: number }, [string]>(
    'SELECT nonce, expiresAt FROM nonces WHERE address = ?'
  ).get(address.toLowerCase())
  if (!row || row.nonce !== nonce || row.expiresAt < Math.floor(Date.now() / 1000)) return false
  db.query('DELETE FROM nonces WHERE address = ?').run(address.toLowerCase())
  return true
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function createSession(sid: string, address: string) {
  const now = Math.floor(Date.now() / 1000)
  db.query('INSERT INTO sessions(sid, address, createdAt, expiresAt) VALUES(?, ?, ?, ?)')
    .run(sid, address.toLowerCase(), now, now + 86400) // 24h
}

export function getSession(sid: string): string | null {
  const row = db.query<{ address: string; expiresAt: number }, [string]>(
    'SELECT address, expiresAt FROM sessions WHERE sid = ?'
  ).get(sid)
  if (!row || row.expiresAt < Math.floor(Date.now() / 1000)) return null
  return row.address
}

export function deleteSession(sid: string) {
  db.query('DELETE FROM sessions WHERE sid = ?').run(sid)
}

// ─── Organizations ────────────────────────────────────────────────────────────

export function createOrg(name: string, ownerAddress: string): Organization {
  const result = db.query<Organization, [string, string]>(
    'INSERT INTO organizations(name, ownerAddress) VALUES(?, ?) RETURNING *'
  ).get(name, ownerAddress.toLowerCase())
  if (!result) throw new Error('Failed to create org')
  // Add owner as member
  db.query('INSERT INTO members(orgId, walletAddress, role) VALUES(?, ?, ?)').run(result.id, ownerAddress.toLowerCase(), 'owner')
  return result
}

export function getOrgByMember(address: string): Organization | null {
  return db.query<Organization, [string]>(
    'SELECT o.* FROM organizations o JOIN members m ON m.orgId = o.id WHERE m.walletAddress = ? LIMIT 1'
  ).get(address.toLowerCase())
}

export function getMembers(orgId: number): Member[] {
  return db.query<Member, [number]>(
    'SELECT * FROM members WHERE orgId = ? ORDER BY role DESC, joinedAt ASC'
  ).all(orgId)
}

export function getMemberRole(orgId: number, address: string): Role | null {
  const row = db.query<{ role: Role }, [number, string]>(
    'SELECT role FROM members WHERE orgId = ? AND walletAddress = ?'
  ).get(orgId, address.toLowerCase())
  return row?.role ?? null
}

export function addMember(orgId: number, walletAddress: string, role: Role) {
  db.query('INSERT OR IGNORE INTO members(orgId, walletAddress, role) VALUES(?, ?, ?)').run(orgId, walletAddress.toLowerCase(), role)
}

export function updateDisplayName(orgId: number, address: string, displayName: string) {
  db.query('UPDATE members SET displayName = ? WHERE orgId = ? AND walletAddress = ?').run(displayName, orgId, address.toLowerCase())
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export function logAction(orgId: number | null, actorAddr: string, action: string, detail?: string) {
  db.query('INSERT INTO audit_log(orgId, actorAddr, action, detail) VALUES(?, ?, ?, ?)').run(orgId, actorAddr.toLowerCase(), action, detail ?? null)
}

export default db
