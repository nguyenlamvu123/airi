// @vitest-environment jsdom

import type { AgentBackendStatus } from '../../shared/eventa'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import {
  AGENT_PROXY_MODEL_ID,
  electronAgentBackendEnsure,
  electronAgentBackendList,
  electronAgentBackendStatus,
  electronAgentBackendStop,
} from '../../shared/eventa'

const invokers = vi.hoisted(() => ({
  ensure: vi.fn<(request: { backendId: string, resumeSessionID?: string }) => Promise<AgentBackendStatus>>(),
  list: vi.fn(async () => [
    { id: 'opencode', label: 'opencode', description: '', kind: 'http', command: 'opencode', available: true },
    { id: 'claude-code', label: 'Claude Code', description: '', kind: 'cli', command: 'claude', available: true },
  ]),
  status: vi.fn<() => Promise<AgentBackendStatus>>(),
  stop: vi.fn(async () => ({ running: false })),
}))

const stores = vi.hoisted(() => ({
  consciousness: { activeProvider: '', activeModel: '' },
  providers: {} as Record<string, unknown>,
  forceProviderConfigured: vi.fn(),
  fetchModelsForProvider: vi.fn(async () => {}),
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: unknown) => {
    if (event === electronAgentBackendEnsure)
      return invokers.ensure
    if (event === electronAgentBackendList)
      return invokers.list
    if (event === electronAgentBackendStatus)
      return invokers.status
    if (event === electronAgentBackendStop)
      return invokers.stop
    throw new Error('Unexpected eventa invoke')
  },
}))

vi.mock('@proj-airi/stage-ui/stores/modules/consciousness', () => ({
  useConsciousnessStore: () => stores.consciousness,
}))

vi.mock('@proj-airi/stage-ui/stores/providers', () => ({
  useProvidersStore: () => ({
    providers: stores.providers,
    forceProviderConfigured: stores.forceProviderConfigured,
    fetchModelsForProvider: stores.fetchModelsForProvider,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/chat', () => ({
  useChatOrchestratorStore: () => ({ onChatTurnComplete: () => () => {} }),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn() },
}))

function running(backendId: string, port: number): AgentBackendStatus {
  return {
    running: true,
    backendId,
    proxyBaseUrl: `http://127.0.0.1:${port}/v1`,
    proxyApiKey: `token-${port}`,
  }
}

describe('useAgentBackend', async () => {
  const { useAgentBackend } = await import('./use-agent-backend')

  beforeEach(() => {
    localStorage.clear()
    // Reactive so the composable's `watch` on the active provider fires.
    stores.consciousness = reactive({ activeProvider: '', activeModel: '' })
    stores.providers = {}
    invokers.ensure.mockReset()
    invokers.status.mockReset()
    stores.forceProviderConfigured.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // docs/brainstorms/2026-10-28-kiem-tra-tinh-nang-tu-b8dbc269e.md (H1)
  it('h1: makes the new backend the chat provider after a successful switch', async () => {
    // ROOT CAUSE:
    //
    // `setBackend` started the new backend and updated its provider config,
    // but left `activeProvider` on the old backend, whose proxy the main
    // process had just stopped. Every message then went to a dead proxy.
    //
    // We fixed this by making the switch also set `activeProvider` and
    // `activeModel`, and only after the new backend reports running.
    stores.consciousness.activeProvider = 'opencode'
    invokers.ensure.mockResolvedValue(running('claude-code', 4001))

    await useAgentBackend().setBackend('claude-code')

    expect(stores.consciousness.activeProvider).toBe('claude-code')
    expect(stores.consciousness.activeModel).toBe(AGENT_PROXY_MODEL_ID)
    expect(localStorage.getItem('settings/agent/backend')).toBe('claude-code')
    expect(stores.providers['claude-code']).toEqual({ baseUrl: 'http://127.0.0.1:4001/v1', apiKey: 'token-4001' })
  })

  // docs/brainstorms/2026-10-28-kiem-tra-tinh-nang-tu-b8dbc269e.md (H1)
  it('h1: leaves the selection untouched and throws when the switch fails', async () => {
    // ROOT CAUSE:
    //
    // The choice was written to localStorage before the start, so a failed
    // start still showed the new backend as selected (green dot), and the
    // error only reached `console.warn`.
    localStorage.setItem('settings/agent/backend', 'opencode')
    stores.consciousness.activeProvider = 'opencode'
    stores.consciousness.activeModel = AGENT_PROXY_MODEL_ID
    // The main process answers with the backend that keeps running plus the error.
    invokers.ensure.mockResolvedValue({ ...running('opencode', 4000), error: 'Agent backend "Claude Code" is not installed (missing "claude")' })

    await expect(useAgentBackend().setBackend('claude-code')).rejects.toThrow('not installed')

    expect(localStorage.getItem('settings/agent/backend')).toBe('opencode')
    expect(stores.consciousness.activeProvider).toBe('opencode')
    // The surviving backend's proxy must not be written into the other provider.
    expect(stores.providers['claude-code']).toBeUndefined()
  })

  // docs/brainstorms/2026-10-28-kiem-tra-tinh-nang-tu-b8dbc269e.md (H1)
  it('h1: starts the backend picked as chat provider in settings', async () => {
    localStorage.setItem('settings/agent/backend', 'opencode')
    // An agent provider chosen in settings wins over the stored backend choice.
    stores.consciousness.activeProvider = 'claude-code'
    invokers.ensure.mockImplementation(async ({ backendId }) => running(backendId, backendId === 'opencode' ? 4000 : 4001))
    invokers.status.mockResolvedValue(running('claude-code', 4001))

    const agentBackend = useAgentBackend()
    await agentBackend.initialize()
    expect(invokers.ensure).toHaveBeenLastCalledWith({ backendId: 'claude-code', resumeSessionID: undefined })

    // Switching the provider in settings switches the running backend too.
    stores.consciousness.activeProvider = 'opencode'
    await nextTick()
    await vi.waitFor(() => {
      expect(invokers.ensure).toHaveBeenLastCalledWith({ backendId: 'opencode', resumeSessionID: undefined })
    })
    await vi.waitFor(() => {
      expect(localStorage.getItem('settings/agent/backend')).toBe('opencode')
    })

    await agentBackend.dispose()
  })
})
