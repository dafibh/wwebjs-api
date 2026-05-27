import { query } from '@/db/pool'

export type UserRow = {
  id: string
  username: string
  password_hash: string
  must_change_password: boolean
  session_quota: number | null
  created_at: string
  last_login: string | null
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const r = await query<UserRow>(
    'select * from users where username = $1',
    [username]
  )
  return r.rows[0] ?? null
}

export async function setLastLogin(id: string) {
  await query('update users set last_login = now() where id = $1', [id])
}

export async function updatePassword(id: string, hash: string) {
  await query(
    'update users set password_hash = $1, must_change_password = false where id = $2',
    [hash, id]
  )
}

// ---- admin operations ----

export type UserListItem = {
  id: string
  username: string
  must_change_password: boolean
  session_quota: number | null
  created_at: string
  last_login: string | null
}

export async function listUsers(): Promise<UserListItem[]> {
  const r = await query<UserListItem>(
    `select id, username, must_change_password, session_quota,
            created_at, last_login
       from users
      order by created_at desc`
  )
  // Coerce timestamps to ISO strings so they serialize cleanly to the client.
  return r.rows.map((u) => ({
    ...u,
    created_at: u.created_at ? new Date(u.created_at).toISOString() : u.created_at,
    last_login: u.last_login ? new Date(u.last_login).toISOString() : null
  }))
}

export async function createUser(
  username: string,
  passwordHash: string,
  sessionQuota: number | null
): Promise<string> {
  const r = await query<{ id: string }>(
    `insert into users (username, password_hash, session_quota, must_change_password)
     values ($1, $2, $3, true) returning id`,
    [username, passwordHash, sessionQuota]
  )
  return r.rows[0].id
}

export async function resetUserPassword(id: string, passwordHash: string) {
  await query(
    'update users set password_hash = $1, must_change_password = true where id = $2',
    [passwordHash, id]
  )
}

export async function updateUserQuota(id: string, quota: number | null) {
  await query('update users set session_quota = $1 where id = $2', [quota, id])
}

export async function deleteUser(id: string) {
  await query('delete from users where id = $1', [id])
}

// Returns the quota (number | null=unlimited), or undefined if the user is gone.
export async function getUserQuota(id: string): Promise<number | null | undefined> {
  const r = await query<{ session_quota: number | null }>(
    'select session_quota from users where id = $1',
    [id]
  )
  return r.rows[0]?.session_quota
}

// Parse a quota value from request input.
// number >= 1 -> that cap; null/'unlimited'/'' -> unlimited; anything else -> undefined (invalid).
export function normalizeQuota(q: unknown): number | null | undefined {
  if (q === null || q === 'unlimited' || q === '') return null
  const n = Number(q)
  if (!Number.isInteger(n) || n < 1) return undefined
  return n
}
