import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { SESSION_COOKIE } from '@/lib/constants'

const PUBLIC_PATHS = new Set(['/login'])

function secret() {
  return new TextEncoder().encode(process.env.JWT_SECRET)
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Auth endpoints and the wwebjs proxy authenticate themselves (the proxy
  // also accepts x-api-key, which has no cookie). Everything else is gated here.
  if (
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/wa/') ||
    PUBLIC_PATHS.has(pathname)
  ) {
    return NextResponse.next()
  }

  const isApi = pathname.startsWith('/api/')
  const token = req.cookies.get(SESSION_COOKIE)?.value

  let payload: Record<string, unknown> | null = null
  if (token) {
    try {
      payload = (await jwtVerify(token, secret())).payload
    } catch {
      payload = null
    }
  }

  if (!payload) {
    if (isApi) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Force first-login password change for DB users.
  if (payload.mustChange && pathname !== '/change-password' && !isApi) {
    const url = req.nextUrl.clone()
    url.pathname = '/change-password'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
