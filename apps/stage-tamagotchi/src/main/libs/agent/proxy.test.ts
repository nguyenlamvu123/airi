import { describe, expect, it } from 'vitest'

import { extractLastUserPrompt, extractSystemPrompt } from './proxy'

describe('extractSystemPrompt', () => {
  // docs/brainstorms/2026-10-28-kiem-tra-tinh-nang-tu-b8dbc269e.md (H5)
  it('h5: joins every system message, string or text parts, in order', () => {
    // ROOT CAUSE:
    //
    // The proxy forwarded only the last user message, so AIRI's system prompt
    // (character card, emotion/ACT marker rules) never reached the agent and
    // it answered as a coding assistant.
    //
    // We fixed this by sending the request's system messages with each turn.
    const prompt = extractSystemPrompt([
      { role: 'system', content: 'Bạn là AIRI.' },
      { role: 'user', content: 'chào' },
      { role: 'system', content: [{ type: 'text', text: ' Dùng marker <|EMOTE_HAPPY|>. ' }] },
    ])
    expect(prompt).toBe('Bạn là AIRI.\n\nDùng marker <|EMOTE_HAPPY|>.')
  })

  it('returns an empty string without system messages', () => {
    expect(extractSystemPrompt([{ role: 'user', content: 'chào' }])).toBe('')
    expect(extractSystemPrompt(undefined)).toBe('')
  })

  it('skips system messages that have no text', () => {
    expect(extractSystemPrompt([{ role: 'system', content: '   ' }, { role: 'system', content: 'Bạn là AIRI.' }])).toBe('Bạn là AIRI.')
  })
})

describe('extractLastUserPrompt', () => {
  it('takes the text of the last user message and drops image parts', () => {
    const prompt = extractLastUserPrompt([
      { role: 'user', content: 'cũ' },
      { role: 'assistant', content: 'đáp' },
      { role: 'user', content: [{ type: 'text', text: 'mới' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    ])
    expect(prompt).toBe('mới')
  })
})
