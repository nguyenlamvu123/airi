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
  let proxyApiKey: string

  beforeAll(async () => {
    manager = createAgentBackendManager()
    const status = await manager.ensure({ backendId: 'opencode', directory: process.cwd() })
    expect(status.error).toBeUndefined()
    proxyBaseUrl = status.proxyBaseUrl ?? ''
    proxyApiKey = status.proxyApiKey ?? ''
  }, 60_000)

  afterAll(async () => {
    await manager?.stop()
  })

  it('exposes an OpenAI-compatible base URL and its bearer token', () => {
    expect(proxyBaseUrl).toBeTruthy()
    expect(proxyApiKey).toBeTruthy()
  })

  it('serves a model list', async () => {
    const models = await fetch(`${proxyBaseUrl}/models`, { headers: { authorization: `Bearer ${proxyApiKey}` } }).then(response => response.json()) as { data: Array<{ id: string }> }
    expect(models.data[0].id).toBe(AGENT_PROXY_MODEL_ID)
  })

  it('streams assistant text', async () => {
    const response = await fetch(`${proxyBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${proxyApiKey}` },
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
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${proxyApiKey}` },
      body: JSON.stringify({
        model: AGENT_PROXY_MODEL_ID,
        messages: [{ role: 'user', content: 'Reply with exactly the single word: pong' }],
      }),
    })
    const body = await response.json() as { choices: Array<{ message: { content: string } }> }
    expect(body.choices[0].message.content.toLowerCase()).toContain('pong')
  }, 180_000)
})

// Uses the real registry with a `commandPath` override, so nothing is spawned:
// the backend process only launches on the first chat request.
describe('agent backend manager switching', () => {
  // docs/brainstorms/2026-10-28-kiem-tra-tinh-nang-tu-b8dbc269e.md (H1)
  it('h1: keeps the running backend when the requested one cannot start', async () => {
    // ROOT CAUSE:
    //
    // `ensure` stopped the active backend before checking the new one, so
    // switching to a backend that was missing left nothing running while the
    // chat provider still pointed at the stopped proxy.
    //
    // We fixed this by validating the requested backend first and returning
    // its error alongside the snapshot of the backend that keeps running.
    const manager = createAgentBackendManager()
    const directory = process.cwd()
    try {
      const first = await manager.ensure({ backendId: 'claude-code', commandPath: process.execPath, directory })
      expect(first.running).toBe(true)
      expect(first.backendId).toBe('claude-code')

      const failed = await manager.ensure({ backendId: 'gemini-cli', directory })
      expect(failed.backendId).toBe('claude-code')
      expect(failed.error).toContain('not supported')

      const status = manager.status()
      expect(status.running).toBe(true)
      expect(status.proxyBaseUrl).toBe(first.proxyBaseUrl)
      const models = await fetch(`${first.proxyBaseUrl}/models`, { headers: { authorization: `Bearer ${first.proxyApiKey}` } })
      expect(models.status).toBe(200)
    }
    finally {
      await manager.stop()
    }
  })

  it('h1: replaces the backend on a successful switch', async () => {
    const manager = createAgentBackendManager()
    const directory = process.cwd()
    try {
      const first = await manager.ensure({ backendId: 'claude-code', commandPath: process.execPath, directory })
      const second = await manager.ensure({ backendId: 'opencode', commandPath: process.execPath, directory })

      expect(second.running).toBe(true)
      expect(second.backendId).toBe('opencode')
      expect(second.error).toBeUndefined()
      expect(second.proxyBaseUrl).not.toBe(first.proxyBaseUrl)
      // The previous proxy is closed, so a stale provider config cannot reach it.
      await expect(fetch(`${first.proxyBaseUrl}/models`)).rejects.toThrow()
    }
    finally {
      await manager.stop()
    }
  })
})
