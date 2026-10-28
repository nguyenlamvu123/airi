import type { AgentPromptResult, AgentTransport } from '../../types'
import type { OpencodeClient, OpencodePermissionRule } from './client'

import { isDeepStrictEqual } from 'node:util'

import { createOpencodeClient } from './client'
import { createOpencodeTextTracker } from './events'

/**
 * Read-only ruleset attached to every session AIRI creates.
 *
 * AIRI policy: an agent backend may read project files to answer, and nothing
 * else. No shell, no edits, no web access, no subagents, no paths outside the
 * project. opencode evaluates rules last-match-wins, so the catch-all deny comes
 * first and the read-only tools are re-allowed after it. Every rule is `allow`
 * or `deny`, never `ask`: AIRI has no UI to answer a prompt, so `ask` would hang
 * the turn.
 *
 * Session rules are appended after agent/config rules, so they override the
 * user's opencode config for this session. The same policy is also passed as
 * inline config when the server starts (see `./server`).
 */
export const READ_ONLY_PERMISSIONS: OpencodePermissionRule[] = [
  { permission: '*', pattern: '*', action: 'deny' },
  { permission: 'read', pattern: '*', action: 'allow' },
  // Secrets must not reach the model provider.
  { permission: 'read', pattern: '*.env', action: 'deny' },
  { permission: 'read', pattern: '*.env.*', action: 'deny' },
  { permission: 'list', pattern: '*', action: 'allow' },
  { permission: 'glob', pattern: '*', action: 'allow' },
  { permission: 'grep', pattern: '*', action: 'allow' },
]

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
      // the conversation would silently restart from scratch. A session whose
      // ruleset is not exactly the current read-only policy (e.g. one created
      // when AIRI still granted every permission) is never resumed: its stored
      // rules would override the policy for the rest of that conversation.
      if (options?.resumeSessionID) {
        try {
          const sessions = await client.listSessions()
          const resumable = sessions.find(session => session.id === options.resumeSessionID)
          if (resumable && isDeepStrictEqual(resumable.permission, READ_ONLY_PERMISSIONS))
            return { id: resumable.id }
        }
        catch {
          // Listing failed (e.g. server cold start): fall through to create.
        }
      }

      const created = await client.createSession({ title: options?.title ?? 'AIRI', permission: READ_ONLY_PERMISSIONS })
      return { id: created.id }
    },

    async prompt(sessionID, text, onText, promptOptions): Promise<AgentPromptResult> {
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
        result = await client.prompt(sessionID, text, promptOptions?.systemPrompt)
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
