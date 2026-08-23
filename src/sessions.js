const { Client, LocalAuth } = require('whatsapp-web.js')
const fs = require('fs')
const path = require('path')
const sessions = new Map()
const { baseWebhookURL, sessionFolderPath, maxAttachmentSize, setMessagesAsSeen, webVersion, webVersionCacheType, recoverSessions, chromeBin, headless, releaseBrowserLock, proxyUrl, proxyUsername, proxyPassword } = require('./config')
const { triggerWebhook, waitForNestedObject, isEventEnabled, sendMessageSeenStatus, sleep, patchWWebLibrary } = require('./utils')
const { logger } = require('./logger')
const { initWebSocketServer, terminateWebSocketServer, triggerWebSocket } = require('./websocket')

// Function to validate if the session is ready
const validateSession = async (sessionId) => {
  try {
    const returnData = { success: false, state: null, message: '' }

    // Session not Connected 😢
    if (!sessions.has(sessionId) || !sessions.get(sessionId)) {
      returnData.message = 'session_not_found'
      return returnData
    }

    const client = sessions.get(sessionId)
    // wait until the client is created
    await waitForNestedObject(client, 'pupPage')
      .catch((err) => { return { success: false, state: null, message: err.message } })

    // Wait for client.pupPage to be evaluable
    let maxRetry = 0
    while (true) {
      try {
        if (client.pupPage.isClosed()) {
          return { success: false, state: null, message: 'browser tab closed' }
        }
        await Promise.race([
          client.pupPage.evaluate('1'),
          new Promise(resolve => setTimeout(resolve, 1000))
        ])
        break
      } catch (error) {
        if (maxRetry === 2) {
          return { success: false, state: null, message: 'session closed' }
        }
        maxRetry++
      }
    }

    const state = await client.getState()
    returnData.state = state
    if (state !== 'CONNECTED') {
      returnData.message = 'session_not_connected'
      return returnData
    }

    // Session Connected 🎉
    returnData.success = true
    returnData.message = 'session_connected'
    return returnData
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to validate session')
    return { success: false, state: null, message: error.message }
  }
}

// Function to handle client session restoration
const restoreSessions = () => {
  try {
    if (!fs.existsSync(sessionFolderPath)) {
      fs.mkdirSync(sessionFolderPath) // Create the session directory if it doesn't exist
    }
    // Read the contents of the folder
    fs.readdir(sessionFolderPath, async (_, files) => {
      // Iterate through the files in the parent folder
      for (const file of files) {
        // Use regular expression to extract the string from the folder name
        const match = file.match(/^session-(.+)$/)
        if (match) {
          const sessionId = match[1]
          logger.warn({ sessionId }, 'Existing session detected')
          await setupSession(sessionId)
        }
      }
    })
  } catch (error) {
    logger.error(error, 'Failed to restore sessions')
  }
}

