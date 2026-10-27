import type { WebSearchResult } from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { electronOpenExternalUrl, electronSearchWeb } from '../../shared/eventa'

function createWebSearchInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)
  return {
    search: defineInvoke(context, electronSearchWeb),
    openExternal: defineInvoke(context, electronOpenExternalUrl),
  }
}

let invokerCache: ReturnType<typeof createWebSearchInvokers> | undefined

// Lazy: touching `window.electron` at module scope breaks Vitest runs, so the
// context is created on first use (same pattern as the story-teller tool).
function getWebSearchInvokers() {
  if (!invokerCache)
    invokerCache = createWebSearchInvokers()
  return invokerCache
}

export const useWebSearchStore = defineStore('stage-tamagotchi:web-search', () => {
  const isOpen = ref(false)
  const isLoading = ref(false)
  const errorMessage = ref<string | undefined>()
  const query = ref('')
  const results = shallowRef<WebSearchResult[]>([])

  async function search(rawQuery: string): Promise<void> {
    const trimmed = rawQuery.trim()
    if (!trimmed)
      return

    query.value = trimmed
    isOpen.value = true
    isLoading.value = true
    errorMessage.value = undefined
    results.value = []

    const result = await getWebSearchInvokers().search({ query: trimmed })
    if (!result.ok) {
      errorMessage.value = result.error
      isLoading.value = false
      return
    }

    query.value = result.query
    results.value = result.results
    isLoading.value = false
  }

  async function openResult(result: WebSearchResult): Promise<void> {
    const opened = await getWebSearchInvokers().openExternal({ url: result.url })
    if (!opened.ok)
      errorMessage.value = opened.error
  }

  function close(): void {
    isOpen.value = false
    results.value = []
    errorMessage.value = undefined
  }

  return {
    isOpen,
    isLoading,
    errorMessage,
    query,
    results,
    search,
    openResult,
    close,
  }
})
