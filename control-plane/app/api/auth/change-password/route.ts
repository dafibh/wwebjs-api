import { NextRequest, NextResponse } from 'next/server'
import { getSession, hashPassword, signSession, setSessionCookie } from '@/lib/auth'
import { updatePassword } from '@/lib/users'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (session.role === 'admin') {
    return NextResponse.json({ error: 'admin password is managed via env' }, { status: 400 })
  }

  const { newPassword } = await req.json().catch(() => ({}))
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
  }

  await updatePassword(session.sub, await hashPassword(newPassword))
  // Re-issue token without the mustChange flag.
  await setSessionCookie(await signSession({ ...session, mustChange: false }))
  return NextResponse.json({ ok: true })
}
