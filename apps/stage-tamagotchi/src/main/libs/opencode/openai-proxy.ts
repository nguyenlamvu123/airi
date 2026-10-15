import type { IncomingMessage, ServerResponse } from 'node:http'

import type { OpencodeClient, OpencodeMessageResult } from './client'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { createOpencodeClient } from './client'
import { createAssistantTextTracker } from './stream-state'

/** Model id AIRI sees for the opencode backend; the real model is chosen by opencode itself. */
const PROXY_MODEL_ID = 'opencode'

/**
 * Allows every opencode tool/permission request.
 *
 * AIRI chat has no UI to answer opencode's interactive permission prompts, so an
 * unanswered prompt would hang the turn forever. The user explicitly opted into
 * running opencode in this repository as the chat backend, so blanket-allow is
 * the intended default. Revisit if a permission-approval surface is added.
 */
const ALLOW_ALL_PERMISSIONS = [{ permission: '*', pattern: '*', action: 'allow' as const }]

export interface OpenAIChatMessage {
  role?: string
  content?: unknown
}

export interface OpenAIChatRequest {
  model?: string
  messages?: OpenAIChatMessage[]
  stream?: boolean
}

export interface OpencodeProxyOptions {
  opencodeBaseUrl: string
  host?: string
  /** TCP port; `0` (default) lets the OS pick a free one. */
  port?: number
  title?: string
  /** Override the client (tests). */
  client?: OpencodeClient
}

export interface OpencodeProxy {
  /** OpenAI-compatible base URL including the `/v1` suffix. */
  baseUrl: string
  close: () => Promise<void>
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': '*',
  }
}

/**
 * Flattens an OpenAI message `content` (string, or an array of `{ type: "text" }`
 * parts) into plain text. Returns an empty string for shapes we do not model.
 */
export function openAIContentToText(content: unknown): string {
  if (typeof content === 'string')
    return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && (part as { type?: string }).type === 'text')
          return String((part as { text?: unknown }).text ?? '')
        return ''
      })
      .join('')
  }
  return ''
}

/** Returns the text of the last user message, which is what opencode should answer. */
export function extractLastUserPrompt(messages: OpenAIChatMessage[] | undefined): string {
  if (!messages)
    return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user')
      return openAIContentToText(messages[i].content).trim()
  }
  return ''
}