// Setup Session
const setupSession = async (sessionId) => {
  try {
    if (sessions.has(sessionId)) {
      return { success: false, message: `Session already exists for: ${sessionId}`, client: sessions.get(sessionId) }
    }
    logger.info({ sessionId }, 'Session is being initiated')
    // Disable the delete folder from the logout function (will be handled separately)
    const localAuth = new LocalAuth({ clientId: sessionId, dataPath: sessionFolderPath })
    delete localAuth.logout
    localAuth.logout = () => { }

    const clientOptions = {
      puppeteer: {
        executablePath: chromeBin,
        headless,
        args: [
          '--autoplay-policy=user-gesture-required',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-dev-shm-usage',
          '--disable-domain-reliability',
          '--disable-extensions',
          '--disable-features=AudioServiceOutOfProcess',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-notifications',
          '--disable-offer-store-unmasked-wallet-cards',
          '--disable-popup-blocking',
          '--disable-print-preview',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--disable-speech-api',
          '--disable-sync',
          '--disable-gpu',
          '--disable-accelerated-2d-canvas',
          '--hide-scrollbars',
          '--ignore-gpu-blacklist',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
          '--no-first-run',
          '--no-pings',
          '--no-zygote',
          '--password-store=basic',
          '--use-gl=swiftshader',
          '--use-mock-keychain',
          '--disable-setuid-sandbox',
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          // Route Chromium outbound traffic through PROXY_URL when configured.
          ...(proxyUrl ? [`--proxy-server=${proxyUrl}`] : [])
        ]
      },
      authStrategy: localAuth
    }

    if (proxyUrl && proxyUsername != null && proxyPassword != null) {
      clientOptions.proxyAuthentication = { username: proxyUsername, password: proxyPassword }
    }

    if (webVersion) {
      clientOptions.webVersion = webVersion
      switch (webVersionCacheType.toLowerCase()) {
        case 'local':
          clientOptions.webVersionCache = {
            type: 'local'
          }
          break
        case 'remote':
          clientOptions.webVersionCache = {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/' + webVersion + '.html'
          }
          break
        default:
          clientOptions.webVersionCache = {
            type: 'none'
          }
      }
    }

    const client = new Client(clientOptions)
    if (releaseBrowserLock) {
      // See https://github.com/puppeteer/puppeteer/issues/4860
      const singletonLockPath = path.resolve(path.join(sessionFolderPath, `session-${sessionId}`, 'SingletonLock'))
      const singletonLockExists = await fs.promises.lstat(singletonLockPath).then(() => true).catch(() => false)
      if (singletonLockExists) {
        // SingletonLock is a symlink named <hostname>-<pid>. Removing it while the profile
        // is really in use lets a second browser share the same user-data-dir and corrupt
        // it, which is how orphaned browsers piled up. The pid alone can't be trusted: it
        // is often stale (left by a previous container) and pids get reused, so only treat
        // the profile as busy when that process really is a browser on THIS profile.
        const lockTarget = await fs.promises.readlink(singletonLockPath).catch(() => '')
        const lockPid = Number.parseInt(lockTarget.split('-').pop(), 10)
        let lockHolderAlive = false
        if (Number.isInteger(lockPid) && lockPid > 0) {
          const cmdline = await fs.promises.readFile(`/proc/${lockPid}/cmdline`, 'utf-8').catch(() => '')
          const userDataDir = cmdline.split('\u0000')
            .find(arg => arg.startsWith('--user-data-dir='))
            ?.slice('--user-data-dir='.length)
          lockHolderAlive = !!userDataDir && path.basename(userDataDir) === `session-${sessionId}`
        }
        if (lockHolderAlive) {
          throw new Error(`Browser profile for ${sessionId} is still in use by pid ${lockPid}`)
        }
        logger.warn({ sessionId }, 'Browser lock file exists, removing')
        await fs.promises.unlink(singletonLockPath)
      }
    }

    try {
      client.once('ready', () => {
        patchWWebLibrary(client).catch((err) => {
          logger.error({ sessionId, err }, 'Failed to patch WWebJS library')
        })
      })
      initWebSocketServer(sessionId)
      initializeEvents(client, sessionId)
      await client.initialize()
    } catch (error) {
      logger.error({ sessionId, err: error }, 'Initialize error')
      // Destroy the browser, otherwise it keeps holding the session profile folder
      // and the next start attempt launches a second browser on the same profile
      await client.destroy().catch((err) => {
        logger.error({ sessionId, err }, 'Failed to destroy client after initialize error')
      })
      await terminateWebSocketServer(sessionId).catch((err) => {
        logger.error({ sessionId, err }, 'Failed to terminate WebSocket server after initialize error')
      })
      throw error
    }

    // Save the session to the Map
    sessions.set(sessionId, client)
    return { success: true, message: 'Session initiated successfully', client }
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to setup session')
    return { success: false, message: error.message, client: null }
  }
}

