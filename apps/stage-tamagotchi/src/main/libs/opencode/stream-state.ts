/**
 * Minimal shape of the opencode server-sent event stream we depend on.
 *
 * opencode emits many event types; we only read the fields needed to turn the
 * `build`-agent turn into incremental assistant text. Field names mirror the
 * `data:` JSON payloads from `GET /event` on `opencode serve`.
 */
export interface OpencodeStreamEvent {
  type: string
  properties?: {
    sessionID?: string
    messageID?: string
    partID?: string
    /** Which field of the part changed, e.g. `"text"` for reasoning and text parts. */
    field?: string
    /** The appended chunk for `message.part.delta`. */
    delta?: string
    info?: {
      id?: string
      role?: string
    }
    part?: {
      id?: string
      type?: string
      text?: string
    }
  }
}

/**
 * Tracks which message/part ids belong to the assistant reply so callers can
 * forward visible assistant text without leaking the user's own message or the
 * model's hidden reasoning.
 *
 * opencode streams reasoning and answer text through the same
 * `message.part.delta` event with `field: "text"`. The only way to tell them
 * apart is the part `type` announced earlier by `message.part.updated`, so this
 * tracker records both the assistant message ids and each part's type.
 *
 * One tracker instance is bound to a single opencode session: events from other
 * sessions are ignored so concurrent conversations never cross-talk.
 */
export function createAssistantTextTracker(sessionID: string) {
  const assistantMessageIDs = new Set<string>()
  const partTypes = new Map<string, string>()

  return {
    /**
     * Applies one event to the tracker.
     *
     * @returns the visible assistant text chunk carried by the event, or
     * `undefined` when the event is bookkeeping (id/type registration) or does
     * not belong to this session's assistant reply.
     */
    handle(event: OpencodeStreamEvent): string | undefined {
      const properties = event.properties
      if (!properties)
        return undefined

      // Events from other sessions (or session-less global events) are unrelated.
      if (properties.sessionID && properties.sessionID !== sessionID)
        return undefined

      if (event.type === 'message.updated') {
        const info = properties.info
        if (info?.role === 'assistant' && info.id)
          assistantMessageIDs.add(info.id)
        return undefined
      }

      if (event.type === 'message.part.updated') {
        const part = properties.part
        if (part?.id)
          partTypes.set(part.id, part.type ?? '')
        return undefined
      }

      if (event.type === 'message.part.delta' && properties.field === 'text') {
        const { messageID, partID } = properties
        if (!messageID || !partID)
          return undefined
        // Only forward text parts; reasoning parts share the same `text` field
        // and part ids but must stay hidden from the user-facing reply.
        if (assistantMessageIDs.has(messageID) && partTypes.get(partID) === 'text')
          return properties.delta ?? ''
      }

      return undefined
    },
  }
}
