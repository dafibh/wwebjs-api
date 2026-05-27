'use client'

import { useEffect, useState } from 'react'

export type Session = {
  session_id: string
  label: string | null
  status: string | null
  wa_number: string | null
  created_at: string
  last_seen: string | null
}

type Hook = { id: string; url: string; events: string[]; enabled?: boolean }

export default function SessionRow({
  session,
  onDelete
}: {
  session: Session
  onDelete: () => void
}) {
  const id = session.session_id
  const [state, setState] = useState('…')
  const [open, setOpen] = useState(false)

  async function loadStatus() {
    const r = await fetch(`/api/wa/session/status/${id}`)
    const d = await r.json().catch(() => ({}))
    setState(d.success ? 'connected' : String(d.state || d.message || 'offline'))
  }
  useEffect(() => {
    loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <tr>
        <td>{session.label || <span className="muted">—</span>}</td>
        <td>
          <code>{id}</code>
        </td>
        <td className="muted">{session.wa_number || '—'}</td>
        <td className="muted">{new Date(session.created_at).toLocaleString()}</td>
        <td className="actions">
          <span className="muted" style={{ marginRight: 8 }}>{state}</span>
          <button className="logout" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Manage'}
          </button>
          <button className="logout danger" onClick={onDelete}>
            Delete
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <div className="detail">
              <SendBox id={id} />
              <Webhooks id={id} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function SendBox({ id }: { id: string }) {
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState('')
  const [res, setRes] = useState('')

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setRes('sending…')
    const r = await fetch(`/api/wa/client/sendMessage/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: `${phone.replace(/\D/g, '')}@c.us`,
        contentType: 'string',
        content: msg
      })
    })
    const d = await r.json().catch(() => ({}))
    setRes(r.ok ? 'sent ✓' : d.error || 'failed')
  }

  return (
    <form className="create" onSubmit={send} style={{ marginTop: 0 }}>
      <input placeholder="number e.g. 62812..." value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input placeholder="message" value={msg} onChange={(e) => setMsg(e.target.value)} />
      <button style={{ width: 'auto', margin: 0 }}>Send</button>
      <span className="muted" style={{ alignSelf: 'center' }}>{res}</span>
    </form>
  )
}

function Webhooks({ id }: { id: string }) {
  const [hooks, setHooks] = useState<Hook[]>([])
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const r = await fetch(`/api/wa/webhook/session/${id}`)
    const d = await r.json().catch(() => ({}))
    setHooks((d.webhooks ?? (Array.isArray(d) ? d : [])) as Hook[])
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    const evs = events.split(',').map((s) => s.trim()).filter(Boolean)
    const r = await fetch(`/api/wa/webhook/session/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, events: evs })
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return setErr(d.error || 'failed')
    setUrl('')
    setEvents('')
    load()
  }

  async function del(wid: string) {
    const r = await fetch(`/api/wa/webhook/session/${id}/${wid}`, { method: 'DELETE' })
    if (r.ok) load()
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div className="muted" style={{ marginBottom: 8 }}>Webhooks</div>
      {hooks.map((h) => (
        <div key={h.id} className="hook">
          <code>{h.url}</code>
          <span className="muted">{h.events?.length ? h.events.join(', ') : 'all events'}</span>
          <button className="logout danger" onClick={() => del(h.id)}>
            Remove
          </button>
        </div>
      ))}
      <form className="create" onSubmit={add}>
        <input placeholder="https://your-webhook" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input
          placeholder="events (comma separated, blank = all)"
          value={events}
          onChange={(e) => setEvents(e.target.value)}
        />
        <button style={{ width: 'auto', margin: 0 }}>Add</button>
      </form>
      <div className="err">{err}</div>
    </div>
  )
}
