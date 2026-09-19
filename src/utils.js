const axios = require('axios')
const { disabledCallbacks, enableWebHook } = require('./config')
const { logger } = require('./logger')
const ChatFactory = require('whatsapp-web.js/src/factories/ChatFactory')
const Client = require('whatsapp-web.js').Client
const { Chat, Message } = require('whatsapp-web.js/src/structures')
const { getWebhooksForEvent } = require('./webhookManager')

// Delays before each retry of a webhook the receiver never got. Covers n8n or the
// Cloudflare tunnel still starting after a reboot.
const WEBHOOK_RETRY_DELAYS_MS = [5 * 1000, 30 * 1000, 2 * 60 * 1000]

// Only retry when the receiver cannot have processed the request: no response at all,
// or a gateway saying it is unavailable. Anything else may already have run the
// workflow, and retrying would run it twice.
const isWebhookRetryable = (error) => {
  const status = error.response?.status
  return status === undefined ? !!error.request : [502, 503, 504].includes(status)
}

// Send a single webhook POST
const sendWebhook = (webhookURL, sessionId, dataType, data, attempt = 0) => {
  // Do NOT include the global x-api-key. The webhook URL points at a
  // user-controlled receiver (n8n etc), so we never leak the server key.
  // Receivers should rely on the URL's non-guessable id (and their own
  // auth on the receiving endpoint).
  axios.post(webhookURL, { dataType, data, sessionId })
    .then(() => logger.debug({ sessionId, dataType, data: data || '' }, `Webhook message sent to ${webhookURL}`))
    .catch(error => {
      if (isWebhookRetryable(error) && attempt < WEBHOOK_RETRY_DELAYS_MS.length) {
        const retryInMs = WEBHOOK_RETRY_DELAYS_MS[attempt]
        logger.warn({ sessionId, dataType, err: error.message, attempt: attempt + 1, retryInMs }, `Webhook to ${webhookURL} failed, retrying`)
        setTimeout(() => sendWebhook(webhookURL, sessionId, dataType, data, attempt + 1), retryInMs).unref()
        return
      }
      logger.error({ sessionId, dataType, err: error, data: data || '' }, `Failed to send webhook message to ${webhookURL}`)
    })
}

// Trigger webhook endpoint. The first argument is kept for upstream call-site
// compatibility but ignored: targets are resolved per-session from the webhook
// manager (with env-var fallback), then fanned out.
const triggerWebhook = (webhookURL, sessionId, dataType, data) => {
  if (!enableWebHook) return
  for (const url of getWebhooksForEvent(sessionId, dataType)) {
    sendWebhook(url, sessionId, dataType, data)
  }
}

// Function to send a response with error status and message
const sendErrorResponse = (res, status, error) => {
  const message = error instanceof Error ? error.message : error
  if (error instanceof Error) {
    logger.error({ err: error }, message)
  }
  res.status(status).json({ success: false, error: message })
}

// Function to wait for a specific item not to be null
const waitForNestedObject = (rootObj, nestedPath, maxWaitTime = 10000, interval = 100) => {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const checkObject = () => {
      const nestedObj = nestedPath.split('.').reduce((obj, key) => obj ? obj[key] : undefined, rootObj)
      if (nestedObj) {
        // Nested object exists, resolve the promise
        resolve()
      } else if (Date.now() - start > maxWaitTime) {
        // Maximum wait time exceeded, reject the promise
        logger.error('Timed out waiting for nested object')
        reject(new Error('Timeout waiting for nested object'))
      } else {
        // Nested object not yet created, continue waiting
        setTimeout(checkObject, interval)
      }
    }
    checkObject()
  })
}

const isEventEnabled = (event) => {
  return !disabledCallbacks.includes(event)
}

const sendMessageSeenStatus = async (message) => {
  try {
    const chat = await message.getChat()
    await chat.sendSeen()
  } catch (error) {
    logger.error(error, 'Failed to send seen status')
  }
}

const decodeBase64 = function * (base64String) {
  const chunkSize = 1024
  for (let i = 0; i < base64String.length; i += chunkSize) {
    const chunk = base64String.slice(i, i + chunkSize)
    yield Buffer.from(chunk, 'base64')
  }
}

