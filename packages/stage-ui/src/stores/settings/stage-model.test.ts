import type { DisplayModelURL } from '../display-models'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DisplayModelFormat, useDisplayModelsStore } from '../display-models'
import { useSettingsStageModel } from './stage-model'

let persistedStageModelId = 'preset-live2d-1'

vi.mock('@proj-airi/stage-shared/composables', async () => {
  const { refManualReset } = await import('@vueuse/core')

  return {
    useLocalStorageManualReset: (key: string, value: string) =>
      refManualReset(key === 'settings/stage/model' ? persistedStageModelId : value),
  }
})

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()

  return {
    ...actual,
    useEventListener: vi.fn(),
  }
})

describe('settings stage model store', () => {
  beforeEach(() => {
    persistedStageModelId = 'preset-live2d-1'
    setActivePinia(createPinia())
  })

  it('migrates the persisted previous default preset to the new default once', () => {
    const store = useSettingsStageModel()

    expect(store.stageModelSelected).toBe('preset-live2d-simple-ja')
  })

  it('keeps an explicitly persisted stage model instead of migrating it', () => {
    persistedStageModelId = 'display-model-custom'

    const store = useSettingsStageModel()

    expect(store.stageModelSelected).toBe('display-model-custom')
  })

  // https://github.com/moeru-ai/airi/issues/1984
  it('issue #1984: falls back to the default preset when a custom stage model is missing', async () => {
    const fallbackModel: DisplayModelURL = {
      id: 'preset-live2d-simple-ja',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/preset-live2d.zip',
      name: 'Preset Live2D',
      importedAt: 1,
    }

    const displayModelsStore = useDisplayModelsStore()
    const getDisplayModelSpy = vi.spyOn(displayModelsStore, 'getDisplayModel').mockImplementation(async (id) => {
      if (id === 'display-model-missing')
        return undefined
      if (id === fallbackModel.id)
        return fallbackModel
      return undefined
    })

    const store = useSettingsStageModel()
    store.stageModelSelected = 'display-model-missing'

    await store.initializeStageModel()

    expect(store.stageModelSelected).toBe(fallbackModel.id)
    expect(store.stageModelSelectedDisplayModel).toEqual(fallbackModel)
    expect(store.stageModelSelectedUrl).toBe(fallbackModel.url)
    expect(store.stageModelRenderer).toBe('live2d')
    expect(getDisplayModelSpy).toHaveBeenCalledWith('display-model-missing')
    expect(getDisplayModelSpy).toHaveBeenCalledWith(fallbackModel.id)
  })
})
