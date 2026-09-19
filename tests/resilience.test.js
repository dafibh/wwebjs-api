const fs = require('fs')

const TEST_SESSIONS_PATH = './sessions_resilience_test'

// Fake wwebjs Client: an EventEmitter the tests drive by hand
jest.mock('whatsapp-web.js', () => {
  const EventEmitter = require('events')
  class Client extends EventEmitter {
    constructor (options) {
      super()
      this.options = options
      this.pupPage = { evaluate: async () => {}, removeAllListeners: () => {} }
      this.pupBrowser = { pages: async () => [], close: async () => {}, process: () => null, isConnected: () => false }
      Client.instances.push(this)
    }

    async initialize () {}
    async destroy () {}
    async getState () { return 'CONNECTED' }
  }
  Client.instances = []
  class LocalAuth {
    constructor ({ clientId }) { this.clientId = clientId }
  }
  return { Client, LocalAuth, MessageMedia: class {}, Location: class {}, Poll: class {} }
})

jest.mock('axios')

const loadModules = () => {
  jest.resetModules()
  process.env.SESSIONS_PATH = TEST_SESSIONS_PATH
  process.env.ENABLE_WEBSOCKET = 'FALSE'
  process.env.RECOVER_SESSIONS = 'FALSE'
  process.env.LOG_LEVEL = 'silent'
  return {
    Client: require('whatsapp-web.js').Client,
    axios: require('axios'),
    sessions: require('../src/sessions'),
    sessionHealth: require('../src/sessionHealth'),
    utils: require('../src/utils')
  }
}

// Let pending work inside setupSession/reloadSession finish, including real fs I/O,
// which needs event loop turns and not just microtasks
const flush = async () => { for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve)) }

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  fs.rmSync(TEST_SESSIONS_PATH, { recursive: true, force: true })
})

afterEach(() => {
  jest.useRealTimers()
})

afterAll(() => {
  fs.rmSync(TEST_SESSIONS_PATH, { recursive: true, force: true })
})

describe('sessionHealth.evaluate', () => {
  it('reports each lifecycle state', () => {
    const { sessionHealth } = loadModules()
    const t0 = Date.now()

    sessionHealth.markStarted('a')
    expect(sessionHealth.evaluate({ sessionId: 'a', hasClient: true, state: 'CONNECTED' }).status).toBe('starting')

    sessionHealth.markAuthenticated('a')
    const stuck = sessionHealth.evaluate({ sessionId: 'a', hasClient: true, state: 'CONNECTED', now: t0 + 10 * 60 * 1000 })
    expect(stuck.status).toBe('not_ready')
    expect(stuck.healthy).toBe(false)

    sessionHealth.markReady('a')
    expect(sessionHealth.evaluate({ sessionId: 'a', hasClient: true, state: 'CONNECTED' })).toMatchObject({ status: 'ready', healthy: true })
    expect(sessionHealth.evaluate({ sessionId: 'a', hasClient: true, state: 'UNPAIRED' })).toMatchObject({ status: 'not_connected', healthy: false })

    sessionHealth.markStarted('q')
    expect(sessionHealth.evaluate({ sessionId: 'q', hasClient: true, hasQr: true })).toMatchObject({ status: 'needs_qr', healthy: false })

    sessionHealth.markStopped('a')
    expect(sessionHealth.evaluate({ sessionId: 'a', hasClient: false })).toMatchObject({ status: 'stopped', healthy: true })

    expect(sessionHealth.evaluate({ sessionId: 'x', hasClient: false }).status).toBe('starting')
    expect(sessionHealth.evaluate({ sessionId: 'x', hasClient: false, now: t0 + 20 * 60 * 1000 })).toMatchObject({ status: 'not_running', healthy: false })
  })
})

