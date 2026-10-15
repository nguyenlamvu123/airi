import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'

import { electronOpencodeEnsure, electronOpencodeStatus, electronOpencodeStop } from '../../shared/eventa'

/** Renderer-local marker so the opencode default is only applied once. */
const OPENCODE_DEFAULT_APPLIED_KEY = 'settings/opencode/default-applied'

/**
 * Wires the desktop opencode chat backend into the shared provider system.
 *
 * On boot it asks the main process to spawn `opencode serve` + the
 * OpenAI-compatible proxy, then points the `opencode` chat provider at the
 * returned URL. The first time this runs it also makes opencode the active chat
 * provider so AIRI does not fall back to its own default LLM; later boots leave
 * the user's explicit provider choice untouched.
 */
export function useOpencodeBackend() {
  const ensure = useElectronEventaInvoke(electronOpencodeEnsure)
  const getStatus = useElectronEventaInvoke(electronOpencodeStatus)
  const stop = useElectronEventaInvoke(electronOpencodeStop)

  const providersStore = useProvidersStore()
  const consciousnessStore = useConsciousnessStore()

  async function ensureRunning() {
    const status = await ensure({})
    if (!status.running || !status.proxyBaseUrl) {
      if (status.error)
        console.warn('[opencode] backend unavailable:', status.error)
      return status
    }

    // Point the provider at the live proxy URL. Writing into the credentials map
    // both persists the URL and marks the provider as "listed" (config differs
    // from the static default), so it appears in the settings picker.
    providersStore.providers.opencode = { baseUrl: status.proxyBaseUrl }
    providersStore.forceProviderConfigured('opencode')

    return status
  }

  function applyDefaultProvider() {
    if (localStorage.getItem(OPENCODE_DEFAULT_APPLIED_KEY))
      return

    // Only claim the default slot when nothing else owns it, or when the
    // auth-sync glue auto-selected the official provider. A user-configured
    // third-party provider is always respected.
    const current = consciousnessStore.activeProvider
    if (current && current !== 'official-provider')
      return

    consciousnessStore.activeProvider = 'opencode'
    consciousnessStore.activeModel = 'opencode'
    localStorage.setItem(OPENCODE_DEFAULT_APPLIED_KEY, '1')
  }

  async function initialize() {
    try {
      const status = await ensureRunning()
      if (!status.running)
        return

      applyDefaultProvider()
      void providersStore.fetchModelsForProvider('opencode')
    }
    catch (error) {
      console.warn('[opencode] failed to initialize backend:', error)
    }
  }

  async function dispose() {
    try {
      await stop()
    }
    catch (error) {
      console.warn('[opencode] failed to stop backend:', error)
    }
  }

  return { ensureRunning, getStatus, initialize, dispose }
}
