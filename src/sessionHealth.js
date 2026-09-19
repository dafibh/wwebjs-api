// Tracks whether each session actually finished starting up. A session can show
// CONNECTED and still receive nothing: if wwebjs's attachEventListeners() fails,
// 'ready' never fires and no message events reach us. Nothing logs that, so we
// record the lifecycle here and let the watchdog and /health/sessions act on it.

// 'ready' normally fires about a second after 'authenticated'
const READY_TIMEOUT_MS = 3 * 60 * 1000
const MAX_WATCHDOG_RESTARTS = 3
// how long after server start a session with no client still counts as starting
const STARTUP_GRACE_MS = 15 * 60 * 1000

const records = new Map()
const serverStartedAt = Date.now()

const get = (sessionId) => records.get(sessionId)

const markStarted = (sessionId) => {
  const prev = records.get(sessionId)
  records.set(sessionId, {
    startedAt: Date.now(),
    authenticatedAt: null,
    readyAt: null,
    lastMessageAt: prev ? prev.lastMessageAt : null,
    watchdogRestarts: prev ? prev.watchdogRestarts : 0
  })
}

const update = (sessionId, fields) => {
  const rec = records.get(sessionId)
  if (rec) Object.assign(rec, fields)
}

const markAuthenticated = (sessionId) => update(sessionId, { authenticatedAt: Date.now() })
const markReady = (sessionId) => update(sessionId, { readyAt: Date.now(), watchdogRestarts: 0 })
const markMessage = (sessionId) => update(sessionId, { lastMessageAt: Date.now() })
// stopped on purpose via /session/stop, so it is not reported as broken
const markStopped = (sessionId) => update(sessionId, { stopped: true })
const remove = (sessionId) => records.delete(sessionId)

// Returns 'restart' while restarts are left, otherwise 'give_up'
const recordWatchdogFire = (sessionId) => {
  const rec = records.get(sessionId)
  if (!rec || rec.watchdogRestarts >= MAX_WATCHDOG_RESTARTS) return 'give_up'
  rec.watchdogRestarts++
  return 'restart'
}

// status is one of: ready, starting, stopped, needs_qr, not_connected, not_ready, not_running
const evaluate = ({ sessionId, hasClient, state, hasQr, now = Date.now() }) => {
  const rec = records.get(sessionId)
  const iso = (t) => (t ? new Date(t).toISOString() : null)
  let status
  if (!hasClient && rec && rec.stopped) {
    status = 'stopped'
  } else if (!hasClient) {
    status = now - serverStartedAt < STARTUP_GRACE_MS ? 'starting' : 'not_running'
  } else if (rec && rec.readyAt) {
    status = state === 'CONNECTED' ? 'ready' : 'not_connected'
  } else if (hasQr) {
    status = 'needs_qr'
  } else if (rec && now - (rec.authenticatedAt || rec.startedAt) < READY_TIMEOUT_MS + 60 * 1000) {
    status = 'starting'
  } else {
    status = 'not_ready'
  }
  return {
    sessionId,
    status,
    healthy: ['ready', 'starting', 'stopped'].includes(status),
    state: state || null,
    startedAt: iso(rec && rec.startedAt),
    authenticatedAt: iso(rec && rec.authenticatedAt),
    readyAt: iso(rec && rec.readyAt),
    lastMessageAt: iso(rec && rec.lastMessageAt),
    watchdogRestarts: rec ? rec.watchdogRestarts : 0
  }
}

module.exports = {
  READY_TIMEOUT_MS,
  MAX_WATCHDOG_RESTARTS,
  get,
  markStarted,
  markAuthenticated,
  markReady,
  markMessage,
  markStopped,
  remove,
  recordWatchdogFire,
  evaluate
}
