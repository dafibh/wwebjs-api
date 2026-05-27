import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { listApiKeys, createApiKey } from '@/lib/apikey'

// API keys belong to user accounts (the env admin has no DB row / sessions).
async function userSession() {
  const s = await getSession()
  return s && s.role === 'user' ? s : null
}

export async function GET() {
  const s = await userSession()
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return NextResponse.json({ keys: await listApiKeys(s.sub) })
}

export async function POST(req: NextRequest) {
  const s = await userSession()
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const label = String(body.label ?? '').trim().slice(0, 64) || null
  const created = await createApiKey(s.sub, label)
  return NextResponse.json(created)
}
