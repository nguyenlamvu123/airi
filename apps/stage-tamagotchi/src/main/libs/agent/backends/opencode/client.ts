import type { OpencodeStreamEvent } from './events'

/**
 * Permission ruleset entry. `permission` and `pattern` are opencode-internal
 * tool/permission names; `*`/`*` matches every request.
 */
export interface OpencodePermissionRule {
  permission: string
  pattern: string
  action: 'allow' | 'deny' | 'ask'
}

/** The response body of a completed `POST /session/{id}/message`. */
export interface OpencodeMessageResult {
  info: { id?: string, role?: string, modelID?: string, finish?: string, error?: unknown }
  parts: Array<{ type?: string, text?: string }>
}

export interface OpencodeClient {
  listSessions: () => Promise<Array<{ id: string }>>
  createSession: (options?: { title?: string, permission?: OpencodePermissionRule[] }) => Promise<{ id: string }>
  /** Sends a user prompt and resolves once the whole assistant turn completes. */
  prompt: (sessionID: string, text: string) => Promise<OpencodeMessageResult>
  /** Streams events from `GET /event` until the signal aborts. */
  subscribeEvents: (signal: AbortSignal) => AsyncGenerator<OpencodeStreamEvent>
}

async function assertOk(response: Response, context: string): Promise<void> {
  if (response.ok)
    return
  const body = await response.text().catch(() => '')
  throw new Error(`${context} failed with status ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`)
}

/**
 * Thin HTTP client over a running `opencode serve` instance.
 *
 * Only the endpoints AIRI uses are wrapped: list/create sessions, send one
 * prompt, and subscribe to the global event stream. All paths are relative to
 * the server `baseUrl` (e.g. `http://127.0.0.1:4097`).
 */
export function createOpencodeClient(baseUrl: string): OpencodeClient {
  const root = baseUrl.replace(/\/+$/, '')

  return {
    async listSessions() {
      const response = await fetch(`${root}/session`)
      await assertOk(response, 'opencode session.list')
      const sessions = await response.json() as Array<{ id: string }>
      return sessions
    },

    async createSession(options) {
      const response = await fetch(`${root}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: options?.title,
          permission: options?.permission,
        }),
      })
      await assertOk(response, 'opencode session.create')
      const session = await response.json() as { id: string }
      return { id: session.id }
    },

    async prompt(sessionID, text) {
      const response = await fetch(`${root}/session/${sessionID}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text }] }),
      })
      await assertOk(response, 'opencode session.message')
      return await response.json() as OpencodeMessageResult
    },

    async* subscribeEvents(signal) {
      const response = await fetch(`${root}/event`, { signal })
      await assertOk(response, 'opencode event.subscribe')
      if (!response.body)
        throw new Error('opencode event.subscribe returned no body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (!signal.aborted) {
          const { value, done } = await reader.read()
          if (done)
            break
          buffer += decoder.decode(value, { stream: true })

          // SSE frames are newline-delimited; keep the trailing partial line
          // in the buffer until its terminating newline arrives.
          let newlineIndex = buffer.indexOf('\n')
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trimEnd()
            buffer = buffer.slice(newlineIndex + 1)
            newlineIndex = buffer.indexOf('\n')

            if (!line.startsWith('data:'))
              continue
            const payload = line.slice(5).trim()
            if (!payload)
              continue
            try {
              yield JSON.parse(payload) as OpencodeStreamEvent
            }
            catch {
              // A malformed frame should not tear down the whole stream.
            }
          }
        }
      }
      finally {
        reader.releaseLock()
        await response.body.cancel().catch(() => {})
      }
    },
  }
}
