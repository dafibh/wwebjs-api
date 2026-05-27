import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { listUsers } from '@/lib/users'
import UsersAdmin from './users-admin'

export default async function AdminPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/')

  const users = await listUsers()

  return (
    <main className="page">
      <div className="row">
        <h1>User administration</h1>
        <a className="muted" href="/">
          ← back
        </a>
      </div>
      <UsersAdmin initialUsers={users} />
    </main>
  )
}
