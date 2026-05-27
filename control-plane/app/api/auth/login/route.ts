import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { verifyPassword, signSession, setSessionCookie } from '@/lib/auth'
import { findUserByUsername, setLastLogin } from '@/lib/users'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}))
  if (!username || !password) {
    return NextResponse.json({ error: 'missing credentials' }, { status: 400 })
  }

  // Admin: credentials live in env, no DB row.
  if (username === config.adminUser) {
    if (!(await verifyPassword(password, config.adminPasswordHash))) {
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 })
    }
    await setSessionCookie(
      await signSession({ sub: 'admin', username, role: 'admin', mustChange: false })
    )
    return NextResponse.json({ role: 'admin', mustChange: false })
  }

  // DB user.
  const user = await findUserByUsername(username)
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 })
  }
  await setLastLogin(user.id)
  await setSessionCookie(
    await signSession({
      sub: user.id,
      username: user.username,
      role: 'user',
      mustChange: user.must_change_password
    })
  )
  return NextResponse.json({ role: 'user', mustChange: user.must_change_password })
}
