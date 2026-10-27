import { describe, expect, it } from 'vitest'

import { startOpencodeBridge } from './index'

/**
 * End-to-end check of the opencode bridge: a real `opencode serve` process, the
 * OpenAI-compatible proxy, and an OpenAI streaming request.
 *
 * Skipped by default because it spawns opencode, reaches a model, and is slow.
 * Run with `AIRI_OPENCODE_TEST=1 pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/main/libs/opencode/index.test.ts`.
 */
const enabled = process.env.AIRI_OPENCODE_TEST === '1'

describe.skipIf(!enabled)('opencode bridge (integration)', () => {
  it('serves a model list and streams assistant text', async () => {
    const bridge = await startOpencodeBridge({ directory: process.cwd() })
    try {
      const models = await fetch(`${bridge.proxyBaseUrl}/models`).then(response => response.json()) as { data: Array<{ id: string }> }
      expect(models.data[0].id).toBe('opencode')

      const response = await fetch(`${bridge.proxyBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'opencode',
          stream: true,
          messages: [{ role: 'user', content: 'Reply with exactly the single word: pong' }],
        }),
      })
      const body = await response.text()
      expect(body).toContain('data: [DONE]')
      expect(body.toLowerCase()).toContain('pong')
    }
    finally {
      await bridge.close()
    }
  }, 180_000)

  it('answers a non-streaming completion', async () => {
    const bridge = await startOpencodeBridge({ directory: process.cwd() })
    try {
      const response = await fetch(`${bridge.proxyBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'opencode',
          messages: [{ role: 'user', content: 'Reply with exactly the single word: pong' }],
        }),
      })
      const body = await response.json() as { choices: Array<{ message: { content: string } }> }
      expect(body.choices[0].message.content.toLowerCase()).toContain('pong')
    }
    finally {
      await bridge.close()
    }
  }, 180_000)
})
