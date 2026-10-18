import { describe, expect, it } from 'vitest'

import { AGENT_BACKEND_DEFINITIONS, getAgentBackendDefinition, isCommandAvailable, listAgentBackends } from './registry'

describe('agent backend registry', () => {
  it('lists every selectable backend', () => {
    const ids = listAgentBackends().map(backend => backend.id)
    expect(ids).toContain('opencode')
    expect(ids).toContain('claude-code')
    expect(ids).toContain('gemini-cli')
    expect(ids).toContain('codex-cli')
    expect(ids).toContain('acp')
  })

  it('reports unimplemented backends as unavailable regardless of PATH', () => {
    for (const backend of listAgentBackends()) {
      if (getAgentBackendDefinition(backend.id)?.implemented)
        continue
      expect(backend.available).toBe(false)
    }
  })

  it('finds an executable that is on PATH', () => {
    expect(isCommandAvailable('node')).toBe(true)
  })

  it('does not find an executable that cannot exist', () => {
    expect(isCommandAvailable('airi-definitely-not-a-real-command')).toBe(false)
  })

  it('exposes a factory for every implemented backend', () => {
    for (const definition of AGENT_BACKEND_DEFINITIONS) {
      if (definition.implemented)
        expect(definition.create).toBeTypeOf('function')
    }
  })
})
