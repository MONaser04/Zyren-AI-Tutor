import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { AccessToken } from 'livekit-server-sdk'
import fs from 'node:fs'
import path from 'node:path'
import {
  deleteGeminiApiKey,
  deleteSavedSessionFromDisk,
  listSavedSessionsFromDisk,
  loadSavedSessionFromDisk,
  resolveGeminiApiKey,
  resolveMediaFileOnDisk,
  saveMediaBinaryToDisk,
  saveSessionSnapshotToDisk,
  saveVerifiedGeminiApiKey,
  toggleSessionPinOnDisk,
  validateGeminiApiKeyLive,
} from './src/server/zyrenBackendVault.ts'

const voiceAudioCache = new Map<string, string>()

function pcmToWav(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = pcmBuffer.length
  const header = Buffer.alloc(44)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcmBuffer])
}

function readJsonBody(req: any, maxBytes = 50 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buf.length
      if (total > maxBytes) {
        reject(new Error('Request payload exceeds maximum size limit.'))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8').trim()
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function readRawBody(req: any, maxBytes = 512 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buf.length
      if (total > maxBytes) {
        reject(new Error('Media payload exceeds maximum allowed size (512 MB).'))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

function sendJson(res: any, statusCode: number, data: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function createZyrenApiMiddleware() {
  return async (req: any, res: any, next: any) => {
    const reqUrl: string = req.url || ''
    if (!reqUrl.startsWith('/api/')) {
      next()
      return
    }

    const parsedUrl = new URL(reqUrl, 'http://localhost')
    const pathname = parsedUrl.pathname
    const method = (req.method || 'GET').toUpperCase()

    // 1. Agent Readiness Check
    if (pathname === '/api/agent-status' && method === 'GET') {
      const readyFile = path.resolve(process.cwd(), '.agent_ready')
      const isReady = fs.existsSync(readyFile)
      sendJson(res, 200, { ready: isReady })
      return
    }

    // 2. Gemini API Key Management & Mandatory Live Verification
    if (pathname === '/api/gemini-key/status' && method === 'GET') {
      const env = loadEnv('', process.cwd(), '')
      const resolved = resolveGeminiApiKey({ envVars: env })
      sendJson(res, 200, {
        configured: resolved.configured,
        source: resolved.source,
        maskedKey: resolved.maskedKey,
        updatedAt: resolved.updatedAt,
        verifiedAt: resolved.verifiedAt,
      })
      return
    }

    if (pathname === '/api/gemini-key/test' && method === 'POST') {
      try {
        const body = await readJsonBody(req, 64 * 1024)
        let candidateKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
        if (!candidateKey || candidateKey === '__CURRENT__') {
          const env = loadEnv('', process.cwd(), '')
          const current = resolveGeminiApiKey({ envVars: env })
          if (!current.configured || !current.apiKey) {
            sendJson(res, 400, {
              valid: false,
              latencyMs: 0,
              errorCode: 'NO_CONFIGURED_KEY',
              error: 'No Gemini API key is currently configured to test.',
            })
            return
          }
          candidateKey = current.apiKey
        }

        const result = await validateGeminiApiKeyLive(candidateKey)
        sendJson(res, result.valid ? 200 : 400, result)
      } catch (err: any) {
        sendJson(res, 400, {
          valid: false,
          latencyMs: 0,
          errorCode: 'BAD_REQUEST',
          error: err?.message || 'Invalid test request.',
        })
      }
      return
    }

    if (pathname === '/api/gemini-key' && method === 'POST') {
      try {
        const body = await readJsonBody(req, 64 * 1024)
        const rawKey = typeof body?.apiKey === 'string' ? body.apiKey : ''
        // Automatically enforces live Google Gemini verification BEFORE persisting
        const saveResult = await saveVerifiedGeminiApiKey(rawKey)
        if (!saveResult.saved) {
          sendJson(res, 400, saveResult)
          return
        }
        voiceAudioCache.clear()
        sendJson(res, 200, saveResult)
      } catch (err: any) {
        sendJson(res, 500, {
          saved: false,
          valid: false,
          error: err?.message || 'Failed to verify and save API key.',
        })
      }
      return
    }

    if (pathname === '/api/gemini-key' && method === 'DELETE') {
      try {
        const deleted = deleteGeminiApiKey()
        voiceAudioCache.clear()
        sendJson(res, 200, deleted)
      } catch (err: any) {
        sendJson(res, 500, { deleted: false, error: err?.message || 'Failed to delete API key.' })
      }
      return
    }

    // 3. Enterprise Session Auto-Save Disk Vault (AppData/ZYREN_AI_Tutor/sessions)
    if (pathname === '/api/sessions' && method === 'GET') {
      try {
        const index = listSavedSessionsFromDisk()
        sendJson(res, 200, index)
      } catch (err: any) {
        sendJson(res, 500, { activeSessionId: null, sessions: [], error: err?.message })
      }
      return
    }

    if (pathname === '/api/sessions/latest' && method === 'GET') {
      try {
        const session = loadSavedSessionFromDisk('latest')
        sendJson(res, 200, { session })
      } catch (err: any) {
        sendJson(res, 500, { session: null, error: err?.message })
      }
      return
    }

    if (pathname === '/api/sessions/item' && method === 'GET') {
      try {
        const id = parsedUrl.searchParams.get('id') || 'latest'
        const session = loadSavedSessionFromDisk(id)
        sendJson(res, session ? 200 : 404, { session })
      } catch (err: any) {
        sendJson(res, 500, { session: null, error: err?.message })
      }
      return
    }

    if (pathname === '/api/sessions/autosave' && method === 'POST') {
      try {
        const body = await readJsonBody(req, 50 * 1024 * 1024)
        const result = saveSessionSnapshotToDisk(body, {
          setActive: body?.setActive !== false,
        })
        sendJson(res, 200, result)
      } catch (err: any) {
        sendJson(res, 400, { ok: false, error: err?.message || 'Failed to auto-save session.' })
      }
      return
    }

    if (pathname === '/api/sessions/pin' && method === 'POST') {
      try {
        const body = await readJsonBody(req, 1024 * 1024)
        const id = String(body?.id || '')
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'Missing session id.' })
          return
        }
        const result = toggleSessionPinOnDisk(id, body?.isPinned)
        sendJson(res, result.ok ? 200 : 404, result)
      } catch (err: any) {
        sendJson(res, 500, { ok: false, error: err?.message || 'Failed to toggle pin state.' })
      }
      return
    }

    if (pathname === '/api/sessions/item' && method === 'DELETE') {
      try {
        const id = parsedUrl.searchParams.get('id') || ''
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'Missing session id.' })
          return
        }
        const nextIndex = deleteSavedSessionFromDisk(id)
        sendJson(res, 200, { ok: true, ...nextIndex })
      } catch (err: any) {
        sendJson(res, 500, { ok: false, error: err?.message || 'Failed to delete session.' })
      }
      return
    }

    // 3.5 Binary Slide Media Vault (Images & Videos with HTTP 206 Range Streaming)
    if (pathname === '/api/media/upload' && method === 'POST') {
      try {
        const contentType = String(req.headers['content-type'] || '').toLowerCase()
        if (contentType.includes('application/json')) {
          const body = await readJsonBody(req, 150 * 1024 * 1024)
          const dataUrl = String(body?.dataUrl || '')
          const fileName = String(body?.fileName || 'slide-media')
          const rawMime = String(body?.mimeType || '')
          const commaIdx = dataUrl.indexOf(',')
          const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl
          const headerMimeMatch = commaIdx >= 0 ? dataUrl.slice(0, commaIdx).match(/data:([^;]+)/i) : null
          const mimeType = rawMime || headerMimeMatch?.[1] || 'application/octet-stream'
          const buffer = Buffer.from(b64, 'base64')
          const saved = saveMediaBinaryToDisk({
            buffer,
            mimeType,
            originalName: fileName,
            mediaId: body?.mediaId,
          })
          sendJson(res, 200, { ok: true, ...saved })
          return
        }

        const rawBuf = await readRawBody(req, 512 * 1024 * 1024)
        const headerName = req.headers['x-file-name']
          ? decodeURIComponent(String(req.headers['x-file-name']))
          : 'slide-media'
        const headerMime = String(req.headers['x-mime-type'] || contentType || 'application/octet-stream')
        const headerMediaId = req.headers['x-media-id'] ? String(req.headers['x-media-id']) : undefined
        const saved = saveMediaBinaryToDisk({
          buffer: rawBuf,
          mimeType: headerMime,
          originalName: headerName,
          mediaId: headerMediaId,
        })
        sendJson(res, 200, { ok: true, ...saved })
      } catch (err: any) {
        sendJson(res, 400, { ok: false, error: err?.message || 'Failed to store slide media.' })
      }
      return
    }

    if (pathname.startsWith('/api/media/') && (method === 'GET' || method === 'HEAD')) {
      const token = pathname.slice('/api/media/'.length)
      const resolved = resolveMediaFileOnDisk(token)
      if (!resolved) {
        sendJson(res, 404, { error: 'Media asset not found.' })
        return
      }

      const total = resolved.sizeBytes
      const rangeHeader = req.headers.range as string | undefined
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.setHeader('Content-Type', resolved.mimeType)

      if (rangeHeader && /^bytes=/i.test(rangeHeader) && total > 0) {
        const parts = rangeHeader.replace(/bytes=/i, '').split('-')
        const start = Math.max(0, parseInt(parts[0], 10) || 0)
        const requestedEnd = parts[1] ? parseInt(parts[1], 10) : total - 1
        const end = Math.min(total - 1, Number.isNaN(requestedEnd) ? total - 1 : requestedEnd)

        if (start >= total || start > end) {
          res.statusCode = 416
          res.setHeader('Content-Range', `bytes */${total}`)
          res.end()
          return
        }

        const chunkSize = end - start + 1
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
        res.setHeader('Content-Length', chunkSize)
        if (method === 'HEAD') {
          res.end()
          return
        }
        fs.createReadStream(resolved.filePath, { start, end }).pipe(res)
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Length', total)
      if (method === 'HEAD') {
        res.end()
        return
      }
      fs.createReadStream(resolved.filePath).pipe(res)
      return
    }

    // 4. Voice Preview Endpoint
    if (pathname === '/api/voice-preview' && method === 'GET') {
      const env = loadEnv('', process.cwd(), '')
      const googleApiKey = resolveGeminiApiKey({ envVars: env }).apiKey
      const voice = parsedUrl.searchParams.get('voice') || 'Aoede'

      if (voiceAudioCache.has(voice)) {
        sendJson(res, 200, { audioUrl: voiceAudioCache.get(voice), voice })
        return
      }

      if (!googleApiKey) {
        sendJson(res, 400, { error: 'Gemini API key is not configured yet. Please add your key in API Key Settings.' })
        return
      }

      try {
        const promptText = `Hello! I am ${voice}, your AI Tutor. I am excited to explore any subject, solve problems, and learn together with you.`
        const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent`

        const response = await fetch(ttsUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': googleApiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voice,
                  },
                },
              },
            },
          }),
        })

        if (!response.ok) {
          const errBody = await response.text()
          throw new Error(`Gemini TTS API error ${response.status}: ${errBody}`)
        }

        const data: any = await response.json()
        const part = data.candidates?.[0]?.content?.parts?.[0]
        const inlineData = part?.inlineData

        if (!inlineData || !inlineData.data) {
          throw new Error('No audio inlineData returned from Gemini TTS')
        }

        const mimeType: string = inlineData.mimeType || 'audio/pcm;rate=24000'
        let sampleRate = 24000
        const rateMatch = mimeType.match(/rate=(\d+)/)
        if (rateMatch) {
          sampleRate = parseInt(rateMatch[1], 10)
        }

        const rawBuffer = Buffer.from(inlineData.data, 'base64')
        let wavBuffer: Buffer

        if (rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF') {
          wavBuffer = rawBuffer
        } else {
          wavBuffer = pcmToWav(rawBuffer, sampleRate, 1, 16)
        }

        const dataUri = `data:audio/wav;base64,${wavBuffer.toString('base64')}`
        voiceAudioCache.set(voice, dataUri)

        sendJson(res, 200, { audioUrl: dataUri, voice })
      } catch (e: any) {
        sendJson(res, 500, { error: e.message })
      }
      return
    }

    // 5. LiveKit Room Token Endpoint
    if (pathname === '/api/token') {
      try {
        const env = loadEnv('', process.cwd(), '')
        const apiKey = env.LIVEKIT_API_KEY || 'devkey'
        const apiSecret = env.LIVEKIT_API_SECRET || 'secret'

        const voice = parsedUrl.searchParams.get('voice') || 'Aoede'
        const style = parsedUrl.searchParams.get('style') || 'mixed'
        const model = parsedUrl.searchParams.get('model') || 'gemini-3.8-live-extended-thinking'
        const thinkingLevel = parsedUrl.searchParams.get('thinkingLevel') || 'high'
        const verbosity = parsedUrl.searchParams.get('verbosity') || 'balanced'
        const vocalTone = parsedUrl.searchParams.get('vocalTone') || 'natural'
        const learnerProfile = parsedUrl.searchParams.get('learnerProfile') || 'general'
        const learnerName = parsedUrl.searchParams.get('learnerName') || ''
        const tutorName = (parsedUrl.searchParams.get('tutorName') || 'Zyren').trim() || 'Zyren'
        const rawLangConfig = parsedUrl.searchParams.get('languageConfig')
        let languageConfig: any = undefined
        if (rawLangConfig) {
          try {
            languageConfig = JSON.parse(rawLangConfig)
          } catch {
            // ignore malformed config
          }
        }
        const metadataObj: Record<string, any> = { voice, style, model, thinkingLevel, verbosity, vocalTone, learnerProfile, tutorName }
        if (learnerName) {
          metadataObj.learnerName = learnerName
        }
        if (languageConfig) {
          metadataObj.languageConfig = languageConfig
        }

        const at = new AccessToken(apiKey, apiSecret, {
          identity: `user_${Math.floor(Math.random() * 10000)}`,
          name: learnerName || 'Student',
          metadata: JSON.stringify(metadataObj),
        })
        const roomId = `tutor-room-${Math.floor(Math.random() * 1000000)}`
        at.addGrant({ roomJoin: true, room: roomId, canUpdateOwnMetadata: true })

        const hostHeader = req.headers.host || 'localhost:5173'
        const hostname = hostHeader.split(':')[0]
        const rawLivekitUrl = env.LIVEKIT_URL || 'ws://127.0.0.1:7880'
        const resolvedLivekitUrl = rawLivekitUrl.replace('127.0.0.1', hostname).replace('localhost', hostname)

        sendJson(res, 200, {
          token: await at.toJwt(),
          url: resolvedLivekitUrl,
          voice,
        })
      } catch (e: any) {
        sendJson(res, 500, { error: e.message })
      }
      return
    }

    next()
  }
}

const livekitTokenPlugin = () => {
  return {
    name: 'livekit-token',
    configureServer(server: any) {
      server.middlewares.use(createZyrenApiMiddleware())
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(createZyrenApiMiddleware())
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), livekitTokenPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: ['**/livekit_server/**', '**/livekit.zip'],
    },
  },
})