const sleep = function (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const exposeFunctionIfAbsent = async (page, name, fn) => {
  const exist = await page.evaluate((name) => {
    return !!window[name]
  }, name)
  if (exist) {
    return
  }
  await page.exposeFunction(name, fn)
}

const patchWWebLibrary = async (client) => {
  // MUST be run after the 'ready' event fired
  Client.prototype.getChats = async function (searchOptions = {}) {
    const chats = await this.pupPage.evaluate(async (searchOptions) => {
      return await window.WWebJS.getChats({ ...searchOptions })
    }, searchOptions)

    return chats.map(chat => ChatFactory.create(this, chat))
  }

  Chat.prototype.fetchMessages = async function (searchOptions) {
    const messages = await this.client.pupPage.evaluate(async (chatId, searchOptions) => {
      const msgFilter = (m) => {
        if (m.isNotification) {
          return false
        }
        if (searchOptions && searchOptions.fromMe !== undefined && m.id.fromMe !== searchOptions.fromMe) {
          return false
        }
        if (searchOptions && searchOptions.since !== undefined && Number.isFinite(searchOptions.since) && m.t < searchOptions.since) {
          return false
        }
        if (searchOptions && searchOptions.messageId !== undefined && m.id.id !== searchOptions.messageId) {
          return false
        }
        return true
      }

      const chat = await window.WWebJS.getChat(chatId, { getAsModel: false })
      let msgs = chat.msgs.getModelsArray().filter(msgFilter)

      if (searchOptions && searchOptions.limit > 0) {
        while (msgs.length < searchOptions.limit) {
          const loadedMessages = await (window.require('WAWebChatLoadMessages')).loadEarlierMsgs({ chat })

          if (!loadedMessages || !loadedMessages.length) break
          msgs = [...loadedMessages.filter(msgFilter), ...msgs]
        }

        if (msgs.length > searchOptions.limit) {
          msgs.sort((a, b) => (a.t > b.t) ? 1 : -1)
          msgs = msgs.splice(msgs.length - searchOptions.limit)
        }
      }

      return msgs.map(m => window.WWebJS.getMessageModel(m))
    }, this.id._serialized, searchOptions)

    return messages.map(m => new Message(this.client, m))
  }

  await client.pupPage.evaluate(() => {
    // hotfix for https://github.com/pedroslopez/whatsapp-web.js/pull/3643
    window.WWebJS.getChats = async (searchOptions = {}) => {
      const chatFilter = (c) => {
        if (searchOptions && searchOptions.unread === true && c.unreadCount === 0) {
          return false
        }
        if (searchOptions && searchOptions.since !== undefined && Number.isFinite(searchOptions.since) && c.t < searchOptions.since) {
          return false
        }
        return true
      }

      const allChats = window.require('WAWebCollections').Chat.getModelsArray()

      const filteredChats = allChats.filter(chatFilter)

      return await Promise.all(
        filteredChats.map(chat => window.WWebJS.getChatModel(chat))
      )
    }
  })
}

// Resolves once url answers with any HTTP status, or false after maxWaitMs
const waitForInternet = async (url = 'https://web.whatsapp.com', maxWaitMs = 10 * 60 * 1000) => {
  const deadline = Date.now() + maxWaitMs
  let delay = 5000
  for (;;) {
    try {
      await axios.head(url, { timeout: 10000, validateStatus: () => true })
      return true
    } catch (error) {
      if (Date.now() + delay > deadline) {
        logger.warn({ err: error.message }, 'Still no internet, starting sessions anyway')
        return false
      }
      logger.warn({ err: error.message, retryInMs: delay }, 'Waiting for internet before starting sessions')
      await sleep(delay)
      delay = Math.min(delay * 2, 60 * 1000)
    }
  }
}

module.exports = {
  triggerWebhook,
  sendErrorResponse,
  waitForNestedObject,
  isEventEnabled,
  sendMessageSeenStatus,
  decodeBase64,
  sleep,
  waitForInternet,
  exposeFunctionIfAbsent,
  patchWWebLibrary
}
