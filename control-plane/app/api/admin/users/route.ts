import { NextRequest, NextResponse } from 'next/server'
import { getSession, hashPassword, generateTempPassword } from '@/lib/auth'
import { listUsers, createUser, findUserByUsername, normalizeQuota } from '@/lib/users'

async function isAdmin() {
  const s = await getSession()
  return !!s && s.role === 'admin'
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return NextResponse.json({ users: await listUsers() })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.username ?? '').trim()
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(name)) {
    return NextResponse.json(
      { error: 'username must be 3-32 chars: letters, digits, . _ -' },
      { status: 400 }
    )
  }
  if (await findUserByUsername(name)) {
    return NextResponse.json({ error: 'username already exists' }, { status: 409 })
  }

  const quota = body.sessionQuota === undefined ? 1 : normalizeQuota(body.sessionQuota)
  if (quota === undefined) {
    return NextResponse.json({ error: 'quota must be a positive integer or unlimited' }, { status: 400 })
  }

  const tempPassword = generateTempPassword()
  const id = await createUser(name, await hashPassword(tempPassword), quota)
  // tempPassword is returned once for the admin to relay; never stored in clear.
  return NextResponse.json({ id, username: name, tempPassword })
}
