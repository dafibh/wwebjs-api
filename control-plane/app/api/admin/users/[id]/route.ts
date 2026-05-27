import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { updateUserQuota, deleteUser, normalizeQuota } from '@/lib/users'

async function isAdmin() {
  const s = await getSession()
  return !!s && s.role === 'admin'
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!('sessionQuota' in body)) {
    return NextResponse.json({ error: 'sessionQuota required' }, { status: 400 })
  }
  const quota = normalizeQuota(body.sessionQuota)
  if (quota === undefined) {
    return NextResponse.json({ error: 'quota must be a positive integer or unlimited' }, { status: 400 })
  }
  await updateUserQuota(id, quota)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  await deleteUser(id)
  return NextResponse.json({ ok: true })
}
