import type { AgentBackendManager } from './manager'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AGENT_PROXY_MODEL_ID } from '../../../shared/eventa'
import { createAgentBackendManager } from './manager'

/**
 * End-to-end check of the agent backend layer: a real `opencode serve` process,
 * the OpenAI-compatible proxy, and OpenAI requests through it.
 *
 * Skipped by default because it spawns opencode, reaches a model, and is slow.
 * One server is started for the whole suite: spawning opencode servers back to
 * back is flaky because a just-killed instance can briefly hold a lock/port.
 * Run with `AIRI_OPENCODE_TEST=1 pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/main/libs/agent/manager.test.ts`.
 */
const enabled = process.env.AIRI_OPENCODE_TEST === '1'

describe.skipIf(!enabled)('agent backend manager (integration)', () => {
  let manager: AgentBackendManager
  let proxyBaseUrl: string
  let sessionID: string | undefined

  beforeAll(async () => {
    manager = createAgentBackendManager()
    const status = await manager.ensure({ backendId: 'opencode', directory: process.cwd() })
    expect(status.error).toBeUndefined()
    proxyBaseUrl = status.proxyBaseUrl ?? ''
    sessionID = status.sessionID
  }, 60_000)

  afterAll(async () => {
    await manager?.stop()
  })

  it('exposes a session id and an OpenAI-compatible base URL', () => {
    expect(proxyBaseUrl).toBeTruthy()
    expect(sessionID).toBeTruthy()
  })

  it('serves a model list', async () => {
    const models = await fetch(`${proxyBaseUrl}/models`).then(response => response.json()) as { data: Array<{ id: string }> }
    expect(models.data[0].id).toBe(AGENT_PROXY_MODEL_ID)
  })

  it('streams assistant text', async () => {
    const response = await fetch(`${proxyBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: AGENT_PROXY_MODEL_ID,
        stream: true,
        messages: [{ role: 'user', content: 'Reply with exactly the single word: pong' }],
      }),
    })
    const body = await response.text()
    expect(body).toContain('data: [DONE]')
    expect(body.toLowerCase()).toContain('pong')
  }, 180_000)

  it('answers a non-streaming completion', async () => {
    const response = await fetch(`${proxyBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: AGENT_PROXY_MODEL_ID,
        messages: [{ role: 'user', content: 'Reply with exactly the single word: pong' }],
      }),
    })
    const body = await response.json() as { choices: Array<{ message: { content: string } }> }
    expect(body.choices[0].message.content.toLowerCase()).toContain('pong')
  }, 180_000)
})
