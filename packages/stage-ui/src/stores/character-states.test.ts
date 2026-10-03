import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_STATE_FILENAME, resolveCharacterState, useCharacterStatesStore } from './character-states'

const sampleMapping = {
  'đưa tay lên': 'duatay.png',
  'bình thường': 'character.png',
  'hát': 'sing.jpg',
}

function testOptions() {
  return {
    mapping: sampleMapping,
    resolveUrl: vi.fn(async (filename: string) => `https://assets.local/${filename}`),
  }
}

describe('resolveCharacterState', () => {
  it('resolves a matching keyword to its state image', async () => {
    const options = testOptions()

    await expect(resolveCharacterState('bạn ơi đưa tay lên nào', options)).resolves.toEqual({
      kind: 'set',
      media: { keyword: 'đưa tay lên', filename: 'duatay.png', url: 'https://assets.local/duatay.png' },
    })
  })

  it('returns undefined when the text contains no keyword', async () => {
    const options = testOptions()

    await expect(resolveCharacterState('hôm nay trời đẹp quá', options)).resolves.toBeUndefined()
    expect(options.resolveUrl).not.toHaveBeenCalled()
  })

  it('returns undefined when the mapped state file is missing', async () => {
    const options = {
      mapping: sampleMapping,
      resolveUrl: vi.fn(async () => undefined),
    }

    await expect(resolveCharacterState('đưa tay lên', options)).resolves.toBeUndefined()
  })

  it('resolves the reserved default filename to kind default without resolving a url', async () => {
    const options = testOptions()

    await expect(resolveCharacterState('trở lại bình thường nào', options)).resolves.toEqual({ kind: 'default' })
    expect(options.resolveUrl).not.toHaveBeenCalled()
    expect(DEFAULT_STATE_FILENAME).toBe('character.png')
  })
})

describe('useCharacterStatesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('does not trigger for text with no matching keyword', async () => {
    const store = useCharacterStatesStore()

    await expect(store.triggerForText('hôm nay trời đẹp quá')).resolves.toBe(false)
    expect(store.activeState).toBeUndefined()
  })

  it('reverts to the base image through the bundled default keyword', async () => {
    const store = useCharacterStatesStore()

    await expect(store.triggerForText('trở lại bình thường nào')).resolves.toBe(true)
    expect(store.activeState).toBeUndefined()
  })

  it('reset clears the active state so the base character shows again', async () => {
    const store = useCharacterStatesStore()
    store.activeState = { keyword: 'đưa tay lên', filename: 'duatay.png', url: 'https://assets.local/duatay.png' }

    store.reset()

    expect(store.activeState).toBeUndefined()
  })
})
