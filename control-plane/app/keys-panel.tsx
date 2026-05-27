'use client'

import { useEffect, useState } from 'react'

type Key = {
  id: string
  prefix: string
  label: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export default function KeysPanel() {
  const [keys, setKeys] = useState<Key[]>([])
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  async function refresh() {
    const res = await fetch('/api/keys')
    if (res.ok) setKeys((await res.json()).keys)
  }
  useEffect(() => {
    refresh()
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(data.error || 'failed')
    setToken(data.token)
    setLabel('')
    refresh()
  }

  async function revoke(k: Key) {
    if (!confirm(`Revoke key ${k.prefix}…? Anything using it stops working.`)) return
    const res = await fetch(`/api/keys/${k.id}`, { method: 'DELETE' })
    if (!res.ok) return setError('revoke failed')
    refresh()
  }

  return (
    <section style={{ marginTop: 40 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>API keys</h2>
      <p className="muted">Use as the <code>x-api-key</code> header for programmatic access.</p>

      {token && (
        <div className="reveal">
          <div>Copy your new key now — it won&apos;t be shown again:</div>
          <div className="reveal-pw">
            <code>{token}</code>
            <button className="logout" onClick={() => navigator.clipboard?.writeText(token)}>
              Copy
            </button>
            <button className="logout" onClick={() => setToken(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <form className="create" onSubmit={create}>
        <input
          placeholder="label (optional, e.g. n8n)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button style={{ width: 'auto', margin: 0 }} disabled={busy}>
          {busy ? '...' : 'Create key'}
        </button>
      </form>
      <div className="err">{error}</div>

      <table className="users">
        <thead>
          <tr>
            <th>Key</th>
            <th>Label</th>
            <th>Last used</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td><code>{k.prefix}…</code></td>
              <td>{k.label || <span className="muted">—</span>}</td>
              <td className="muted">
                {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}
              </td>
              <td className="muted">{k.revoked_at ? 'revoked' : 'active'}</td>
              <td className="actions">
                {!k.revoked_at && (
                  <button className="logout danger" onClick={() => revoke(k)}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
          {keys.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No keys yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
