import type { WebSearchResult } from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { electronOpenExternalUrl, electronSearchWeb } from '../../shared/eventa'
import { duckDuckGoResultsUrl } from '../../shared/web-search'

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

  // Bumped per search so a slow response cannot overwrite a newer query.
  let searchRequest = 0

  // Never rejects: chat-sync fires it without awaiting, so IPC failures land in
  // `errorMessage` and the spinner always stops.
  async function search(rawQuery: string): Promise<void> {
    const trimmed = rawQuery.trim()
    if (!trimmed)
      return

    const request = ++searchRequest
    query.value = trimmed
    isOpen.value = true
    isLoading.value = true
    errorMessage.value = undefined
    results.value = []

    try {
      const result = await getWebSearchInvokers().search({ query: trimmed })
      if (request !== searchRequest)
        return
      if (!result.ok) {
        errorMessage.value = result.error
        return
      }

      query.value = result.query
      results.value = result.results
    }
    catch (error) {
      if (request === searchRequest)
        errorMessage.value = errorMessageFrom(error) ?? 'Web search failed'
    }
    finally {
      if (request === searchRequest)
        isLoading.value = false
    }
  }

  async function openUrl(url: string): Promise<void> {
    try {
      const opened = await getWebSearchInvokers().openExternal({ url })
      if (!opened.ok)
        errorMessage.value = opened.error
    }
    catch (error) {
      errorMessage.value = errorMessageFrom(error) ?? 'Failed to open the link'
    }
  }

  async function openResult(result: WebSearchResult): Promise<void> {
    await openUrl(result.url)
  }

  /** Opens the full DuckDuckGo results page for the current query in the browser. */
  async function openFullResults(): Promise<void> {
    if (query.value)
      await openUrl(duckDuckGoResultsUrl(query.value))
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
    openFullResults,
    close,
  }
})
