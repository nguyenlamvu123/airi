import type { OpencodeClient, OpencodeMessageResult } from './client'
import type { OpencodeStreamEvent } from './events'

import { describe, expect, it, vi } from 'vitest'

import { ALLOW_ALL_PERMISSIONS, createOpencodeTransport } from './transport'

const SESSION = 'ses_1'

function fakeClient(overrides: Partial<OpencodeClient>): OpencodeClient {
  return {
    listSessions: vi.fn(async () => []),
    createSession: vi.fn(async () => ({ id: SESSION })),
    prompt: vi.fn(async () => ({ info: {}, parts: [] } satisfies OpencodeMessageResult)),

    async* subscribeEvents() {},
    ...overrides,
  }
}

describe('createOpencodeTransport', () => {
  it('reuses a resumed session when the server still knows it', async () => {
    const client = fakeClient({ listSessions: vi.fn(async () => [{ id: 'ses_known' }]) })
    const transport = createOpencodeTransport('http://127.0.0.1:1', client)

    const session = await transport.createSession({ resumeSessionID: 'ses_known' })

    expect(session.id).toBe('ses_known')
    expect(client.createSession).not.toHaveBeenCalled()
  })

  it('creates a new session when the resumed id is unknown', async () => {
    const client = fakeClient({ listSessions: vi.fn(async () => [{ id: 'ses_other' }]) })
    const transport = createOpencodeTransport('http://127.0.0.1:1', client)

    const session = await transport.createSession({ resumeSessionID: 'ses_missing' })

    expect(session.id).toBe(SESSION)
    expect(client.createSession).toHaveBeenCalledWith({ title: 'AIRI', permission: ALLOW_ALL_PERMISSIONS })
  })

  it('falls back to creating a session when listing fails', async () => {
    const client = fakeClient({
      listSessions: vi.fn(async () => {
        throw new Error('cold start')
      }),
    })
    const transport = createOpencodeTransport('http://127.0.0.1:1', client)

    const session = await transport.createSession({ resumeSessionID: 'ses_known' })

    expect(session.id).toBe(SESSION)
    expect(client.createSession).toHaveBeenCalled()
  })

  it('forwards assistant text deltas and returns the authoritative full text', async () => {
    const events: OpencodeStreamEvent[] = [
      { type: 'message.updated', properties: { sessionID: SESSION, info: { id: 'msg_a', role: 'assistant' } } },
      { type: 'message.part.updated', properties: { sessionID: SESSION, part: { id: 'prt', type: 'text' } } },
      { type: 'message.part.delta', properties: { sessionID: SESSION, messageID: 'msg_a', partID: 'prt', field: 'text', delta: 'hel' } },
      { type: 'message.part.delta', properties: { sessionID: SESSION, messageID: 'msg_a', partID: 'prt', field: 'text', delta: 'lo' } },
    ]
    const client = fakeClient({
      async* subscribeEvents() {
        for (const event of events) {
          yield event
        }
      },
      prompt: vi.fn(async () => ({ info: { modelID: 'big-pickle' }, parts: [{ type: 'text', text: 'hello' }] })),
    })
    const transport = createOpencodeTransport('http://127.0.0.1:1', client)

    const deltas: string[] = []
    const result = await transport.prompt(SESSION, 'hi', delta => deltas.push(delta))

    expect(deltas.join('')).toBe('hello')
    expect(result.text).toBe('hello')
    expect(result.sessionID).toBe(SESSION)
    expect(result.modelID).toBe('big-pickle')
  })

  it('tops up the stream when the prompt result has more text than the deltas', async () => {
    const events: OpencodeStreamEvent[] = [
      { type: 'message.updated', properties: { sessionID: SESSION, info: { id: 'msg_a', role: 'assistant' } } },
      { type: 'message.part.updated', properties: { sessionID: SESSION, part: { id: 'prt', type: 'text' } } },
      { type: 'message.part.delta', properties: { sessionID: SESSION, messageID: 'msg_a', partID: 'prt', field: 'text', delta: 'hel' } },
    ]
    const client = fakeClient({
      async* subscribeEvents() {
        for (const event of events) {
          yield event
        }
      },
      prompt: vi.fn(async () => ({ info: {}, parts: [{ type: 'text', text: 'hello' }] })),
    })
    const transport = createOpencodeTransport('http://127.0.0.1:1', client)

    const deltas: string[] = []
    await transport.prompt(SESSION, 'hi', delta => deltas.push(delta))

    expect(deltas.join('')).toBe('hello')
  })
})
