import { NextRequest, NextResponse } from 'next/server'
import { resolveCaller } from '@/lib/caller'
import { getSessionOwner } from '@/lib/sessions'
import { wwebjsFetch } from '@/lib/wwebjs'

// wwebjs-api paths are /{group}/{action}/{sessionId}[/...], so the session id
// is always at segment index 2 when present.
const SESSION_ID_INDEX = 2

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const caller = await resolveCaller(req)
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { path } = await ctx.params
  const segments = path ?? []
  if (segments.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (segments.length > SESSION_ID_INDEX) {
    // Session-scoped endpoint: caller must own the session (admin bypasses).
    if (caller.role !== 'admin') {
      const owner = await getSessionOwner(segments[SESSION_ID_INDEX])
      if (!owner || owner !== caller.ownerId) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
    }
  } else {
    // Global endpoints (no session id in the path).
    const p = segments.join('/')
    const adminOnly = p === 'session/terminateAll' || p === 'session/terminateInactive'
    const globalList = p === 'session/getSessions' || p === 'webhook/sessions'
    if (caller.role !== 'admin' && adminOnly) {
      return NextResponse.json({ error: 'forbidden (admin only)' }, { status: 403 })
    }
    if (caller.role !== 'admin' && globalList) {
      return NextResponse.json(
        { error: 'use /api/sessions to list your own sessions' },
        { status: 403 }
      )
    }
    // /ping and /webhook/events are fine for any authenticated caller.
  }

  // Forward to upstream with the global key injected.
  const init: RequestInit = { method: req.method, headers: {} }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = req.headers.get('content-type')
    if (ct) (init.headers as Record<string, string>)['content-type'] = ct
    init.body = await req.arrayBuffer()
  }

  const upstream = await wwebjsFetch('/' + segments.join('/') + req.nextUrl.search, init)
  const headers = new Headers()
  const ct = upstream.headers.get('content-type')
  if (ct) headers.set('content-type', ct)
  return new NextResponse(await upstream.arrayBuffer(), { status: upstream.status, headers })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const DELETE = handle
export const PATCH = handle
