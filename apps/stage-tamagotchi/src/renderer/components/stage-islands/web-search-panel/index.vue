<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { useWebSearchStore } from '../../../stores/web-search'

const { t } = useI18n()
const webSearch = useWebSearchStore()
const { isOpen, isLoading, errorMessage, query, results } = storeToRefs(webSearch)

function displayUrl(url: string): string {
  try {
    return new URL(url).hostname
  }
  catch {
    return url
  }
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 cubic-bezier(0.32, 0.72, 0, 1)"
    leave-active-class="transition-all duration-200 cubic-bezier(0.32, 0.72, 0, 1)"
    enter-from-class="opacity-0 -translate-y-4 scale-95"
    enter-to-class="opacity-100 translate-y-0 scale-100"
    leave-from-class="opacity-100 translate-y-0 scale-100"
    leave-to-class="opacity-0 -translate-y-4 scale-95"
  >
    <div
      v-if="isOpen"

      max-h="[62vh]"
      fixed right-2 top-2 z-10 w-96 flex flex-col
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
          <div i-ph:magnifying-glass-duotone text-lg text-primary-600 dark:text-primary-400 />
          <span flex-1 truncate text-sm font-medium>
            {{ t('tamagotchi.stage.web-search.title') }}
          </span>
          <button
            class="grid ml-auto h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
            :aria-label="t('tamagotchi.stage.web-search.close')"
            @click="webSearch.close()"
          >
            <div i-ph:x-bold text-neutral-700 dark:text-neutral-300 />
          </button>
        </div>

        <!-- Query -->
        <div px-3 py-1.5>
          <div
            class="truncate rounded-md bg-white/60 px-2 py-1 text-xs text-neutral-600 dark:bg-black/30 dark:text-neutral-300"
            :title="query"
          >
            {{ query }}
          </div>
        </div>

        <!-- Result list -->
        <div flex-1 overflow-y-auto px-1.5 pb-1.5>
          <div v-if="isLoading" class="flex items-center justify-center gap-2 py-6 text-sm text-neutral-500 dark:text-neutral-400">
            <div i-ph:circle-notch-bold animate-spin />
            {{ t('tamagotchi.stage.web-search.loading') }}
          </div>
          <div v-else-if="errorMessage" class="px-2 py-6 text-center text-sm text-red-500">
            {{ errorMessage }}
          </div>
          <div v-else-if="results.length === 0" class="px-2 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            {{ t('tamagotchi.stage.web-search.empty') }}
          </div>
          <button
            v-for="(result, index) in results"
            :key="`${index}-${result.url}`"
            class="group w-full flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
            :title="result.url"
            @click="webSearch.openResult(result)"
          >
            <span class="line-clamp-1 text-sm text-neutral-800 font-medium dark:text-neutral-100">
              {{ result.title }}
            </span>
            <span class="line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">
              {{ result.snippet }}
            </span>
            <span class="truncate text-[11px] text-primary-600 dark:text-primary-400">
              {{ displayUrl(result.url) }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
