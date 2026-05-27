import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import LogoutButton from './logout-button'
import KeysPanel from './keys-panel'

export default async function HomePage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <main className="page">
      <div className="row">
        <h1>WhatsApp Control Plane</h1>
        <LogoutButton />
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Signed in as <strong>{session.username}</strong> ({session.role})
      </p>

      {session.role === 'admin' && (
        <p style={{ marginTop: 32 }}>
          <a href="/admin">User administration →</a>
        </p>
      )}

      {session.role === 'user' && <KeysPanel />}

      <p className="muted" style={{ marginTop: 40 }}>
        Next: sessions.
      </p>
    </main>
  )
}
