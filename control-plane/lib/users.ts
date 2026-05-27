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
