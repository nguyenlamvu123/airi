import type { ElectronDirectoryEntry } from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { electronGetHomeDirectory, electronListDirectory, electronOpenPath } from '../../shared/eventa'
import { getParentPath } from '../libs/file-browser-core'

function createFileBrowserInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)
  return {
    getHomeDirectory: defineInvoke(context, electronGetHomeDirectory),
    listDirectory: defineInvoke(context, electronListDirectory),
    openPath: defineInvoke(context, electronOpenPath),
  }
}

let invokerCache: ReturnType<typeof createFileBrowserInvokers> | undefined

// Lazy: touching `window.electron` at module scope breaks Vitest runs, so the
// context is created on first use (same pattern as the story-teller tool).
function getFileBrowserInvokers() {
  if (!invokerCache)
    invokerCache = createFileBrowserInvokers()
  return invokerCache
}

export const useFileBrowserStore = defineStore('stage-tamagotchi:file-browser', () => {
  const isOpen = ref(false)
  const isLoading = ref(false)
  const errorMessage = ref<string | undefined>()
  const currentPath = ref('')
  const homePath = ref('')
  const entries = shallowRef<ElectronDirectoryEntry[]>([])
  const history = shallowRef<string[]>([])

  async function loadDirectory(path: string): Promise<void> {
    if (!path)
      return

    isLoading.value = true
    errorMessage.value = undefined

    const result = await getFileBrowserInvokers().listDirectory({ path })
    if (!result.ok) {
      errorMessage.value = result.error
      isLoading.value = false
      return
    }

    currentPath.value = result.path
    entries.value = result.entries
    isLoading.value = false
  }

  async function navigateTo(path: string): Promise<void> {
    if (!path || path === currentPath.value)
      return

    history.value = [...history.value, currentPath.value]
    await loadDirectory(path)
  }

  async function openBrowser(): Promise<void> {
    const home = await getFileBrowserInvokers().getHomeDirectory()
    homePath.value = home.path
    history.value = []
    isOpen.value = true
    await loadDirectory(home.path)
  }

  function close(): void {
    isOpen.value = false
    entries.value = []
    errorMessage.value = undefined
  }

  async function goUp(): Promise<void> {
    const parent = getParentPath(currentPath.value)
    if (parent === currentPath.value)
      return
    await navigateTo(parent)
  }

  async function goHome(): Promise<void> {
    await navigateTo(homePath.value)
  }

  async function goBack(): Promise<void> {
    const previous = history.value.at(-1)
    if (!previous)
      return
    history.value = history.value.slice(0, -1)
    await loadDirectory(previous)
  }

  async function openEntry(entry: ElectronDirectoryEntry): Promise<void> {
    if (entry.kind === 'directory') {
      await navigateTo(entry.path)
      return
    }

    const result = await getFileBrowserInvokers().openPath({ path: entry.path })
    if (!result.ok)
      errorMessage.value = result.error
  }

  return {
    isOpen,
    isLoading,
    errorMessage,
    currentPath,
    homePath,
    entries,
    openBrowser,
    close,
    loadDirectory,
    navigateTo,
    goUp,
    goHome,
    goBack,
    openEntry,
  }
})
