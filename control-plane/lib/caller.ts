import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveApiKey } from '@/lib/apikey'

export type Caller = { ownerId: string | null; role: 'admin' | 'user' }

// Resolve who is calling: an x-api-key (programmatic) takes precedence,
// otherwise the login session cookie. Admin has ownerId=null (no scoping).
export async function resolveCaller(req: NextRequest): Promise<Caller | null> {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey) {
    const ownerId = await resolveApiKey(apiKey)
    return ownerId ? { ownerId, role: 'user' } : null
  }
  const s = await getSession()
  if (!s) return null
  return s.role === 'admin' ? { ownerId: null, role: 'admin' } : { ownerId: s.sub, role: 'user' }
}
