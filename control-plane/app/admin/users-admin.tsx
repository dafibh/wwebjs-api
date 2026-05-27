'use client'

import { useState } from 'react'

type User = {
  id: string
  username: string
  must_change_password: boolean
  session_quota: number | null
  created_at: string
  last_login: string | null
}

type Reveal = { username: string; tempPassword: string }

export default function UsersAdmin({ initialUsers }: { initialUsers: User[] }) {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [username, setUsername] = useState('')
  const [quota, setQuota] = useState('1')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState<Reveal | null>(null)

  async function refresh() {
    const res = await fetch('/api/admin/users')
    if (res.ok) setUsers((await res.json()).users)
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, sessionQuota: quota.trim() === '' ? 'unlimited' : quota.trim() })
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(data.error || 'failed')
    setReveal({ username: data.username, tempPassword: data.tempPassword })
    setUsername('')
    setQuota('1')
    refresh()
  }

  async function resetPw(u: User) {
    if (!confirm(`Reset password for "${u.username}"? Their current password stops working.`)) return
    const res = await fetch(`/api/admin/users/${u.id}/reset`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setError(data.error || 'failed')
    setReveal({ username: u.username, tempPassword: data.tempPassword })
    refresh()
  }

  async function editQuota(u: User) {
    const current = u.session_quota === null ? 'unlimited' : String(u.session_quota)
    const input = prompt(`Session quota for "${u.username}" (a number, or "unlimited")`, current)
    if (input === null) return
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionQuota: input.trim() })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setError(data.error || 'failed')
    refresh()
  }

  async function remove(u: User) {
    if (!confirm(`Delete "${u.username}"? This removes their sessions and API keys.`)) return
    const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
    if (!res.ok) return setError('delete failed')
    refresh()
  }

  return (
    <div>
      {reveal && (
        <div className="reveal">
          <div>
            Temporary password for <strong>{reveal.username}</strong> — share it once, it
            won&apos;t be shown again:
          </div>
          <div className="reveal-pw">
            <code>{reveal.tempPassword}</code>
            <button
              className="logout"
              onClick={() => navigator.clipboard?.writeText(reveal.tempPassword)}
            >
              Copy
            </button>
            <button className="logout" onClick={() => setReveal(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <form className="create" onSubmit={create}>
        <input
          placeholder="new username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          placeholder="quota (1, or 'unlimited')"
          value={quota}
          onChange={(e) => setQuota(e.target.value)}
        />
        <button style={{ width: 'auto', margin: 0 }} disabled={busy}>
          {busy ? '...' : 'Create user'}
        </button>
      </form>
      <div className="err">{error}</div>

      <table className="users">
        <thead>
          <tr>
            <th>Username</th>
            <th>Quota</th>
            <th>State</th>
            <th>Last login</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.session_quota === null ? 'unlimited' : u.session_quota}</td>
              <td className="muted">{u.must_change_password ? 'must set password' : 'active'}</td>
              <td className="muted">
                {u.last_login ? new Date(u.last_login).toLocaleString() : '—'}
              </td>
              <td className="actions">
                <button className="logout" onClick={() => resetPw(u)}>
                  Reset pw
                </button>
                <button className="logout" onClick={() => editQuota(u)}>
                  Quota
                </button>
                <button className="logout danger" onClick={() => remove(u)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
