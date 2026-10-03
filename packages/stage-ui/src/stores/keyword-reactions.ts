import { defineStore } from 'pinia'
import { ref } from 'vue'

import keywordsMappingJson from '../assets/emoji-videos/keywords.json'

export interface KeywordMapping {
  [keyword: string]: string
}

export type KeywordReactionMediaKind = 'video' | 'image'

export interface KeywordReactionMedia {
  keyword: string
  filename: string
  url: string
  kind: KeywordReactionMediaKind
}

export type ActiveKeywordReaction = KeywordReactionMedia & {
  playbackId: number
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v'])

function reactionMediaKind(filename: string): KeywordReactionMediaKind {
  return VIDEO_EXTENSIONS.has(filename.split('.').pop()?.toLowerCase() ?? '') ? 'video' : 'image'
}

/**
 * Matches the shortest-free, longest-first keyword the text contains; both sides
 * are compared case-insensitively so a keyword like "ăn" also fires on "Ăn".
 */
export function findKeywordReaction(text: string, mapping: KeywordMapping): { keyword: string, filename: string } | undefined {
  const normalized = text.toLowerCase()
  let best: { keyword: string, filename: string } | undefined
  let bestLength = -1

  for (const [keyword, filename] of Object.entries(mapping)) {
    if (!keyword) {
      continue
    }
    const key = keyword.toLowerCase()
    if (!normalized.includes(key)) {
      continue
    }
    if (key.length > bestLength) {
      bestLength = key.length
      best = { keyword, filename }
    }
  }

  return best
}

const keywordReactionsGlob = import.meta.glob<string>('../assets/emoji-videos/*.{mp4,webm,mov,m4v,png,jpg,jpeg}', {
  query: '?url',
  import: 'default',
})

function defaultResolveKeywordReactionUrl(filename: string): Promise<string | undefined> {
  for (const [path, load] of Object.entries(keywordReactionsGlob)) {
    if (path.endsWith(`/${filename}`)) {
      return load()
    }
  }
  return Promise.resolve(undefined)
}

export interface KeywordReactionResolverOptions {
  mapping?: KeywordMapping
  resolveUrl?: (filename: string) => Promise<string | undefined>
}

/**
 * Resolves the best matching reaction media for a sent message, or undefined
 * when no keyword matches or the mapped file is missing from the assets folder.
 * Videos play until they end; images are `kind: 'image'`.
 */
export async function resolveKeywordReaction(
  text: string,
  options: KeywordReactionResolverOptions = {},
): Promise<KeywordReactionMedia | undefined> {
  const mapping = options.mapping ?? keywordsMappingJson
  const resolveUrl = options.resolveUrl ?? defaultResolveKeywordReactionUrl

  const hit = findKeywordReaction(text, mapping)
  if (!hit) {
    return undefined
  }

  const url = await resolveUrl(hit.filename)
  if (!url) {
    return undefined
  }

  return { keyword: hit.keyword, filename: hit.filename, url, kind: reactionMediaKind(hit.filename) }
}

// Images have no `ended` event, so a still reaction auto-reverts to the avatar
// after this long instead of staying on screen indefinitely.
const IMAGE_REACTION_DURATION_MS = 5000

export const useKeywordReactionsStore = defineStore('keyword-reactions', () => {
  const activeReaction = ref<ActiveKeywordReaction | undefined>(undefined)
  let playbackSequence = 0
  let imageReactionTimer: ReturnType<typeof setTimeout> | undefined

  function clearImageReactionTimer() {
    if (imageReactionTimer) {
      clearTimeout(imageReactionTimer)
      imageReactionTimer = undefined
    }
  }

  /** Plays/shows the mapped reaction media when the sent text matches a keyword. */
  async function triggerForText(text: string) {
    const media = await resolveKeywordReaction(text)
    if (!media) {
      return false
    }

    clearImageReactionTimer()
    playbackSequence += 1
    activeReaction.value = { ...media, playbackId: playbackSequence }

    if (media.kind === 'image') {
      imageReactionTimer = setTimeout(() => {
        activeReaction.value = undefined
      }, IMAGE_REACTION_DURATION_MS)
    }
    return true
  }

  /** Clears the active reaction; the static character image shows again. */
  function stopActive() {
    clearImageReactionTimer()
    activeReaction.value = undefined
  }

  return {
    activeReaction,
    triggerForText,
    stopActive,
  }
})
