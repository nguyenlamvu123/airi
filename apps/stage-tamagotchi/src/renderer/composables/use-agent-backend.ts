import type { AgentBackendInfo, AgentBackendStatus } from '../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'

import {
  AGENT_PROXY_MODEL_ID,
  electronAgentBackendEnsure,
  electronAgentBackendList,
  electronAgentBackendStatus,
  electronAgentBackendStop,
} from '../../shared/eventa'

/** LocalStorage key holding the user's chosen backend id. */
const BACKEND_KEY = 'settings/agent/backend'
/** Marker so the agent default is only claimed once. */
const DEFAULT_APPLIED_KEY = 'settings/agent/default-applied'
/** Backend used when the user has not chosen one yet (available on this machine). */
const FALLBACK_BACKEND_ID = 'opencode'

function sessionKey(backendId: string): string {
  return `settings/agent/session/${backendId}`
}

/**
 * Wires a local desktop agent backend into the shared provider system.
 *
 * On boot it reads the user's chosen backend, asks the main process to start it
 * (resuming the persisted session so the conversation continues across
 * launches), then points that backend's chat provider at the returned proxy
 * URL. The first time this runs it also makes the backend the active chat
 * provider so AIRI does not fall back to its own default LLM; later boots leave
 * the user's explicit provider choice untouched.
 */
export function useAgentBackend() {
  const ensure = useElectronEventaInvoke(electronAgentBackendEnsure)
  const list = useElectronEventaInvoke(electronAgentBackendList)
  const getStatus = useElectronEventaInvoke(electronAgentBackendStatus)
  const stop = useElectronEventaInvoke(electronAgentBackendStop)

  const providersStore = useProvidersStore()
  const consciousnessStore = useConsciousnessStore()

  function selectedBackendId(): string {
    return localStorage.getItem(BACKEND_KEY) || FALLBACK_BACKEND_ID
  }

  async function ensureRunning(backendId = selectedBackendId()): Promise<AgentBackendStatus> {
    const resumeSessionID = localStorage.getItem(sessionKey(backendId)) || undefined
    const status = await ensure({ backendId, resumeSessionID })
    if (!status.running || !status.proxyBaseUrl) {
      if (status.error)
        console.warn(`[agent] backend "${backendId}" unavailable:`, status.error)
      return status
    }

    // Point the provider at the live proxy URL. Writing into the credentials map
    // both persists the URL and marks the provider as "listed" (config differs
    // from the static default), so it appears in the settings picker.
    providersStore.providers[backendId] = { baseUrl: status.proxyBaseUrl }
    providersStore.forceProviderConfigured(backendId)

    // Persist the (possibly newly minted) session id so the next launch resumes
    // the same conversation instead of starting fresh.
    if (status.sessionID)
      localStorage.setItem(sessionKey(backendId), status.sessionID)

    return status
  }

  function applyDefaultProvider(backendId: string) {
    if (localStorage.getItem(DEFAULT_APPLIED_KEY))
      return

    // Only claim the default slot when nothing else owns it, or when the
    // auth-sync glue auto-selected the official provider. A user-configured
    // third-party provider is always respected.
    const current = consciousnessStore.activeProvider
    if (current && current !== 'official-provider')
      return

    consciousnessStore.activeProvider = backendId
    consciousnessStore.activeModel = AGENT_PROXY_MODEL_ID
    localStorage.setItem(DEFAULT_APPLIED_KEY, '1')
  }

  async function initialize() {
    const backendId = selectedBackendId()
    try {
      const status = await ensureRunning(backendId)
      if (!status.running)
        return

      applyDefaultProvider(backendId)
      void providersStore.fetchModelsForProvider(backendId)
    }
    catch (error) {
      console.warn('[agent] failed to initialize backend:', error)
    }
  }

  /** Persists a new backend choice and starts it, replacing the active one. */
  async function setBackend(backendId: string): Promise<AgentBackendStatus> {
    localStorage.setItem(BACKEND_KEY, backendId)
    const status = await ensureRunning(backendId)
    if (status.running)
      void providersStore.fetchModelsForProvider(backendId)
    return status
  }

  function getBackends(): Promise<AgentBackendInfo[]> {
    return list()
  }

  async function dispose() {
    try {
      await stop()
    }
    catch (error) {
      console.warn('[agent] failed to stop backend:', error)
    }
  }

  return { ensureRunning, getStatus, getBackends, setBackend, initialize, dispose }
}