const initializeEvents = (client, sessionId) => {
  // check if the session webhook is overridden
  const sessionWebhook = process.env[sessionId.toUpperCase() + '_WEBHOOK_URL'] || baseWebhookURL

  if (recoverSessions) {
    waitForNestedObject(client, 'pupPage').then(() => {
      const restartSession = async (sessionId) => {
        sessions.delete(sessionId)
        await client.destroy().catch(e => { })
        await setupSession(sessionId)
      }
      client.pupPage.once('close', function () {
        // emitted when the page closes
        logger.warn({ sessionId }, 'Browser page closed. Restoring')
        restartSession(sessionId)
      })
      client.pupPage.once('error', function () {
        // emitted when the page crashes
        logger.warn({ sessionId }, 'Error occurred on browser page. Restoring')
        restartSession(sessionId)
      })
      client.pupPage
        .on('console', message => {
          const type = message.type().substr(0, 3).toUpperCase()
          logger.debug({ sessionId, type }, `Page console log: ${message.text()}`)
        })
        .on('requestfailed', request => {
          const failure = request.failure()
          if (failure) {
            logger.error({ sessionId, url: request.url() }, `Page request failed: ${failure.errorText}`)
          } else {
            logger.error({ sessionId, url: request.url() }, 'Page request failed but no failure reason provided')
          }
        })
        .on('pageerror', ({ message }) => logger.error({ sessionId, message }, 'Page error occurred'))
    }).catch(e => { })
  }

  if (isEventEnabled('auth_failure')) {
    client.on('auth_failure', (msg) => {
      triggerWebhook(sessionWebhook, sessionId, 'status', { msg })
      triggerWebSocket(sessionId, 'status', { msg })
    })
  }

  client.on('authenticated', () => {
    client.qr = null
    if (isEventEnabled('authenticated')) {
      triggerWebhook(sessionWebhook, sessionId, 'authenticated')
      triggerWebSocket(sessionId, 'authenticated')
    }
  })

  if (isEventEnabled('call')) {
    client.on('call', (call) => {
      triggerWebhook(sessionWebhook, sessionId, 'call', { call })
      triggerWebSocket(sessionId, 'call', { call })
    })
  }

  if (isEventEnabled('change_state')) {
    client.on('change_state', state => {
      triggerWebhook(sessionWebhook, sessionId, 'change_state', { state })
      triggerWebSocket(sessionId, 'change_state', { state })
    })
  }

  if (isEventEnabled('disconnected')) {
    client.on('disconnected', (reason) => {
      triggerWebhook(sessionWebhook, sessionId, 'disconnected', { reason })
      triggerWebSocket(sessionId, 'disconnected', { reason })
    })
  }

  if (isEventEnabled('group_join')) {
    client.on('group_join', (notification) => {
      triggerWebhook(sessionWebhook, sessionId, 'group_join', { notification })
      triggerWebSocket(sessionId, 'group_join', { notification })
    })
  }

  if (isEventEnabled('group_leave')) {
    client.on('group_leave', (notification) => {
      triggerWebhook(sessionWebhook, sessionId, 'group_leave', { notification })
      triggerWebSocket(sessionId, 'group_leave', { notification })
    })
  }

  if (isEventEnabled('group_admin_changed')) {
    client.on('group_admin_changed', (notification) => {
      triggerWebhook(sessionWebhook, sessionId, 'group_admin_changed', { notification })
      triggerWebSocket(sessionId, 'group_admin_changed', { notification })
    })
  }

  if (isEventEnabled('group_membership_request')) {
    client.on('group_membership_request', (notification) => {
      triggerWebhook(sessionWebhook, sessionId, 'group_membership_request', { notification })
      triggerWebSocket(sessionId, 'group_membership_request', { notification })
    })
  }

  if (isEventEnabled('group_update')) {
    client.on('group_update', (notification) => {
      triggerWebhook(sessionWebhook, sessionId, 'group_update', { notification })
      triggerWebSocket(sessionId, 'group_update', { notification })
    })
  }

  if (isEventEnabled('loading_screen')) {
    client.on('loading_screen', (percent, message) => {
      triggerWebhook(sessionWebhook, sessionId, 'loading_screen', { percent, message })
      triggerWebSocket(sessionId, 'loading_screen', { percent, message })
    })
  }

  if (isEventEnabled('media_uploaded')) {
    client.on('media_uploaded', (message) => {
      triggerWebhook(sessionWebhook, sessionId, 'media_uploaded', { message })
      triggerWebSocket(sessionId, 'media_uploaded', { message })
    })
  }

  client.on('message', async (message) => {
    if (isEventEnabled('message')) {
      triggerWebhook(sessionWebhook, sessionId, 'message', { message })
      triggerWebSocket(sessionId, 'message', { message })
      if (message.hasMedia && message._data?.size < maxAttachmentSize) {
      // custom service event
        if (isEventEnabled('media')) {
          message.downloadMedia().then(messageMedia => {
            triggerWebhook(sessionWebhook, sessionId, 'media', { messageMedia, message })
            triggerWebSocket(sessionId, 'media', { messageMedia, message })
          }).catch(error => {
            logger.error({ sessionId, err: error }, 'Failed to download media')
          })
        }
      }
    }
    if (setMessagesAsSeen) {
      // small delay to ensure the message is processed before sending seen status
      await sleep(1000)
      sendMessageSeenStatus(message)
    }
  })

  if (isEventEnabled('message_ack')) {
    client.on('message_ack', (message, ack) => {
      triggerWebhook(sessionWebhook, sessionId, 'message_ack', { message, ack })
      triggerWebSocket(sessionId, 'message_ack', { message, ack })
    })
  }

  if (isEventEnabled('message_create') || isEventEnabled('message_sent')) {
    client.on('message_create', (message) => {
      if (isEventEnabled('message_create')) {
        triggerWebhook(sessionWebhook, sessionId, 'message_create', { message })
        triggerWebSocket(sessionId, 'message_create', { message })
      }
      if (isEventEnabled('message_sent') && message.fromMe) {
        triggerWebhook(sessionWebhook, sessionId, 'message_sent', { message })
        triggerWebSocket(sessionId, 'message_sent', { message })
      }
    })
  }

  if (isEventEnabled('message_reaction')) {
    client.on('message_reaction', (reaction) => {
      triggerWebhook(sessionWebhook, sessionId, 'message_reaction', { reaction })
      triggerWebSocket(sessionId, 'message_reaction', { reaction })
    })
  }

  if (isEventEnabled('message_edit')) {
    client.on('message_edit', (message, newBody, prevBody) => {
      triggerWebhook(sessionWebhook, sessionId, 'message_edit', { message, newBody, prevBody })
      triggerWebSocket(sessionId, 'message_edit', { message, newBody, prevBody })
    })
  }

  if (isEventEnabled('message_ciphertext')) {
    client.on('message_ciphertext', (message) => {
      triggerWebhook(sessionWebhook, sessionId, 'message_ciphertext', { message })
      triggerWebSocket(sessionId, 'message_ciphertext', { message })
    })
  }

  if (isEventEnabled('message_revoke_everyone')) {
    client.on('message_revoke_everyone', (message) => {
      triggerWebhook(sessionWebhook, sessionId, 'message_revoke_everyone', { message })
      triggerWebSocket(sessionId, 'message_revoke_everyone', { message })
    })
  }

  if (isEventEnabled('message_revoke_me')) {
    client.on('message_revoke_me', (message, revokedMsg) => {
      triggerWebhook(sessionWebhook, sessionId, 'message_revoke_me', { message, revokedMsg })
      triggerWebSocket(sessionId, 'message_revoke_me', { message, revokedMsg })
    })
  }

  client.on('qr', (qr) => {
    // inject qr code into session
    client.qr = qr
    if (isEventEnabled('qr')) {
      triggerWebhook(sessionWebhook, sessionId, 'qr', { qr })
      triggerWebSocket(sessionId, 'qr', { qr })
    }
  })

  if (isEventEnabled('ready')) {
    client.on('ready', () => {
      triggerWebhook(sessionWebhook, sessionId, 'ready')
      triggerWebSocket(sessionId, 'ready')
    })
  }

  if (isEventEnabled('contact_changed')) {
    client.on('contact_changed', (message, oldId, newId, isContact) => {
      triggerWebhook(sessionWebhook, sessionId, 'contact_changed', { message, oldId, newId, isContact })
      triggerWebSocket(sessionId, 'contact_changed', { message, oldId, newId, isContact })
    })
  }

  if (isEventEnabled('chat_removed')) {
    client.on('chat_removed', (chat) => {
      triggerWebhook(sessionWebhook, sessionId, 'chat_removed', { chat })
      triggerWebSocket(sessionId, 'chat_removed', { chat })
    })
  }

  if (isEventEnabled('chat_archived')) {
    client.on('chat_archived', (chat, currState, prevState) => {
      triggerWebhook(sessionWebhook, sessionId, 'chat_archived', { chat, currState, prevState })
      triggerWebSocket(sessionId, 'chat_archived', { chat, currState, prevState })
    })
  }

  if (isEventEnabled('unread_count')) {
    client.on('unread_count', (chat) => {
      triggerWebhook(sessionWebhook, sessionId, 'unread_count', { chat })
      triggerWebSocket(sessionId, 'unread_count', { chat })
    })
  }

  if (isEventEnabled('vote_update')) {
    client.on('vote_update', (vote) => {
      triggerWebhook(sessionWebhook, sessionId, 'vote_update', { vote })
      triggerWebSocket(sessionId, 'vote_update', { vote })
    })
  }

  if (isEventEnabled('code')) {
    client.on('code', (code) => {
      triggerWebhook(sessionWebhook, sessionId, 'code', { code })
      triggerWebSocket(sessionId, 'code', { code })
    })
  }
}

