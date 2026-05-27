'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (pw1 !== pw2) return setError('passwords do not match')
    if (pw1.length < 8) return setError('password must be at least 8 characters')
    setBusy(true)
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: pw1 })
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(data.error || 'failed')
    router.replace('/')
    router.refresh()
  }

  return (
    <main className="center">
      <form className="card" onSubmit={submit}>
        <h1>Set a new password</h1>
        <p className="muted">Choose a password to replace your temporary one.</p>
        <label htmlFor="p1">New password</label>
        <input id="p1" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoFocus />
        <label htmlFor="p2">Confirm password</label>
        <input id="p2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <button disabled={busy}>{busy ? '...' : 'Save'}</button>
        <div className="err">{error}</div>
      </form>
    </main>
  )
}
