import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSessionOwner, deleteSessionRecord } from '@/lib/sessions'
import { wwebjsFetch } from '@/lib/wwebjs'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession()
  if (!s || s.role !== 'user') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  if ((await getSessionOwner(id)) !== s.sub) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  // Terminate upstream (best effort), then drop our record.
  await wwebjsFetch(`/session/terminate/${id}`).catch(() => {})
  await deleteSessionRecord(id, s.sub)
  return NextResponse.json({ ok: true })
}