// Function to delete client session folder
const deleteSessionFolder = async (sessionId) => {
  try {
    const targetDirPath = path.join(sessionFolderPath, `session-${sessionId}`)
    const resolvedTargetDirPath = await fs.promises.realpath(targetDirPath)
    const resolvedSessionPath = await fs.promises.realpath(sessionFolderPath)

    // Ensure the target directory path ends with a path separator
    const safeSessionPath = `${resolvedSessionPath}${path.sep}`

    // Validate the resolved target directory path is a subdirectory of the session folder path
    if (!resolvedTargetDirPath.startsWith(safeSessionPath)) {
      throw new Error('Invalid path: Directory traversal detected')
    }
    await fs.promises.rm(resolvedTargetDirPath, { recursive: true, force: true })
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Folder deletion error')
    throw error
  }
}

// Function to reload client session without removing browser cache
const reloadSession = async (sessionId) => {
  try {
    const client = sessions.get(sessionId)
    if (!client) {
      return
    }
    client.pupPage?.removeAllListeners('close')
    client.pupPage?.removeAllListeners('error')
    try {
      const pages = await client.pupBrowser.pages()
      await Promise.all(pages.map((page) => page.close()))
      await Promise.race([
        client.pupBrowser.close(),
        new Promise(resolve => setTimeout(resolve, 5000))
      ])
    } catch (e) {
      const childProcess = client.pupBrowser.process()
      if (childProcess) {
        childProcess.kill(9)
      }
    }
    sessions.delete(sessionId)
    await setupSession(sessionId)
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to reload session')
    throw error
  }
}

