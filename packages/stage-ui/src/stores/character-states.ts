import type { KeywordMapping } from './keyword-reactions'

import { defineStore } from 'pinia'
import { ref } from 'vue'

import characterStatesMappingJson from '../assets/emoji-videos/states.json'

import { findKeywordReaction } from './keyword-reactions'

/**
 * Reserved filename in `states.json`: mapping a keyword to it reverts the
 * character to its base image instead of switching to another state image.
 * The base character image lives at `assets/characters/character.png`, which is
 * outside the state assets folder, so this sentinel never resolves to a file.
 */
export const DEFAULT_STATE_FILENAME = 'character.png'

export interface CharacterStateMedia {
  keyword: string
  filename: string
  url: string
}

export type ResolvedCharacterState = { kind: 'set', media: CharacterStateMedia } | { kind: 'default' }

export interface CharacterStateResolverOptions {
  mapping?: KeywordMapping
  resolveUrl?: (filename: string) => Promise<string | undefined>
}

const characterStateImagesGlob = import.meta.glob<string>('../assets/emoji-videos/*.{png,jpg,jpeg,webp}', {
  query: '?url',
  import: 'default',
})

function defaultResolveCharacterStateUrl(filename: string): Promise<string | undefined> {
  for (const [path, load] of Object.entries(characterStateImagesGlob)) {
    if (path.endsWith(`/${filename}`)) {
      return load()
    }
  }
  return Promise.resolve(undefined)
}

/**
 * Resolves the best matching character state for a sent message.
 *
 * A hit whose filename is `DEFAULT_STATE_FILENAME` resolves to
 * `{ kind: 'default' }` so the caller switches back to the base character
 * image instead of rendering another overlay. Any other hit requires an
 * existing file in the state assets folder.
 */
export async function resolveCharacterState(
  text: string,
  options: CharacterStateResolverOptions = {},
): Promise<ResolvedCharacterState | undefined> {
  const mapping = options.mapping ?? characterStatesMappingJson
  const resolveUrl = options.resolveUrl ?? defaultResolveCharacterStateUrl

  const hit = findKeywordReaction(text, mapping)
  if (!hit) {
    return undefined
  }

  if (hit.filename === DEFAULT_STATE_FILENAME) {
    return { kind: 'default' }
  }

  const url = await resolveUrl(hit.filename)
  if (!url) {
    return undefined
  }

  return { kind: 'set', media: { keyword: hit.keyword, filename: hit.filename, url } }
}

/**
 * Persistent character state store: a matched keyword swaps the avatar to the
 * mapped state image and keeps it until another state keyword (or the
 * reserved `DEFAULT_STATE_FILENAME` entry) changes it back.
 */
export const useCharacterStatesStore = defineStore('character-states', () => {
  const activeState = ref<CharacterStateMedia | undefined>(undefined)

  /** Switches to the mapped state image (or reverts to the base image) when the sent text matches a keyword. */
  async function triggerForText(text: string) {
    const resolved = await resolveCharacterState(text)
    if (!resolved) {
      return false
    }

    if (resolved.kind === 'default') {
      activeState.value = undefined
    }
    else {
      activeState.value = resolved.media
    }
    return true
  }

  /** Reverts the character to its base image. */
  function reset() {
    activeState.value = undefined
  }

  return {
    activeState,
    triggerForText,
    reset,
  }
})
