import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AgentTransport } from './types'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { errorMessageFrom } from '@moeru/std'

import { AGENT_PROXY_MODEL_ID } from '../../../shared/eventa'

/** Model id AIRI sees for every agent backend; the real model is backend-owned. */
export const PROXY_MODEL_ID = AGENT_PROXY_MODEL_ID

export interface OpenAIChatMessage {
  role?: string
  content?: unknown
}

export interface OpenAIChatRequest {
  model?: string
  messages?: OpenAIChatMessage[]
  stream?: boolean
}

export interface AgentProxyOptions {
  transport: AgentTransport
  /** Session to reuse; backends that mint ids lazily update it after a turn. */
  sessionID?: string
  host?: string
  /** TCP port; `0` (default) lets the OS pick a free one. */
  port?: number
}

export interface AgentProxy {
  /** OpenAI-compatible base URL including the `/v1` suffix. */
  baseUrl: string
  /** Latest session id, which may differ from the initial one after a turn. */
  getSessionID: () => string | undefined
  close: () => Promise<void>
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': 'http://localhost:5273',
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

/** Returns the text of the last user message, which is what the agent should answer. */
export function extractLastUserPrompt(messages: OpenAIChatMessage[] | undefined): string {
  if (!messages)
    return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user')
      return openAIContentToText(messages[i].content).trim()
  }
  return ''
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
 * Starts an OpenAI-compatible HTTP server in front of an {@link AgentTransport}.
 *
 * Exposes only what xsAI's OpenAI provider needs: `GET /v1/models` and
 * `POST /v1/chat/completions` (streaming and non-streaming). The transport owns
 * the conversation, so only the latest user message is forwarded.
 */
export async function startAgentProxy(options: AgentProxyOptions): Promise<AgentProxy> {
  const host = options.host ?? '127.0.0.1'
  let sessionID = options.sessionID

  function json(response: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body)
    response.writeHead(status, { 'content-type': 'application/json', ...corsHeaders() })
    response.end(text)
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

    const wantsStream = body.stream === true
    const created = Math.floor(Date.now() / 1000)
    const id = `chatcmpl-${created}-${Math.random().toString(36).slice(2, 8)}`
    let modelEcho = PROXY_MODEL_ID
    let streamedAny = false

    // Open the SSE response up-front for streaming clients; the transport then
    // pushes deltas as it parses them.
    if (wantsStream) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        ...corsHeaders(),
      })
      response.write(': agent bridge\n\n')
      writeSseChunk(response, {
        id,
        object: 'chat.completion.chunk',
        created,
        model: modelEcho,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      })
    }

    function onText(delta: string): void {
      if (!delta)
        return
      streamedAny = true
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

    if (!sessionID)
      sessionID = (await options.transport.createSession({ title: 'AIRI' })).id

    let result
    try {
      result = await options.transport.prompt(sessionID, promptText, onText)
    }
    catch (error) {
      const message = `agent prompt failed: ${errorMessageFrom(error) ?? 'Unknown error'}`
      if (wantsStream) {
        writeSseChunk(response, { error: { message } })
        response.end('data: [DONE]\n\n')
      }
      else {
        json(response, 502, { error: { message } })
      }
      return
    }

    // A backend that mints ids lazily (CLI agents) reports the real session here.
    sessionID = result.sessionID || sessionID
    if (result.modelID)
      modelEcho = result.modelID

    if (wantsStream) {
      // Reconcile: a backend without incremental output produced no deltas, so
      // send the whole answer once. Never send nothing.
      if (!streamedAny && result.text && !response.writableEnded)
        writeSseChunk(response, { id, object: 'chat.completion.chunk', created, model: modelEcho, choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }] })

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
      choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }],
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
      json(response, 200, {
        object: 'list',
        data: [{ id: PROXY_MODEL_ID, object: 'model', created: 0, owned_by: 'agent' }],
      })
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
    getSessionID: () => sessionID,
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
