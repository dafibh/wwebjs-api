import { randomBytes } from 'node:crypto'
import { query } from '@/db/pool'

export type SessionRow = {
  session_id: string
  owner_id: string
  wa_number: string | null
  label: string | null
  status: string | null
  created_at: string
  last_seen: string | null
}

export async function getSessionOwner(sessionId: string): Promise<string | null> {
  const r = await query<{ owner_id: string }>(
    'select owner_id from sessions where session_id = $1',
    [sessionId]
  )
  return r.rows[0]?.owner_id ?? null
}

export async function listSessionsByOwner(ownerId: string): Promise<SessionRow[]> {
  const r = await query<SessionRow>(
    'select * from sessions where owner_id = $1 order by created_at desc',
    [ownerId]
  )
  return r.rows.map((s) => ({
    ...s,
    created_at: s.created_at ? new Date(s.created_at).toISOString() : s.created_at,
    last_seen: s.last_seen ? new Date(s.last_seen).toISOString() : null
  }))
}

export async function countSessionsByOwner(ownerId: string): Promise<number> {
  const r = await query<{ n: string }>(
    'select count(*)::int as n from sessions where owner_id = $1',
    [ownerId]
  )
  return Number(r.rows[0]?.n ?? 0)
}

// Generate a namespaced session id so ids never collide across users
// and the owner is recoverable from the prefix.
export function newSessionId(ownerId: string): string {
  const short = ownerId.replace(/-/g, '').slice(0, 8)
  return `${short}-${randomBytes(4).toString('hex')}`
}

export async function createSessionRecord(sessionId: string, ownerId: string, label: string | null) {
  await query(
    `insert into sessions (session_id, owner_id, label, status)
     values ($1, $2, $3, 'starting')`,
    [sessionId, ownerId, label]
  )
}

export async function deleteSessionRecord(sessionId: string, ownerId: string): Promise<boolean> {
  const r = await query(
    'delete from sessions where session_id = $1 and owner_id = $2',
    [sessionId, ownerId]
  )
  return (r.rowCount ?? 0) > 0
}
