const fsp = require('fs').promises
const qrcode = require('qrcode-terminal')
const { sessionFolderPath } = require('../config')
const { logger } = require('../logger')
const { sessions } = require('../sessions')
const sessionHealth = require('../sessionHealth')

/**
 * Responds to request with 'pong'
 *
 * @function ping
 * @async
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - Promise that resolves once response is sent
 * @throws {Object} - Throws error if response fails
 */
const ping = async (req, res) => {
  /*
    #swagger.tags = ['Various']
    #swagger.summary = 'Health check'
    #swagger.description = 'Responds to request with "pong" message'
    #swagger.responses[200] = {
      description: "Response message",
      content: {
        "application/json": {
          example: {
            success: true,
            message: "pong"
          }
        }
      }
    }
  */
  res.json({ success: true, message: 'pong' })
}

/**
 * Example local callback that generates a QR code and writes a log file
 *
 * @function localCallbackExample
 * @async
 * @param {Object} req - Express request object containing a body object with dataType and data
 * @param {string} req.body.dataType - Type of data (in this case, 'qr')
 * @param {Object} req.body.data - Data to generate a QR code from
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - Promise that resolves once response is sent
 * @throws {Object} - Throws error if response fails
 */
const localCallbackExample = async (req, res) => {
  /*
    #swagger.tags = ['Various']
    #swagger.summary = 'Local callback'
    #swagger.description = 'Used to generate a QR code and writes a log file. ONLY FOR DEVELOPMENT/TEST PURPOSES.'
    #swagger.responses[200] = {
      description: "Response message",
      content: {
        "application/json": {
          example: {
            success: true
          }
        }
      }
    }
  */
  try {
    const { dataType, data } = req.body
    if (dataType === 'qr') { qrcode.generate(data.qr, { small: true }) }
    await fsp.mkdir(sessionFolderPath, { recursive: true })
    await fsp.writeFile(`${sessionFolderPath}/message_log.txt`, `${JSON.stringify(req.body)}\r\n`, { flag: 'a+' })
    res.json({ success: true })
  } catch (error) {
    /* #swagger.responses[500] = {
      description: "Server Failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
    */
    logger.error({ err: error }, 'Failed to handle local callback')
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * Reports whether every session finished starting and can receive events.
 * CONNECTED alone is not enough: a session can be CONNECTED and still receive
 * nothing if wwebjs's listener setup failed.
 *
 * @function sessionsHealth
 * @async
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - 200 when all sessions are healthy, 503 otherwise
 */
const sessionsHealth = async (req, res) => {
  /*
    #swagger.tags = ['Various']
    #swagger.summary = 'Session health'
    #swagger.description = 'Per-session readiness. Returns 503 when any session on disk is not running, not ready, logged out or waiting for a QR scan.'
    #swagger.responses[200] = {
      description: "All sessions healthy",
      content: {
        "application/json": {
          example: {
            success: true,
            healthy: true,
            sessions: [{ sessionId: 'main', status: 'ready', healthy: true, state: 'CONNECTED', startedAt: '2026-09-19T05:43:25.000Z', authenticatedAt: '2026-09-19T05:43:40.000Z', readyAt: '2026-09-19T05:43:41.000Z', lastMessageAt: '2026-09-19T05:53:42.000Z', watchdogRestarts: 0 }]
          }
        }
      }
    }
  */
  try {
    const files = await fsp.readdir(sessionFolderPath).catch(() => [])
    const onDisk = files.map(f => f.match(/^session-(.+)$/)).filter(Boolean).map(m => m[1])
    const ids = [...new Set([...onDisk, ...sessions.keys()])].sort()
    const results = await Promise.all(ids.map(async (sessionId) => {
      const client = sessions.get(sessionId)
      let state = null
      if (client) {
        let timer
        const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('TIMEOUT'), 5000) })
        state = await Promise.race([client.getState(), timeout]).catch(() => 'ERROR')
        clearTimeout(timer)
      }
      return sessionHealth.evaluate({ sessionId, hasClient: !!client, state, hasQr: !!(client && client.qr) })
    }))
    const healthy = results.every(r => r.healthy)
    res.status(healthy ? 200 : 503).json({ success: true, healthy, sessions: results })
  } catch (error) {
    logger.error({ err: error }, 'Failed to check session health')
    res.status(500).json({ success: false, error: error.message })
  }
}

module.exports = { ping, localCallbackExample, sessionsHealth }
