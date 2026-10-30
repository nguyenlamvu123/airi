import type { ChatHistoryItem } from '../../../../types/chat'
import type { ChatSessionMeta } from '../../../../types/chat-session'

import { extractMessageText } from '../../../../libs/chat-sync'

/** Longest preview kept from a message; the rest becomes `…`. */
const PREVIEW_MAX_LENGTH = 80

function previewText(message: ChatHistoryItem): string | undefined {
  const trimmed = extractMessageText(message).replace(/\s+/g, ' ').trim()
  if (!trimmed)
    return undefined
  return trimmed.length > PREVIEW_MAX_LENGTH ? `${trimmed.slice(0, PREVIEW_MAX_LENGTH)}…` : trimmed
}

/**
 * Names a chat session the way users recognize it: its stored title, else a
 * one-line preview of the first user message.
 *
 * A session whose user messages are all empty falls back to its first
 * assistant or tool message. `system` prompts and `error` markers never name a
 * session: every session starts with the same system prompt, and a failed send
 * stores only the error (e.g. "Provider metadata for … not found").
 *
 * Returns `undefined` when nothing readable exists, so each caller shows its
 * own localized "new chat" placeholder.
 *
 * Before:
 * - messages: [system, assistant 'Hi, I am AIRI', user 'Tell me  about\nthe moon today']
 *
 * After:
 * - "Tell me about the moon today"
 */
export function sessionPreview(meta: ChatSessionMeta, messages: ChatHistoryItem[] = []): string | undefined {
  if (meta.title)
    return meta.title

  for (const message of messages) {
    if (message.role !== 'user')
      continue
    const text = previewText(message)
    if (text)
      return text
  }

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'error' || message.role === 'user')
      continue
    const text = previewText(message)
    if (text)
      return text
  }

  return undefined
}
