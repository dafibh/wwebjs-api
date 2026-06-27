const request = require('supertest')
const fs = require('fs')

jest.setTimeout(60_000)

const TEST_SESSIONS_PATH = './sessions_test'
const TEST_API_KEY = 'test_api_key'

const setupFreshApp = () => {
  jest.resetModules()
  process.env.API_KEY = TEST_API_KEY
  process.env.SESSIONS_PATH = TEST_SESSIONS_PATH
  // Ensure tests reflect the dynamic webhook system (not the legacy localCallback example)
  delete process.env.ENABLE_LOCAL_CALLBACK_EXAMPLE
  delete process.env.BASE_WEBHOOK_URL
  // Load a fresh app instance so config/webhookManager read the env cleanly
  // eslint-disable-next-line global-require
  return require('../src/app')
}

// Top-level app instance for upstream-style tests that reference `app` directly.
// HEAD-style tests should call setupFreshApp() for an isolated instance.
process.env.API_KEY = TEST_API_KEY
process.env.SESSIONS_PATH = TEST_SESSIONS_PATH
const app = require('../src/app')

beforeEach(() => {
  fs.rmSync(TEST_SESSIONS_PATH, { recursive: true, force: true })
})

afterAll(() => {
  fs.rmSync(TEST_SESSIONS_PATH, { recursive: true, force: true })
})

// Define test cases
describe('API health checks', () => {
  it('should return valid health check', async () => {
    const app = setupFreshApp()
    const response = await request(app).get('/ping')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ message: 'pong', success: true })
  })
})

describe('API session checks', () => {
  it('should return 403 Forbidden for invalid API key', async () => {
    const app = setupFreshApp()
    const response = await request(app).get('/webhook/events')
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ success: false, error: 'Invalid API key' })
  })

})

describe('Webhook management (per-session)', () => {
  it('should list valid event types', async () => {
    const app = setupFreshApp()
    const res = await request(app).get('/webhook/events').set('x-api-key', TEST_API_KEY)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.eventTypes)).toBe(true)
    expect(res.body.eventTypes).toEqual(expect.arrayContaining(['message', 'qr', 'ready']))
  })

  it('should add/get/update/delete a webhook for a session', async () => {
    const app = setupFreshApp()

    // Add
    const addRes = await request(app)
      .post('/webhook/session/work')
      .set('x-api-key', TEST_API_KEY)
      .send({ url: 'https://example.com/webhook', events: ['message'], enabled: true })
    expect(addRes.status).toBe(201)
    expect(addRes.body.success).toBe(true)
    expect(addRes.body.webhook).toEqual(expect.objectContaining({
      id: expect.any(String),
      url: 'https://example.com/webhook',
      enabled: true,
      events: ['message']
    }))
    const webhookId = addRes.body.webhook.id

    // Get
    const getRes = await request(app)
      .get('/webhook/session/work')
      .set('x-api-key', TEST_API_KEY)
    expect(getRes.status).toBe(200)
    expect(getRes.body.success).toBe(true)
    expect(getRes.body.webhooks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: webhookId })
    ]))

    // Update
    const updateRes = await request(app)
      .put(`/webhook/session/work/${webhookId}`)
      .set('x-api-key', TEST_API_KEY)
      .send({ enabled: false, events: ['qr'] })
    expect(updateRes.status).toBe(200)
    expect(updateRes.body.success).toBe(true)
    expect(updateRes.body.webhook).toEqual(expect.objectContaining({
      id: webhookId,
      enabled: false,
      events: ['qr']
    }))

    // Delete
    const delRes = await request(app)
      .delete(`/webhook/session/work/${webhookId}`)
      .set('x-api-key', TEST_API_KEY)
    expect(delRes.status).toBe(200)
    expect(delRes.body).toEqual({ success: true, message: 'Webhook deleted successfully' })
  })
})

describe('API action checks', () => {
  it('should setup, create at least a QR, and terminate a client session', async () => {
    const response = await request(app).get('/session/start/4').set('x-api-key', 'test_api_key')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, message: 'Session initiated successfully' })
    expect(fs.existsSync('./sessions_test/session-4')).toBe(true)

    // Wait for message_log.txt to not be empty
    const result = await waitForFileNotToBeEmpty('./sessions_test/message_log.txt', 120_000, 1000)
      .then(() => { return true })
      .catch(() => { return false })
    expect(result).toBe(true)

    // Verify the message content
    const expectedMessage = {
      dataType: 'qr',
      data: expect.objectContaining({ qr: expect.any(String) }),
      sessionId: '4'
    }
    expect(JSON.parse(fs.readFileSync('./sessions_test/message_log.txt', 'utf-8'))).toEqual(expectedMessage)

    const response2 = await request(app).get('/session/terminate/4').set('x-api-key', 'test_api_key')
    expect(response2.status).toBe(200)
    expect(response2.body).toEqual({ success: true, message: 'Logged out successfully' })
    expect(fs.existsSync('./sessions_test/session-4')).toBe(false)
  })
})

