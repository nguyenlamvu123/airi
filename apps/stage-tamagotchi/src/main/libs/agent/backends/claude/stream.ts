/**
 * One parsed update from Claude Code's `--output-format stream-json` NDJSON.
 *
 * Field names follow Claude Code's documented stream shape; see the fixtures in
 * `stream.test.ts` for the exact lines this parser is expected to handle.
 */
export interface ClaudeStreamUpdate {
  /** Session id announced by the `system/init` line or echoed on every line. */
  sessionID?: string
  /** Model the session is using, from `system/init` or `message_start`. */
  modelID?: string
  /** Incremental assistant text from a `content_block_delta`. */
  delta?: string
  /** Complete answer text from the terminal `result` line. */
  resultText?: string
  /** True when the turn ended in an error (`result` with `is_error`). */
  isError?: boolean
  /** Human-readable error text when `isError` is set. */
  errorText?: string
}

interface ClaudeRawLine {
  type?: string
  subtype?: string
  session_id?: string
  sessionId?: string
  model?: string
  is_error?: boolean
  error?: boolean
  result?: string
  text?: string
  message?: {
    model?: string
    content?: Array<{ type?: string, text?: string, thinking?: string }> | string
  }
  event?: {
    type?: string
    delta?: { type?: string, text?: string, thinking?: string }
    message?: { model?: string }
  }
  content?: Array<{ type?: string, text?: string }> | string
}

/**
 * Parses a single NDJSON line from Claude Code's stream-json output.
 *
 * Returns `undefined` for blank lines, non-JSON noise (the CLI occasionally
 * prints warnings to stdout), and event kinds AIRI does not consume. The parser
 * never throws so one bad line cannot abort a whole turn.
 */
export function parseClaudeStreamLine(line: string): ClaudeStreamUpdate | undefined {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.startsWith('{'))
    return undefined

  let raw: ClaudeRawLine
  try {
    raw = JSON.parse(trimmed) as ClaudeRawLine
  }
  catch {
    return undefined
  }

  const update: ClaudeStreamUpdate = {}
  if (raw.session_id)
    update.sessionID = raw.session_id
  if (raw.sessionId)
    update.sessionID = raw.sessionId

  switch (raw.type) {
    case 'system':
      // The init line carries the session id (already captured) and model.
      if (raw.model)
        update.modelID = raw.model
      if (raw.message?.model)
        update.modelID = raw.message.model
      break

    case 'assistant': {
      // Some Claude Code CLI builds emit an `assistant` line with full message.
      if (raw.message?.model)
        update.modelID = raw.message.model
      const content = raw.message?.content ?? raw.content
      if (typeof content === 'string' && content)
        update.delta = content
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'thought')
            continue
          if (part?.type === 'text' && part.text)
            update.delta = part.text
        }
      }
      break
    }

    case 'stream_event': {
      const event = raw.event
      if (event?.message?.model)
        update.modelID = event.message.model
      if (event?.type === 'content_block_delta') {
        const delta = event.delta
        if (delta?.type === 'thought_delta')
          break
        if ((delta?.type === 'text_delta' || delta?.type === 'thought') && delta.text)
          update.delta = delta.text
      }
      break
    }

    case 'result':
      if (raw.is_error || raw.error || raw.subtype === 'error') {
        update.isError = true
        const errorObj = typeof raw.error === 'object' && raw.error ? (raw.error as { message?: string }) : undefined
        update.errorText = raw.result || errorObj?.message || raw.subtype || 'Claude Code reported an error'
      }
      else if (typeof raw.result === 'string') {
        update.resultText = raw.result
      }
      else if (typeof raw.text === 'string') {
        update.resultText = raw.text
      }
      break

    default:
      break
  }

  return update
}
