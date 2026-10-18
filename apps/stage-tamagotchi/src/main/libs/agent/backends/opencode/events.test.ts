import type { OpencodeStreamEvent } from './events'

import { describe, expect, it } from 'vitest'

import { createOpencodeTextTracker } from './events'

const SESSION = 'ses_1'

function assistantUpdated(id: string): OpencodeStreamEvent {
  return { type: 'message.updated', properties: { sessionID: SESSION, info: { id, role: 'assistant' } } }
}

function userUpdated(id: string): OpencodeStreamEvent {
  return { type: 'message.updated', properties: { sessionID: SESSION, info: { id, role: 'user' } } }
}

function partUpdated(id: string, type: string): OpencodeStreamEvent {
  return { type: 'message.part.updated', properties: { sessionID: SESSION, part: { id, type } } }
}

function delta(messageID: string, partID: string, text: string): OpencodeStreamEvent {
  return { type: 'message.part.delta', properties: { sessionID: SESSION, messageID, partID, field: 'text', delta: text } }
}

describe('createOpencodeTextTracker', () => {
  it('forwards assistant text-part deltas', () => {
    const tracker = createOpencodeTextTracker(SESSION)
    tracker.handle(assistantUpdated('msg_a'))
    tracker.handle(partUpdated('prt_text', 'text'))

    expect(tracker.handle(delta('msg_a', 'prt_text', 'hello'))).toBe('hello')
  })

  it('ignores reasoning-part deltas that share the text field', () => {
    const tracker = createOpencodeTextTracker(SESSION)
    tracker.handle(assistantUpdated('msg_a'))
    tracker.handle(partUpdated('prt_reason', 'reasoning'))

    expect(tracker.handle(delta('msg_a', 'prt_reason', 'thinking...'))).toBeUndefined()
  })

  it('ignores deltas for the user message', () => {
    const tracker = createOpencodeTextTracker(SESSION)
    tracker.handle(userUpdated('msg_u'))
    tracker.handle(partUpdated('prt_u', 'text'))

    expect(tracker.handle(delta('msg_u', 'prt_u', 'user text'))).toBeUndefined()
  })

  it('ignores deltas from another session', () => {
    const tracker = createOpencodeTextTracker(SESSION)
    tracker.handle(assistantUpdated('msg_a'))
    tracker.handle(partUpdated('prt_text', 'text'))

    const foreign: OpencodeStreamEvent = {
      type: 'message.part.delta',
      properties: { sessionID: 'ses_other', messageID: 'msg_a', partID: 'prt_text', field: 'text', delta: 'nope' },
    }
    expect(tracker.handle(foreign)).toBeUndefined()
  })

  it('ignores deltas for an unknown part type', () => {
    const tracker = createOpencodeTextTracker(SESSION)
    tracker.handle(assistantUpdated('msg_a'))

    expect(tracker.handle(delta('msg_a', 'prt_unknown', 'x'))).toBeUndefined()
  })

  it('ignores non-text field deltas', () => {
    const tracker = createOpencodeTextTracker(SESSION)
    tracker.handle(assistantUpdated('msg_a'))
    tracker.handle(partUpdated('prt_text', 'text'))

    const other: OpencodeStreamEvent = {
      type: 'message.part.delta',
      properties: { sessionID: SESSION, messageID: 'msg_a', partID: 'prt_text', field: 'status', delta: 'running' },
    }
    expect(tracker.handle(other)).toBeUndefined()
  })
})