/** Concatenates the assistant text parts of a completed opencode message. */
export function extractAssistantText(result: OpencodeMessageResult): string {
  return (result.parts ?? [])
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join('')
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw)
        return resolve({})
      try {
        resolve(JSON.parse(raw))
      }
      catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function writeSseChunk(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

/**
 * Starts an OpenAI-compatible HTTP server that proxies chat completions to a
 * local `opencode serve` instance.
 *
 * The server exposes only the surfaces xsAI's OpenAI provider needs:
 * `GET /v1/models` and `POST /v1/chat/completions` (streaming and
 * non-streaming). One opencode session is created lazily and reused for the
 * whole lifetime of the proxy, so multi-turn chats keep context; only the latest
 * user message is forwarded because opencode owns the conversation history.
 */
export async function startOpencodeProxy(options: OpencodeProxyOptions): Promise<OpencodeProxy> {
  const host = options.host ?? '127.0.0.1'
  const client = options.client ?? createOpencodeClient(options.opencodeBaseUrl)

  let sessionPromise: Promise<string> | undefined

  function ensureSession(): Promise<string> {
    sessionPromise ??= client.createSession({ title: options.title ?? 'AIRI', permission: ALLOW_ALL_PERMISSIONS })
      .then(session => session.id)
      .catch((error) => {
        // Allow the next request to retry creating the session.
        sessionPromise = undefined
        throw error
      })
    return sessionPromise
  }

  function json(response: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body)
    response.writeHead(status, { 'content-type': 'application/json', ...corsHeaders() })
    response.end(text)
  }

  async function handleModels(response: ServerResponse): Promise<void> {
    json(response, 200, {
      object: 'list',
      data: [{ id: PROXY_MODEL_ID, object: 'model', created: 0, owned_by: 'opencode' }],
    })
  }

  async function handleChatCompletion(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: OpenAIChatRequest
    try {
      body = await readJsonBody(request) as OpenAIChatRequest
    }
    catch {
      return json(response, 400, { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } })
    }

    const promptText = extractLastUserPrompt(body.messages)
    if (!promptText)
      return json(response, 400, { error: { message: 'No user message provided', type: 'invalid_request_error' } })

    let sessionID: string
    try {
      sessionID = await ensureSession()
    }
    catch (error) {
      return json(response, 502, { error: { message: `Failed to open opencode session: ${String(error)}` } })
    }

    const tracker = createAssistantTextTracker(sessionID)
    const abort = new AbortController()
    const streamedChunks: string[] = []
    let streamedAny = false

    const wantsStream = body.stream === true
    const created = Math.floor(Date.now() / 1000)
    const id = `chatcmpl-${created}-${Math.random().toString(36).slice(2, 8)}`
    let modelEcho = PROXY_MODEL_ID

    // Only open the SSE response once we know the client asked to stream;
    // non-streaming callers get a single JSON body built from the full result.
    if (wantsStream) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        ...corsHeaders(),
      })
      response.write(': opencode bridge\n\n')
      writeSseChunk(response, {
        id,
        object: 'chat.completion.chunk',
        created,
        model: modelEcho,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      })
    }

    // Forward assistant text deltas while the prompt runs. The loop is torn down
    // by `abort` after the prompt resolves so we never leave the event stream open.
    const pump = (async () => {
      for await (const event of client.subscribeEvents(abort.signal)) {
        const delta = tracker.handle(event)
        if (delta === undefined || delta === '')
          continue
        streamedAny = true
        streamedChunks.push(delta)
        if (wantsStream && !response.writableEnded) {
          writeSseChunk(response, {
            id,
            object: 'chat.completion.chunk',
            created,
            model: modelEcho,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          })
        }
      }
    })().catch(() => {})

    let result: OpencodeMessageResult | undefined
    let failure: unknown
    try {
      result = await client.prompt(sessionID, promptText)
    }
    catch (error) {
      failure = error
    }

    // The event connection and the prompt connection are independent, so the
    // last few deltas can still be in flight when the prompt resolves. Give the
    // pump a brief, bounded window to drain before we reconcile the final text.
    if (!failure)
      await new Promise(resolve => setTimeout(resolve, 150))

    abort.abort()
    await pump

    if (failure) {
      if (wantsStream) {
        writeSseChunk(response, { error: { message: `opencode prompt failed: ${String(failure)}` } })
        response.end('data: [DONE]\n\n')
      }
      else {
        json(response, 502, { error: { message: `opencode prompt failed: ${String(failure)}` } })
      }
      return
    }

    const fullText = extractAssistantText(result!)
    if (result?.info?.modelID)
      modelEcho = result.info.modelID

    if (wantsStream) {
      // Reconcile streamed text with the authoritative result so the client
      // always receives the complete answer even if a delta was missed.
      const streamedConcat = streamedChunks.join('')
      if (!streamedAny) {
        if (fullText && !response.writableEnded)
          writeSseChunk(response, { id, object: 'chat.completion.chunk', created, model: modelEcho, choices: [{ index: 0, delta: { content: fullText }, finish_reason: null }] })
      }
      else if (fullText.startsWith(streamedConcat) && fullText.length > streamedConcat.length) {
        writeSseChunk(response, { id, object: 'chat.completion.chunk', created, model: modelEcho, choices: [{ index: 0, delta: { content: fullText.slice(streamedConcat.length) }, finish_reason: null }] })
      }

      if (!response.writableEnded) {
        writeSseChunk(response, { id, object: 'chat.completion.chunk', created, model: modelEcho, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
        response.end('data: [DONE]\n\n')
      }
      return
    }

    json(response, 200, {
      id,
      object: 'chat.completion',
      created,
      model: modelEcho,
      choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }],
    })
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}`)

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders())
      response.end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/v1/models') {
      void handleModels(response)
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      void handleChatCompletion(request, response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, { ok: true })
      return
    }

    json(response, 404, { error: { message: `Unhandled route ${request.method} ${url.pathname}`, type: 'invalid_request_error' } })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    baseUrl: `http://${host}:${port}/v1`,
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
