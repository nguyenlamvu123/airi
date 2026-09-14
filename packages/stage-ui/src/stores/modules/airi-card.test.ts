import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStageModel } from '../settings/stage-model'
import { useAiriCardStore } from './airi-card'

vi.mock('./artistry', async () => {
  const { defineStore } = await import('pinia')

  return {
    useArtistryStore: defineStore('artistry', {
      state: () => ({
        globalProvider: 'mock-artistry-provider',
        globalModel: 'mock-artistry-model',
        globalPromptPrefix: 'mock-artistry-prefix',
        globalProviderOptions: {},
        activeProvider: 'mock-artistry-provider',
        activeModel: 'mock-artistry-model',
        defaultPromptPrefix: 'mock-artistry-prefix',
        providerOptions: {},
      }),
      actions: {
        resetToGlobal() {},
      },
    }),
  }
})

vi.mock('./consciousness', async () => {
  const { defineStore } = await import('pinia')

  return {
    useConsciousnessStore: defineStore('consciousness', {
      state: () => ({
        activeProvider: 'mock-consciousness-provider',
        activeModel: 'mock-consciousness-model',
      }),
    }),
  }
})

vi.mock('./speech', async () => {
  const { defineStore } = await import('pinia')

  return {
    useSpeechStore: defineStore('speech', {
      state: () => ({
        activeSpeechProvider: 'mock-speech-provider',
        activeSpeechModel: 'mock-speech-model',
        activeSpeechVoiceId: 'mock-speech-voice',
      }),
    }),
  }
})

vi.mock('./vision', async () => {
  const { defineStore } = await import('pinia')

  return {
    useVisionStore: defineStore('vision', {
      state: () => ({
        activeProvider: 'mock-vision-provider',
        activeModel: 'mock-vision-model',
      }),
    }),
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

/**
 * @example
 * describe('airi-card store', () => {})
 */
describe('airi-card store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  /**
   * @example
   * it('persists selected module config on active card', () => {})
   */
  it('persists selected module config on active card', () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-live2d-1'

    const cardStore = useAiriCardStore()
    cardStore.initialize()

    expect(cardStore.updateActiveCardDisplayModel('display-model-iru-v2')).toBe(true)
    expect(cardStore.updateActiveCardConsciousness({ provider: 'openrouter-ai', model: 'anthropic/claude-sonnet' })).toBe(true)
    expect(cardStore.updateActiveCardVision({ provider: 'ollama', model: 'llava' })).toBe(true)
    expect(cardStore.updateActiveCardSpeech({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'aria' })).toBe(true)
    expect(cardStore.activeCard?.extensions.airi.modules).toMatchObject({
      displayModelId: 'display-model-iru-v2',
      consciousness: { provider: 'openrouter-ai', model: 'anthropic/claude-sonnet' },
      vision: { provider: 'ollama', model: 'llava' },
      speech: { provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'aria' },
    })
    expect(stageModelStore.stageModelSelected).toBe('preset-live2d-1')
  })

  /**
   * @example
   * it('updates speech config on the active card', () => {})
   */
  it('updates speech config on the active card', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()

    expect(cardStore.updateActiveCardSpeech({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'aria' })).toBe(true)
    expect(cardStore.activeCard?.extensions.airi.modules.speech).toMatchObject({
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      voice_id: 'aria',
    })
  })

  it('builds the default persona card with the Hương Ly cover identity', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()

    const card = cardStore.cards.get('default')
    expect(card?.name).toBe('Hương Ly cover')
    expect(card?.description).toContain('base.prompt.prefix')
    expect(card?.description).toContain('base.prompt.suffix')
  })

  it('restores the default persona even when a stale persona card is persisted', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()

    // Simulate a persisted default card that predates the persona edits: the
    // initialize() guard keeps it forever, so the user needs the restore action.
    const stale = cardStore.cards.get('default')!
    cardStore.cards.set('default', { ...stale, name: 'ReLU', description: 'stale AIRI persona' })

    cardStore.restoreDefaultCardPersona()

    const restored = cardStore.cards.get('default')
    expect(restored?.name).toBe('Hương Ly cover')
    expect(restored?.description).toContain('base.prompt.prefix')
  })

  it('creates a default persona card via restore when none exists yet', () => {
    const cardStore = useAiriCardStore()
    cardStore.restoreDefaultCardPersona()

    expect(cardStore.cards.get('default')?.name).toBe('Hương Ly cover')
    expect(cardStore.activeCardId).toBe('default')
  })
})
