import { NextRequest, NextResponse } from 'next/server'
import { getSession, hashPassword, generateTempPassword } from '@/lib/auth'
import { resetUserPassword } from '@/lib/users'

async function isAdmin() {
  const s = await getSession()
  return !!s && s.role === 'admin'
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const tempPassword = generateTempPassword()
  await resetUserPassword(id, await hashPassword(tempPassword))
  return NextResponse.json({ tempPassword })
}
