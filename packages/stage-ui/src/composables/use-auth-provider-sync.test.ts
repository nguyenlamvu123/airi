import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OFFICIAL_TRANSCRIPTION_PROVIDER_ID } from '../libs/providers'
import { useAuthProviderSync } from './use-auth-provider-sync'

const syncState = vi.hoisted(() => ({
  authenticatedHook: undefined as (() => Promise<void>) | undefined,
  logoutHook: undefined as (() => void) | undefined,
  activeVisionProvider: '',
  activeVisionModel: '',
  activeSpeechProvider: 'speech-noop',
  activeSpeechModel: '',
  activeSpeechVoiceId: '',
  activeTranscriptionProvider: '',
  activeTranscriptionModel: '',
}))

const syncMocks = vi.hoisted(() => ({
  forceProviderConfigured: vi.fn(),
  setProviderUnconfigured: vi.fn(),
  setProviderAvailabilityOverride: vi.fn(),
  fetchModelsForProvider: vi.fn(async (_providerId: string): Promise<unknown[]> => []),
  loadVisionModels: vi.fn(async () => []),
}))

vi.mock('../libs/auth', () => ({
  initializeAuth: vi.fn(),
}))

vi.mock('../libs/providers', () => ({
  getStreamingTtsAvailable: () => true,
  OFFICIAL_TRANSCRIPTION_PROVIDER_ID: 'official-provider-transcription',
}))

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    onAuthenticated: (hook: () => Promise<void>) => {
      syncState.authenticatedHook = hook
    },
    onLogout: (hook: () => void) => {
      syncState.logoutHook = hook
    },
  }),
}))

vi.mock('../stores/providers', () => ({
  useProvidersStore: () => ({
    getProviderMetadata: () => ({}),
    forceProviderConfigured: syncMocks.forceProviderConfigured,
    setProviderUnconfigured: syncMocks.setProviderUnconfigured,
    setProviderAvailabilityOverride: syncMocks.setProviderAvailabilityOverride,
    fetchModelsForProvider: syncMocks.fetchModelsForProvider,
  }),
}))

vi.mock('../stores/modules/vision', () => ({
  useVisionStore: () => ({
    get activeProvider() { return syncState.activeVisionProvider },
    set activeProvider(value: string) { syncState.activeVisionProvider = value },
    get activeModel() { return syncState.activeVisionModel },
    set activeModel(value: string) { syncState.activeVisionModel = value },
    loadModelsForProvider: syncMocks.loadVisionModels,
  }),
}))

vi.mock('../stores/modules/speech', () => ({
  useSpeechStore: () => ({
    get activeSpeechProvider() { return syncState.activeSpeechProvider },
    set activeSpeechProvider(value: string) { syncState.activeSpeechProvider = value },
    get activeSpeechModel() { return syncState.activeSpeechModel },
    set activeSpeechModel(value: string) { syncState.activeSpeechModel = value },
    get activeSpeechVoiceId() { return syncState.activeSpeechVoiceId },
    set activeSpeechVoiceId(value: string) { syncState.activeSpeechVoiceId = value },
    ensureStreamingDefaultModel: vi.fn(),
    loadVoicesForProvider: vi.fn(async () => []),
  }),
}))

vi.mock('../stores/modules/hearing', () => ({
  useHearingStore: () => ({
    get activeTranscriptionProvider() { return syncState.activeTranscriptionProvider },
    set activeTranscriptionProvider(value: string) { syncState.activeTranscriptionProvider = value },
    get activeTranscriptionModel() { return syncState.activeTranscriptionModel },
    set activeTranscriptionModel(value: string) { syncState.activeTranscriptionModel = value },
  }),
}))

describe('useAuthProviderSync', () => {
  beforeEach(() => {
    syncState.authenticatedHook = undefined
    syncState.logoutHook = undefined
    syncState.activeVisionProvider = ''
    syncState.activeVisionModel = ''
    syncState.activeSpeechProvider = 'speech-noop'
    syncState.activeSpeechModel = ''
    syncState.activeSpeechVoiceId = ''
    syncState.activeTranscriptionProvider = ''
    syncState.activeTranscriptionModel = ''
    vi.clearAllMocks()
    syncMocks.fetchModelsForProvider.mockResolvedValue([])
  })

  it('activates every official provider after direct sign-in when no custom provider is selected', async () => {
    useAuthProviderSync()

    await syncState.authenticatedHook?.()

    expect(syncMocks.forceProviderConfigured).toHaveBeenCalledWith('vision-official-provider')
    expect(syncMocks.forceProviderConfigured).toHaveBeenCalledWith('official-provider-speech')
    expect(syncMocks.forceProviderConfigured).toHaveBeenCalledWith(OFFICIAL_TRANSCRIPTION_PROVIDER_ID)
    expect(syncState.activeSpeechProvider).toBe('official-provider-speech')
    expect(syncState.activeTranscriptionProvider).toBe(OFFICIAL_TRANSCRIPTION_PROVIDER_ID)
  })

  it('retries provider activation when the first authenticated sync fails', async () => {
    // ROOT CAUSE:
    //
    // The auth hook marked the session synchronized before model and streaming
    // provider bootstrap completed. A transient failure therefore made every
    // later authentication notification return early for the whole session.
    syncMocks.fetchModelsForProvider.mockImplementation(async (providerId: string) => {
      if (providerId === 'official-provider-speech-streaming')
        throw new Error('temporary catalog failure')
      return []
    })
    useAuthProviderSync()

    await expect(syncState.authenticatedHook?.()).rejects.toThrow('temporary catalog failure')
    syncMocks.fetchModelsForProvider.mockResolvedValue([])
    await expect(syncState.authenticatedHook?.()).resolves.toBeUndefined()

    // Three auth-activated providers per run, plus the streaming TTS provider
    // forced once on the successful second run.
    expect(syncMocks.forceProviderConfigured).toHaveBeenCalledTimes(7)
    expect(syncMocks.forceProviderConfigured.mock.calls.filter(([providerId]) => providerId === 'official-provider-speech')).toHaveLength(2)
    expect(syncMocks.forceProviderConfigured.mock.calls.filter(([providerId]) => providerId === OFFICIAL_TRANSCRIPTION_PROVIDER_ID)).toHaveLength(2)
  })
})
