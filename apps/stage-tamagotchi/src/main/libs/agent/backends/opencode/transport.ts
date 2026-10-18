import type { AgentPromptResult, AgentTransport } from '../../types'
import type { OpencodeClient, OpencodePermissionRule } from './client'

import { createOpencodeClient } from './client'
import { createOpencodeTextTracker } from './events'

/**
 * Allows every opencode tool/permission request.
 *
 * AIRI chat has no UI to answer opencode's interactive permission prompts, so an
 * unanswered prompt would hang the turn forever. The user explicitly opted into
 * running opencode in this repository as the chat backend, so blanket-allow is
 * the intended default. Revisit if a permission-approval surface is added.
 */
export const ALLOW_ALL_PERMISSIONS: OpencodePermissionRule[] = [{ permission: '*', pattern: '*', action: 'allow' }]

// The prompt response and the event stream are independent connections, so the
// last deltas can still be in flight when the prompt resolves. This bounded wait
// lets the tracker drain before we fall back to the authoritative full text.
const DRAIN_GRACE_MS = 150

/**
 * Adapts a running `opencode serve` instance to the shared {@link AgentTransport}
 * interface. opencode owns the conversation history, so a session is created
 * once and reused; only the latest user message is sent per turn.
 */
export function createOpencodeTransport(baseUrl: string, client: OpencodeClient = createOpencodeClient(baseUrl)): AgentTransport {
  return {
    async createSession(options) {
      // Reuse the persisted session when the server still knows it; otherwise
      // the conversation would silently restart from scratch.
      if (options?.resumeSessionID) {
        try {
          const sessions = await client.listSessions()
          if (sessions.some(session => session.id === options.resumeSessionID))
            return { id: options.resumeSessionID }
        }
        catch {
          // Listing failed (e.g. server cold start): fall through to create.
        }
      }

      const created = await client.createSession({ title: options?.title ?? 'AIRI', permission: ALLOW_ALL_PERMISSIONS })
      return { id: created.id }
    },

    async prompt(sessionID, text, onText): Promise<AgentPromptResult> {
      const tracker = createOpencodeTextTracker(sessionID)
      const abort = new AbortController()
      const streamed: string[] = []

      const pump = (async () => {
        for await (const event of client.subscribeEvents(abort.signal)) {
          const delta = tracker.handle(event)
          if (!delta)
            continue
          streamed.push(delta)
          onText(delta)
        }
      })().catch(() => {})

      let result
      try {
        result = await client.prompt(sessionID, text)
        await new Promise(resolve => setTimeout(resolve, DRAIN_GRACE_MS))
      }
      finally {
        abort.abort()
        await pump
      }

      const fullText = (result.parts ?? [])
        .filter(part => part.type === 'text')
        .map(part => part.text ?? '')
        .join('')

      // If the stream missed the tail, top it up so streamed clients still get
      // the complete answer.
      const streamedText = streamed.join('')
      if (fullText.startsWith(streamedText) && fullText.length > streamedText.length)
        onText(fullText.slice(streamedText.length))

      return { text: fullText, sessionID, modelID: result.info?.modelID }
    },

    async close() {
      // The underlying transport is stateless HTTP; the server process is owned
      // and closed by the backend starter.
    },
  }
}
