import { createHash, randomBytes } from 'node:crypto'
import { query } from '@/db/pool'

const TOKEN_PREFIX = 'wa_live_'

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex')
}

export type ApiKeyRow = {
  id: string
  prefix: string
  label: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export async function listApiKeys(ownerId: string): Promise<ApiKeyRow[]> {
  const r = await query<ApiKeyRow>(
    `select id, prefix, label, created_at, last_used_at, revoked_at
       from api_keys where owner_id = $1 order by created_at desc`,
    [ownerId]
  )
  return r.rows.map((k) => ({
    ...k,
    created_at: k.created_at ? new Date(k.created_at).toISOString() : k.created_at,
    last_used_at: k.last_used_at ? new Date(k.last_used_at).toISOString() : null,
    revoked_at: k.revoked_at ? new Date(k.revoked_at).toISOString() : null
  }))
}

// Returns the full token exactly once; only its hash is stored.
export async function createApiKey(ownerId: string, label: string | null) {
  const token = TOKEN_PREFIX + randomBytes(24).toString('base64url')
  const prefix = token.slice(0, 16)
  const r = await query<{ id: string }>(
    `insert into api_keys (owner_id, key_hash, prefix, label)
     values ($1, $2, $3, $4) returning id`,
    [ownerId, sha256(token), prefix, label]
  )
  return { id: r.rows[0].id, token, prefix }
}

export async function revokeApiKey(ownerId: string, id: string): Promise<boolean> {
  const r = await query(
    `update api_keys set revoked_at = now()
      where id = $1 and owner_id = $2 and revoked_at is null`,
    [id, ownerId]
  )
  return (r.rowCount ?? 0) > 0
}

// Validate an incoming x-api-key. Returns the owner id (and touches
// last_used_at) or null. Used by the proxy.
export async function resolveApiKey(token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const r = await query<{ id: string; owner_id: string }>(
    'select id, owner_id from api_keys where key_hash = $1 and revoked_at is null',
    [sha256(token)]
  )
  const row = r.rows[0]
  if (!row) return null
  await query('update api_keys set last_used_at = now() where id = $1', [row.id])
  return row.owner_id
}
