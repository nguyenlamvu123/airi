<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { useFileBrowserStore } from '../../../stores/file-browser'

const { t } = useI18n()
const fileBrowser = useFileBrowserStore()
const { isOpen, isLoading, errorMessage, currentPath, entries } = storeToRefs(fileBrowser)

function formatFileSize(bytes?: number): string {
  if (bytes === undefined)
    return ''
  let value = bytes
  let unit = 'B'
  for (const next of ['KB', 'MB', 'GB', 'TB']) {
    if (value < 1024)
      break
    value /= 1024
    unit = next
  }
  const rendered = unit === 'B' || value >= 100 ? Math.round(value).toString() : value.toFixed(1)
  return `${rendered} ${unit}`
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 cubic-bezier(0.32, 0.72, 0, 1)"
    leave-active-class="transition-all duration-200 cubic-bezier(0.32, 0.72, 0, 1)"
    enter-from-class="opacity-0 translate-y-4 scale-95"
    enter-to-class="opacity-100 translate-y-0 scale-100"
    leave-from-class="opacity-100 translate-y-0 scale-100"
    leave-to-class="opacity-0 translate-y-4 scale-95"
  >
    <div
      v-if="isOpen"
      fixed bottom-2 left-2 z-10
      w-80 max-h="[62vh]"
      flex flex-col
    >
      <div
        flex flex-col overflow-hidden rounded-2xl
        border="1 neutral-200 dark:neutral-800"
        class="bg-neutral-100/80 shadow-2xl shadow-black/20 backdrop-blur-xl dark:bg-neutral-900/80"
      >
        <!-- Header -->
        <div
          border="b neutral-200/70 dark:neutral-800/70"
          flex items-center gap-2 px-3 py-2
        >
          <div i-ph:folder-duotone text-lg text-primary-600 dark:text-primary-400 />
          <span text-sm font-medium>
            {{ t('tamagotchi.stage.file-browser.title') }}
          </span>
          <button
            class="grid ml-auto h-6 w-6 place-items-center rounded-md hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
            :aria-label="t('tamagotchi.stage.file-browser.close')"
            @click="fileBrowser.close()"
          >
            <div i-ph:x-bold text-neutral-700 dark:text-neutral-300 />
          </button>
        </div>

        <!-- Toolbar -->
        <div flex items-center gap-1 px-3 py-1.5>
          <button
            class="grid h-7 w-7 place-items-center rounded-md hover:bg-neutral-200/60 disabled:opacity-40 dark:hover:bg-neutral-800/60"
            :disabled="!currentPath"
            :aria-label="t('tamagotchi.stage.file-browser.home')"

            @click="fileBrowser.goHome()"
          >
            <div i-ph:house-bold text-neutral-700 dark:text-neutral-300 />
          </button>
          <button
            class="grid h-7 w-7 place-items-center rounded-md hover:bg-neutral-200/60 disabled:opacity-40 dark:hover:bg-neutral-800/60"
            :disabled="!currentPath || currentPath === '/'"
            :aria-label="t('tamagotchi.stage.file-browser.up')"

            @click="fileBrowser.goUp()"
          >
            <div i-ph:arrow-up-bold text-neutral-700 dark:text-neutral-300 />
          </button>
          <button
            class="grid h-7 w-7 place-items-center rounded-md hover:bg-neutral-200/60 disabled:opacity-40 dark:hover:bg-neutral-800/60"
            :disabled="!currentPath"

            :aria-label="t('tamagotchi.stage.file-browser.reload')"
            @click="fileBrowser.loadDirectory(currentPath)"
          >
            <div i-ph:arrows-clockwise-bold text-neutral-700 dark:text-neutral-300 />
          </button>
        </div>

        <!-- Current path -->
        <div px-3 pb-1.5>
          <div
            class="truncate rounded-md bg-white/60 px-2 py-1 text-xs text-neutral-600 dark:bg-black/30 dark:text-neutral-300"
            :title="currentPath"
          >
            {{ currentPath || '…' }}
          </div>
        </div>

        <!-- Entry list -->
        <div flex-1 overflow-y-auto px-1.5 pb-1.5>
          <div v-if="isLoading" class="flex items-center justify-center gap-2 py-6 text-sm text-neutral-500 dark:text-neutral-400">
            <div i-ph:circle-notch-bold animate-spin />
            {{ t('tamagotchi.stage.file-browser.loading') }}
          </div>
          <div v-else-if="errorMessage" class="px-2 py-6 text-center text-sm text-red-500">
            {{ errorMessage }}
          </div>
          <div v-else-if="entries.length === 0" class="px-2 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            {{ t('tamagotchi.stage.file-browser.empty') }}
          </div>
          <button
            v-for="entry in entries"
            :key="entry.path"
            class="group w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-200/60 dark:text-neutral-200 dark:hover:bg-neutral-800/60"
            :title="entry.path"
            @click="fileBrowser.openEntry(entry)"
          >
            <div
              :class="entry.kind === 'directory' ? 'i-ph:folder-duotone text-primary-600 dark:text-primary-400' : 'i-ph:file-duotone text-neutral-500 dark:text-neutral-400'"
              class="shrink-0 text-lg"
            />
            <span class="flex-1 truncate">{{ entry.name }}</span>
            <span v-if="entry.kind === 'file'" class="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
              {{ formatFileSize(entry.size) }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
