import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { AccessToken } from 'livekit-server-sdk'

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

const livekitTokenPlugin = () => {
  return {
    name: 'livekit-token',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url && req.url.startsWith('/api/voice-preview')) {
          const env = loadEnv('', process.cwd(), '')
          const googleApiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY
          const parsedUrl = new URL(req.url, 'http://localhost')
          const voice = parsedUrl.searchParams.get('voice') || 'Aoede'

          if (voiceAudioCache.has(voice)) {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ audioUrl: voiceAudioCache.get(voice), voice }))
            return
          }

          if (!googleApiKey) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'GEMINI_API_KEY or GOOGLE_API_KEY not found in .env' }))
            return
          }

          try {
            const promptText = `Hello! I am ${voice}, your AI Tutor. I am excited to explore any subject, solve problems, and learn together with you.`
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${googleApiKey}`

            let response = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: voice
                      }
                    }
                  }
                }
              })
            })

            if (!response.ok) {
              // Fallback to gemini-3.1-flash-tts-preview if needed
              const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${googleApiKey}`
              response = await fetch(fallbackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: promptText }] }],
                  generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                      voiceConfig: {
                        prebuiltVoiceConfig: {
                          voiceName: voice
                        }
                      }
                    }
                  }
                })
              })
            }

            if (!response.ok) {
              const errBody = await response.text()
              throw new Error(`Gemini TTS API error ${response.status}: ${errBody}`)
            }

            const data: any = await response.json()
            const part = data.candidates?.[0]?.content?.parts?.[0]
            const inlineData = part?.inlineData

            if (!inlineData || !inlineData.data) {
              throw new Error('No audio returned by Gemini API')
            }

            const rawBase64 = inlineData.data
            const mimeType = (inlineData.mimeType || 'audio/wav').toLowerCase()
            let finalAudioDataUrl = ''

            if (mimeType.includes('pcm') || mimeType.includes('l16')) {
              const pcmBuffer = Buffer.from(rawBase64, 'base64')
              const rateMatch = mimeType.match(/rate=(\d+)/)
              const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000
              const wavBuffer = pcmToWav(pcmBuffer, sampleRate, 1, 16)
              finalAudioDataUrl = `data:audio/wav;base64,${wavBuffer.toString('base64')}`
            } else {
              finalAudioDataUrl = `data:${mimeType};base64,${rawBase64}`
            }

            voiceAudioCache.set(voice, finalAudioDataUrl)

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ audioUrl: finalAudioDataUrl, voice }))
          } catch (err: any) {
            console.error('[Voice Preview] Error generating preview:', err)
            res.statusCode = 500
            res.end(JSON.stringify({ error: err.message }))
          }
        } else if (req.url && req.url.startsWith('/api/token')) {
          // Use loadEnv to reliably get the root .env vars
          const env = loadEnv('', process.cwd(), '')
          const apiKey = env.LIVEKIT_API_KEY
          const apiSecret = env.LIVEKIT_API_SECRET
          
          if (!apiKey || !apiSecret) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'LiveKit keys not found in .env' }))
            return
          }
          
          try {
            const parsedUrl = new URL(req.url, 'http://localhost')
            const voice = parsedUrl.searchParams.get('voice') || 'Aoede'
            const style = parsedUrl.searchParams.get('style') || 'mixed'
            const model = parsedUrl.searchParams.get('model') || 'gemini-3.8-live-extended-thinking'
            const thinkingLevel = parsedUrl.searchParams.get('thinkingLevel') || 'high'

            const at = new AccessToken(apiKey, apiSecret, {
              identity: `user_${Math.floor(Math.random() * 10000)}`,
              name: 'Student',
              metadata: JSON.stringify({ voice, style, model, thinkingLevel })
            })
            // Use dynamic room name to force a new Job dispatch in LiveKit when voice changes
            const roomId = `tutor-room-${Math.floor(Math.random() * 1000000)}`
            at.addGrant({ roomJoin: true, room: roomId, canUpdateOwnMetadata: true })
            
            const hostHeader = req.headers.host || 'localhost:5173'
            const hostname = hostHeader.split(':')[0]
            const rawLivekitUrl = env.LIVEKIT_URL || 'ws://127.0.0.1:7880'
            const resolvedLivekitUrl = rawLivekitUrl.replace('127.0.0.1', hostname).replace('localhost', hostname)

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ 
              token: await at.toJwt(),
              url: resolvedLivekitUrl,
              voice
            }))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        } else {
          next()
        }
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), livekitTokenPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: ['**/livekit_server/**', '**/livekit.zip']
    }
  }
})