const destroySession = async (sessionId) => {
  try {
    const client = sessions.get(sessionId)
    if (!client) {
      return
    }
    client.pupPage?.removeAllListeners('close')
    client.pupPage?.removeAllListeners('error')
    try {
      await terminateWebSocketServer(sessionId)
    } catch (error) {
      logger.error({ sessionId, err: error }, 'Failed to terminate WebSocket server')
    }
    await client.destroy()
    // Wait 10 secs for client.pupBrowser to be disconnected
    let maxDelay = 0
    while (client.pupBrowser?.isConnected() && (maxDelay < 10)) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      maxDelay++
    }
    sessions.delete(sessionId)
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to stop session')
    throw error
  }
}

const deleteSession = async (sessionId, validation) => {
  const client = sessions.get(sessionId)
  if (!client) {
    // No live client, but a stale profile folder may still be on disk. Leaving it
    // there poisons every later session reusing this sessionId.
    if (fs.existsSync(path.join(sessionFolderPath, `session-${sessionId}`))) {
      logger.info({ sessionId }, 'Removing stale session folder with no active client')
      await deleteSessionFolder(sessionId)
    }
    return
  }
  client.pupPage?.removeAllListeners('close')
  client.pupPage?.removeAllListeners('error')
  await terminateWebSocketServer(sessionId).catch((err) => {
    logger.error({ sessionId, err }, 'Failed to terminate WebSocket server')
  })

  if (validation.success) {
    // Best effort only. logout() unlinks the device on WhatsApp's side, but it throws
    // when the page is already gone, and it throws *before* closing the browser, so it
    // must never decide whether the rest of the cleanup runs.
    logger.info({ sessionId }, 'Logging out session')
    await client.logout().catch((err) => {
      logger.warn({ sessionId, err }, 'Logout failed, destroying client anyway')
    })
  }

  // Always destroy. This closes the browser in every state, including the ones
  // validateSession reports as 'browser tab closed' or 'session closed', which
  // previously fell through and left an orphan browser holding the profile.
  await client.destroy().catch((err) => {
    logger.error({ sessionId, err }, 'Failed to destroy client')
  })

  // Wait for the browser to actually disconnect before removing the profile folder
  let maxDelay = 0
  while (client.pupBrowser?.isConnected?.() && (maxDelay < 10)) {
    await sleep(1000)
    maxDelay++
  }

  sessions.delete(sessionId)
  await deleteSessionFolder(sessionId)
}

// Function to handle session flush
const flushSessions = async (deleteOnlyInactive) => {
  try {
    // Read the contents of the sessions folder
    const files = await fs.promises.readdir(sessionFolderPath)
    // Iterate through the files in the parent folder
    for (const file of files) {
      // Use regular expression to extract the string from the folder name
      const match = file.match(/^session-(.+)$/)
      if (match) {
        const sessionId = match[1]
        const validation = await validateSession(sessionId)
        if (!deleteOnlyInactive || !validation.success) {
          await deleteSession(sessionId, validation)
        }
      }
    }
  } catch (error) {
    logger.error(error, 'Failed to flush sessions')
    throw error
  }
}

module.exports = {
  sessions,
  setupSession,
  restoreSessions,
  validateSession,
  deleteSession,
  reloadSession,
  flushSessions,
  destroySession
}
