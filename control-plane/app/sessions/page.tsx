import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import SessionsManager from './sessions-manager'

export default async function SessionsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'user') redirect('/')

  return (
    <main className="page">
      <div className="row">
        <h1>WhatsApp sessions</h1>
        <a className="muted" href="/">
          ← back
        </a>
      </div>
      <SessionsManager />
    </main>
  )
}