describe('ready watchdog', () => {
  it('restarts a session that authenticates but never becomes ready', async () => {
    const { Client, sessions, sessionHealth } = loadModules()
    Client.instances = []
    await sessions.setupSession('s1')
    expect(Client.instances).toHaveLength(1)

    Client.instances[0].emit('authenticated')
    jest.advanceTimersByTime(sessionHealth.READY_TIMEOUT_MS)
    await flush()

    expect(Client.instances).toHaveLength(2)
    expect(sessions.sessions.get('s1')).toBe(Client.instances[1])
    expect(sessionHealth.get('s1').watchdogRestarts).toBe(1)

    // once the restarted client is ready the counter resets, the timestamp stays
    Client.instances[1].emit('authenticated')
    Client.instances[1].emit('ready')
    const health = sessionHealth.evaluate({ sessionId: 's1', hasClient: true, state: 'CONNECTED' })
    expect(health).toMatchObject({ status: 'ready', watchdogRestarts: 0 })
    expect(health.lastWatchdogRestartAt).not.toBeNull()
  })

  it('leaves a session alone when ready follows authenticated', async () => {
    const { Client, sessions, sessionHealth } = loadModules()
    Client.instances = []
    await sessions.setupSession('s2')
    Client.instances[0].emit('authenticated')
    Client.instances[0].emit('ready')
    jest.advanceTimersByTime(sessionHealth.READY_TIMEOUT_MS * 2)
    await flush()

    expect(Client.instances).toHaveLength(1)
    expect(sessionHealth.get('s2').readyAt).not.toBeNull()
  })

  it('gives up after the maximum number of restarts', async () => {
    const { Client, sessions, sessionHealth } = loadModules()
    Client.instances = []
    await sessions.setupSession('s3')
    for (let i = 0; i <= sessionHealth.MAX_WATCHDOG_RESTARTS; i++) {
      Client.instances[Client.instances.length - 1].emit('authenticated')
      jest.advanceTimersByTime(sessionHealth.READY_TIMEOUT_MS)
      await flush()
    }
    // the first client plus one per allowed restart, then no more
    expect(Client.instances).toHaveLength(1 + sessionHealth.MAX_WATCHDOG_RESTARTS)
  })

  it('ignores sessions waiting for a QR scan', async () => {
    const { Client, sessions, sessionHealth } = loadModules()
    Client.instances = []
    await sessions.setupSession('s4')
    Client.instances[0].emit('qr', 'qr-data')
    jest.advanceTimersByTime(sessionHealth.READY_TIMEOUT_MS * 2)
    await flush()
    expect(Client.instances).toHaveLength(1)
  })
})

describe('webhook retry', () => {
  // no webhooks.json entry for session 'w', so the env fallback is used
  const setup = () => {
    process.env.W_WEBHOOK_URL = 'https://hooks.example/x'
    process.env.ENABLE_WEBHOOK = 'TRUE'
    return loadModules()
  }

  it('retries when the receiver was unreachable', async () => {
    const { axios, utils } = setup()
    axios.post
      .mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { request: {} }))
      .mockResolvedValueOnce({ status: 200 })
    utils.triggerWebhook(null, 'w', 'message', {})
    await flush()
    expect(axios.post).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(5000)
    await flush()
    expect(axios.post).toHaveBeenCalledTimes(2)
  })

  it('retries a 502 from the gateway', async () => {
    const { axios, utils } = setup()
    axios.post
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { request: {}, response: { status: 502 } }))
      .mockResolvedValueOnce({ status: 200 })
    utils.triggerWebhook(null, 'w', 'message', {})
    await flush()
    jest.advanceTimersByTime(5000)
    await flush()
    expect(axios.post).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 500, which may have already run the workflow', async () => {
    const { axios, utils } = setup()
    axios.post.mockRejectedValue(Object.assign(new Error('Internal'), { request: {}, response: { status: 500 } }))
    utils.triggerWebhook(null, 'w', 'message', {})
    await flush()
    jest.advanceTimersByTime(10 * 60 * 1000)
    await flush()
    expect(axios.post).toHaveBeenCalledTimes(1)
  })
})

describe('waitForInternet', () => {
  it('waits until the url answers', async () => {
    const { axios, utils } = loadModules()
    axios.head
      .mockRejectedValueOnce(new Error('getaddrinfo EAI_AGAIN'))
      .mockResolvedValueOnce({ status: 200 })
    let result
    utils.waitForInternet('https://example.test', 60 * 1000).then(r => { result = r })
    await flush()
    expect(result).toBeUndefined()
    jest.advanceTimersByTime(5000)
    await flush()
    expect(result).toBe(true)
    expect(axios.head).toHaveBeenCalledTimes(2)
  })

  it('gives up after the max wait', async () => {
    const { axios, utils } = loadModules()
    axios.head.mockRejectedValue(new Error('network down'))
    let result
    utils.waitForInternet('https://example.test', 20 * 1000).then(r => { result = r })
    for (let i = 0; i < 10 && result === undefined; i++) {
      await flush()
      jest.advanceTimersByTime(60 * 1000)
    }
    await flush()
    expect(result).toBe(false)
  })
})