describe('Session endpoints - no active session', () => {
  beforeAll(() => {
    if (!fs.existsSync(process.env.SESSIONS_PATH)) {
      fs.mkdirSync(process.env.SESSIONS_PATH, { recursive: true })
    }
  })

  it('GET /session/getSessions returns empty array', async () => {
    const response = await request(app).get('/session/getSessions').set('x-api-key', 'test_api_key')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, result: [] })
  })

  it('GET /session/status/:id returns session_not_found', async () => {
    const response = await request(app).get('/session/status/nonexistent').set('x-api-key', 'test_api_key')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: false, state: null, message: 'session_not_found' })
  })

  it('GET /session/stop/:id succeeds silently for non-existent session', async () => {
    const response = await request(app).get('/session/stop/nonexistent').set('x-api-key', 'test_api_key')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, message: 'Session stopped successfully' })
  })

  it('GET /session/qr/:id returns session_not_found', async () => {
    const response = await request(app).get('/session/qr/nonexistent').set('x-api-key', 'test_api_key')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: false, message: 'session_not_found' })
  })

  it('GET /session/qr/:id/image returns session_not_found', async () => {
    const response = await request(app).get('/session/qr/nonexistent/image').set('x-api-key', 'test_api_key')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: false, message: 'session_not_found' })
  })

  it('GET /session/restart/:id returns session_not_found', async () => {
    const response = await request(app).get('/session/restart/nonexistent').set('x-api-key', 'test_api_key')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: false, state: null, message: 'session_not_found' })
  })

  it('GET /session/terminateAll succeeds with no active sessions', async () => {
    const response = await request(app).get('/session/terminateAll').set('x-api-key', 'test_api_key')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, message: 'Flush completed successfully' })
  })

  it('POST /session/requestPairingCode/:id returns session_not_found', async () => {
    const response = await request(app).post('/session/requestPairingCode/nonexistent')
      .set('x-api-key', 'test_api_key')
      .send({ phoneNumber: '12025550108' })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: false, message: 'session_not_found' })
  })

  it('GET /session/getPageScreenshot/:id returns session_not_found', async () => {
    const response = await request(app).get('/session/getPageScreenshot/nonexistent').set('x-api-key', 'test_api_key')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: false, message: 'session_not_found' })
  })
})

describe('Session validation - 404 for non-existent session', () => {
  it.each([
    ['GET', '/client/getContacts/nonexistent'],
    ['POST', '/client/sendMessage/nonexistent'],
    ['POST', '/chat/getClassInfo/nonexistent'],
    ['POST', '/chat/fetchMessages/nonexistent'],
    ['POST', '/groupChat/getClassInfo/nonexistent'],
    ['POST', '/groupChat/leave/nonexistent'],
    ['POST', '/message/getClassInfo/nonexistent'],
    ['POST', '/message/react/nonexistent'],
    ['POST', '/contact/getClassInfo/nonexistent'],
    ['POST', '/contact/getAbout/nonexistent'],
    ['POST', '/channel/getClassInfo/nonexistent'],
    ['POST', '/channel/sendMessage/nonexistent']
  ])('%s %s returns 404 session_not_found', async (method, url) => {
    const response = await request(app)[method.toLowerCase()](url).set('x-api-key', 'test_api_key')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ success: false, error: 'session_not_found' })
  })
})

describe('Authentication - 403 without a valid API key', () => {
  it.each([
    ['GET', '/client/getContacts/1'],
    ['POST', '/chat/getClassInfo/1'],
    ['POST', '/groupChat/getClassInfo/1'],
    ['POST', '/message/getClassInfo/1'],
    ['POST', '/contact/getClassInfo/1'],
    ['POST', '/channel/getClassInfo/1']
  ])('%s %s returns 403 when the API key header is missing', async (method, url) => {
    const response = await request(app)[method.toLowerCase()](url)
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ success: false, error: 'Invalid API key' })
  })

  it('returns 403 when the API key is wrong', async () => {
    const response = await request(app).get('/client/getContacts/1').set('x-api-key', 'wrong_api_key')
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ success: false, error: 'Invalid API key' })
  })
})

// Function to wait for a specific item to be equal a specific value
const waitForFileNotToBeEmpty = (filePath, maxWaitTime = 10000, interval = 100) => {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const checkObject = async () => {
      try {
        const filecontent = await fs.promises.readFile(filePath, 'utf-8')
        if (filecontent !== '') {
        // Nested object exists, resolve the promise
          resolve()
        } else if (Date.now() - start > maxWaitTime) {
        // Maximum wait time exceeded, reject the promise
          console.log('Timed out waiting for nested object')
          reject(new Error('Timeout waiting for nested object'))
        } else {
        // Nested object not yet created, continue waiting
          setTimeout(checkObject, interval)
        }
      } catch (ignore) {
        // continue waiting
        setTimeout(checkObject, interval)
      }
    }
    checkObject()
  })
}
