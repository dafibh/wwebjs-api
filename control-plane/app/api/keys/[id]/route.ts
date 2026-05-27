import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { revokeApiKey } from '@/lib/apikey'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession()
  if (!s || s.role !== 'user') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const ok = await revokeApiKey(s.sub, id)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
