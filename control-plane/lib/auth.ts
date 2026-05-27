import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { config } from '@/lib/config'

export const SESSION_COOKIE = 'cp_session'
const ALG = 'HS256'
const MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export type Role = 'admin' | 'user'
export type Session = {
  sub: string // 'admin' for env admin, else user uuid
  username: string
  role: Role
  mustChange: boolean
}

function secret() {
  return new TextEncoder().encode(config.jwtSecret)
}

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12)
}
export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash)
}

export async function signSession(s: Session) {
  return new SignJWT({ username: s.username, role: s.role, mustChange: s.mustChange })
    .setProtectedHeader({ alg: ALG })
    .setSubject(s.sub)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret())
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    return {
      sub: String(payload.sub),
      username: String(payload.username),
      role: payload.role as Role,
      mustChange: Boolean(payload.mustChange)
    }
  } catch {
    return null
  }
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  return verifyToken(token)
}

export async function setSessionCookie(token: string) {
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE
  })
}

export async function clearSessionCookie() {
  ;(await cookies()).delete(SESSION_COOKIE)
}
