import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUserQuota } from '@/lib/users'
import {
  listSessionsByOwner,
  countSessionsByOwner,
  newSessionId,
  createSessionRecord,
  deleteSessionRecord
} from '@/lib/sessions'
import { wwebjsFetch } from '@/lib/wwebjs'

async function userSession() {
  const s = await getSession()
  return s && s.role === 'user' ? s : null
}

export async function GET() {
  const s = await userSession()
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return NextResponse.json({ sessions: await listSessionsByOwner(s.sub) })
}

export async function POST(req: NextRequest) {
  const s = await userSession()
  if (!s) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const quota = await getUserQuota(s.sub)
  if (quota === undefined) return NextResponse.json({ error: 'account not found' }, { status: 403 })
  if (quota !== null && (await countSessionsByOwner(s.sub)) >= quota) {
    return NextResponse.json({ error: `session quota reached (${quota})` }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const label = String(body.label ?? '').trim().slice(0, 64) || null
  const sessionId = newSessionId(s.sub)
  await createSessionRecord(sessionId, s.sub, label)

  // Start the WhatsApp client upstream; the QR is then polled via the proxy.
  const start = await wwebjsFetch(`/session/start/${sessionId}`).catch(() => null)
  if (!start || !start.ok) {
    await deleteSessionRecord(sessionId, s.sub)
    return NextResponse.json({ error: 'failed to start session upstream' }, { status: 502 })
  }
  return NextResponse.json({ sessionId, label })
}
