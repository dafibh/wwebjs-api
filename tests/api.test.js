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

describe('API Authentication Tests', () => {
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
