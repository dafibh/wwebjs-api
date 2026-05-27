'use client'

import { useCallback, useEffect, useState } from 'react'
import SessionRow, { type Session } from './session-row'

export default function SessionsManager() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [onboard, setOnboard] = useState<string | null>(null)
  const [onboardState, setOnboardState] = useState('starting')
  const [tick, setTick] = useState(0)

  const refresh = useCallback(async () => {
    const r = await fetch('/api/sessions')
    if (r.ok) setSessions((await r.json()).sessions)
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const r = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return setError(d.error || 'failed')
    setLabel('')
    setOnboardState('starting')
    setOnboard(d.sessionId)
    refresh()
  }

  // Poll status + refresh the QR while the onboarding modal is open.
  useEffect(() => {
    if (!onboard) return
    const iv = setInterval(async () => {
      setTick((t) => t + 1)
      const r = await fetch(`/api/wa/session/status/${onboard}`)
      const d = await r.json().catch(() => ({}))
      setOnboardState(d.success ? 'connected' : String(d.state || d.message || '…'))
      // success === true is set by the API only when state is CONNECTED.
      if (d.success === true) {
        clearInterval(iv)
        setOnboard(null)
        refresh()
      }
    }, 2500)
    return () => clearInterval(iv)
  }, [onboard, refresh])

  async function remove(id: string) {
    if (!confirm('Delete this session? It logs the device out and removes it.')) return
    const r = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    if (r.ok) refresh()
  }

  return (
    <div>
      <form className="create" onSubmit={create}>
        <input
          placeholder="label (optional, e.g. personal)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button style={{ width: 'auto', margin: 0 }} disabled={busy}>
          {busy ? '…' : 'Add session'}
        </button>
      </form>
      <div className="err">{error}</div>

      <table className="users">
        <thead>
          <tr>
            <th>Label</th>
            <th>Session</th>
            <th>Number</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <SessionRow key={s.session_id} session={s} onDelete={() => remove(s.session_id)} />
          ))}
          {sessions.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No sessions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {onboard && (
        <div className="modal" onClick={() => setOnboard(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Link WhatsApp</h2>
            <p className="muted">
              On your phone: WhatsApp → Linked devices → Link a device, then scan:
            </p>
            <img className="qr" alt="WhatsApp QR code" src={`/api/wa/session/qr/${onboard}/image?t=${tick}`} />
            <p className="muted">Status: {onboardState}</p>
            <button className="logout" onClick={() => setOnboard(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
