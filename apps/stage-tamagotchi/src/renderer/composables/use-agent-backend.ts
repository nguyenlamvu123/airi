import type { AgentBackendInfo, AgentBackendStatus } from '../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { watch } from 'vue'
import { toast } from 'vue-sonner'

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
 * On boot it reads the user's chosen backend, asks the main process to start
 * its proxy (the backend process itself launches on the first chat message,
 * resuming the persisted session so the conversation continues across
 * launches), then points that backend's chat provider at the returned proxy
 * URL. The first time this runs it also makes the backend the active chat
 * provider so AIRI does not fall back to its own default LLM; later boots leave
 * the user's explicit provider choice untouched.
 *
 * The active chat provider is the source of truth for which backend runs: when
 * it names an agent backend (picked in settings or through
 * {@link setBackend}), that backend is the one started.
 */
export function useAgentBackend() {
  const ensure = useElectronEventaInvoke(electronAgentBackendEnsure)
  const list = useElectronEventaInvoke(electronAgentBackendList)
  const getStatus = useElectronEventaInvoke(electronAgentBackendStatus)
  const stop = useElectronEventaInvoke(electronAgentBackendStop)

  const providersStore = useProvidersStore()
  const consciousnessStore = useConsciousnessStore()
  const chatOrchestrator = useChatOrchestratorStore()
  let unsubscribeTurnComplete: (() => void) | undefined
  let stopProviderWatch: (() => void) | undefined

  function selectedBackendId(): string {
    return localStorage.getItem(BACKEND_KEY) || FALLBACK_BACKEND_ID
  }

  /** Session id saved from an earlier turn, which the next start resumes. */
  function storedSessionID(backendId: string): string | undefined {
    return localStorage.getItem(sessionKey(backendId)) || undefined
  }

  async function ensureRunning(backendId = selectedBackendId()): Promise<AgentBackendStatus> {
    const status = await ensure({ backendId, resumeSessionID: storedSessionID(backendId) })
    // A failed switch still reports the previous backend as running; its proxy
    // must not be written into this backend's provider config.
    if (!status.running || status.backendId !== backendId || !status.proxyBaseUrl || !status.proxyApiKey) {
      if (status.error)
        console.warn(`[agent] backend "${backendId}" unavailable:`, status.error)
      return status
    }

    // Point the provider at the live proxy URL and its per-launch token. Writing
    // into the credentials map both persists the config and marks the provider
    // as "listed" (config differs from the static default), so it appears in
    // the settings picker. The stored token goes stale on the next launch and is
    // overwritten here before any chat request uses it.
    providersStore.providers[backendId] = { baseUrl: status.proxyBaseUrl, apiKey: status.proxyApiKey }
    providersStore.forceProviderConfigured(backendId)

    persistSession(status)
    return status
  }

  // Saves the live session id so the next launch resumes the same conversation
  // instead of starting fresh. The backend launches on the first chat request
  // and CLI backends mint the id on their first answer, so the id usually
  // appears only after a turn; `initialize` therefore also calls this after
  // every completed turn.
  function persistSession(status: AgentBackendStatus) {
    if (status.backendId && status.sessionID)
      localStorage.setItem(sessionKey(status.backendId), status.sessionID)
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
    unsubscribeTurnComplete ??= chatOrchestrator.onChatTurnComplete(async () => {
      try {
        persistSession(await getStatus())
      }
      catch (error) {
        console.warn('[agent] failed to persist session:', error)
      }
    })

    try {
      const agentBackendIds = new Set((await list()).map(backend => backend.id))

      // An agent provider picked in settings wins over the stored backend
      // choice, so the provider in use and the backend running never disagree.
      const activeProvider = consciousnessStore.activeProvider
      const backendId = activeProvider && agentBackendIds.has(activeProvider) ? activeProvider : selectedBackendId()
      const status = await ensureRunning(backendId)
      if (status.running && status.backendId === backendId) {
        applyDefaultProvider(backendId)
        void providersStore.fetchModelsForProvider(backendId)
      }

      stopProviderWatch ??= watch(() => consciousnessStore.activeProvider, async (providerId) => {
        if (!providerId || !agentBackendIds.has(providerId))
          return
        const current = await getStatus()
        if (current.running && current.backendId === providerId)
          return
        try {
          await setBackend(providerId)
        }
        catch (error) {
          toast.error(errorMessageFrom(error) ?? `Failed to start agent backend "${providerId}"`)
        }
      })
    }
    catch (error) {
      console.warn('[agent] failed to initialize backend:', error)
    }
  }

  /**
   * Switches to another agent backend and makes it the chat provider.
   *
   * The main process runs one backend at a time, so a successful switch stops
   * the previous one; the chat provider has to follow or every message would
   * go to a stopped proxy. On failure nothing changes: the previous backend
   * keeps running and stays selected, and the error is thrown for the caller
   * to show.
   */
  async function setBackend(backendId: string): Promise<AgentBackendStatus> {
    const status = await ensureRunning(backendId)
    if (!status.running || status.backendId !== backendId)
      throw new Error(status.error ?? `Agent backend "${backendId}" did not start`)

    localStorage.setItem(BACKEND_KEY, backendId)
    consciousnessStore.activeProvider = backendId
    consciousnessStore.activeModel = AGENT_PROXY_MODEL_ID
    void providersStore.fetchModelsForProvider(backendId)
    return status
  }

  function getBackends(): Promise<AgentBackendInfo[]> {
    return list()
  }

  async function dispose() {
    unsubscribeTurnComplete?.()
    unsubscribeTurnComplete = undefined
    stopProviderWatch?.()
    stopProviderWatch = undefined
    try {
      await stop()
    }
    catch (error) {
      console.warn('[agent] failed to stop backend:', error)
    }
  }

  return { ensureRunning, getStatus, getBackends, selectedBackendId, storedSessionID, setBackend, initialize, dispose }
}
