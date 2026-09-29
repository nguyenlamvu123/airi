import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findKeywordReaction, resolveKeywordReaction, useKeywordReactionsStore } from './keyword-reactions'

const sampleMapping = {
  'ăn': 'eat.mp4',
  'ăn cơm': 'rice.mp4',
  'ngủ': 'sleep.webm',
  'mèo': 'cat.png',
}

describe('findKeywordReaction', () => {
  it('returns undefined when the text contains no keyword', () => {
    expect(findKeywordReaction('hôm nay trời đẹp quá', sampleMapping)).toBeUndefined()
  })

  it('matches case-insensitively and prefers the longest keyword', () => {
    expect(findKeywordReaction('đi ĂN CƠM thôi', sampleMapping)).toEqual({ keyword: 'ăn cơm', filename: 'rice.mp4' })
    expect(findKeywordReaction('đi ăn thôi', sampleMapping)).toEqual({ keyword: 'ăn', filename: 'eat.mp4' })
    expect(findKeywordReaction('con ĐANG NGỦ', sampleMapping)).toEqual({ keyword: 'ngủ', filename: 'sleep.webm' })
  })

  it('ignores empty keyword entries', () => {
    expect(findKeywordReaction('x', { '': 'nope.mp4' })).toBeUndefined()
  })
})

describe('resolveKeywordReaction', () => {
  it('resolves a video with kind video', async () => {
    const resolveUrl = vi.fn(async (filename: string) => `https://assets.local/${filename}`)

    await expect(resolveKeywordReaction('tao muốn đi ăn cơm', { mapping: sampleMapping, resolveUrl })).resolves.toEqual({
      keyword: 'ăn cơm',
      filename: 'rice.mp4',
      url: 'https://assets.local/rice.mp4',
      kind: 'video',
    })
  })

  it('resolves an image (png/jpg/jpeg) with kind image', async () => {
    const resolveUrl = vi.fn(async (filename: string) => `https://assets.local/${filename}`)

    for (const filename of ['cat.png', 'dog.jpg', 'bird.jpeg']) {
      const mapping = { mèo: filename }
      await expect(resolveKeywordReaction('con mèo đáng yêu quá', { mapping, resolveUrl })).resolves.toEqual({
        keyword: 'mèo',
        filename,
        url: `https://assets.local/${filename}`,
        kind: 'image',
      })
    }
  })

  it('returns undefined when the mapped file is missing', async () => {
    const resolveUrl = vi.fn(async () => undefined)

    await expect(resolveKeywordReaction('đi ăn cơm', { mapping: sampleMapping, resolveUrl })).resolves.toBeUndefined()
  })

  it('does not resolve a url when no keyword matched', async () => {
    const resolveUrl = vi.fn(async () => 'https://assets.local/x.mp4')

    await expect(resolveKeywordReaction('không có gì ở đây', { mapping: sampleMapping, resolveUrl })).resolves.toBeUndefined()
    expect(resolveUrl).not.toHaveBeenCalled()
  })
})

describe('useKeywordReactionsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('does not trigger with the default (empty) mapping', async () => {
    const store = useKeywordReactionsStore()

    await expect(store.triggerForText('ăn')).resolves.toBe(false)
    expect(store.activeReaction).toBeUndefined()
  })

  it('stopActive clears the active reaction so the image avatar returns', async () => {
    const store = useKeywordReactionsStore()
    store.activeReaction = { keyword: 'ăn', filename: 'eat.mp4', url: 'https://assets.local/eat.mp4', kind: 'video', playbackId: 1 }

    store.stopActive()

    expect(store.activeReaction).toBeUndefined()
  })
})
