<script setup lang="ts">
import { ChatActiveSessionName } from '@proj-airi/stage-ui/components/scenarios/chat'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Same storage key and fallback as the desktop app's `useAgentBackend`.
 *
 * The web build cannot spawn agent backends (no Electron main process, and the
 * desktop proxy wants a per-launch token the browser never sees), so here the
 * choice is only remembered. The gray dot, tooltip and dropdown note say so
 * instead of pretending a backend is running.
 */
const BACKEND_KEY = 'settings/agent/backend'
const FALLBACK_BACKEND_ID = 'opencode'

const backends = [
  { id: 'opencode', label: 'opencode' },
  { id: 'claude-code', label: 'Claude Code' },
]

const { t } = useI18n()

const currentBackendId = ref<string>(localStorage.getItem(BACKEND_KEY) || FALLBACK_BACKEND_ID)
const open = ref(false)

const backendLabel = computed(() => {
  const backend = backends.find(b => b.id === currentBackendId.value)
  return backend?.label || currentBackendId.value
})

const tooltipLabel = computed(() => [
  `${t('stage.agent-backend.title')}: ${backendLabel.value}`,
  t('stage.agent-backend.desktop-only'),
  t('stage.agent-backend.switch'),
].join(' • '))

function switchBackend(backendId: string) {
  if (backendId === currentBackendId.value)
    return
  currentBackendId.value = backendId
  localStorage.setItem(BACKEND_KEY, backendId)
  open.value = false
}

function toggle() {
  open.value = !open.value
}
</script>

<template>
  <!-- md+ drops below the header so the button does not cover the AIRI logo. -->
  <div :class="['fixed left-3 top-3 z-50 md:top-20', 'flex flex-col items-start gap-1.5']">
    <div relative>
      <button
        :class="[
          'flex items-center gap-1.5 px-2.5 py-2 rounded-xl',
          'border-2 border-neutral-200/60 bg-neutral-50/80 hover:bg-neutral-100/90 dark:border-neutral-800/10 dark:bg-neutral-800/70 dark:hover:bg-neutral-800/90',
          'transition-all duration-300 ease-in-out backdrop-blur-md',
        ]"
        :aria-label="tooltipLabel"
        :title="tooltipLabel"
        @click="toggle"
      >
        <div :class="['size-2 rounded-full bg-neutral-400 dark:bg-neutral-500']" />
        <div :class="['text-xs text-neutral-700 font-medium dark:text-neutral-200']">
          {{ backendLabel }}
        </div>
        <div :class="['i-ph:caret-down text-xs text-neutral-500 dark:text-neutral-400']" />
      </button>

      <Transition
        enter-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-150"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="open"
          :class="[
            'absolute left-0 top-full z-10 mt-2 w-64 overflow-hidden rounded-xl shadow-lg backdrop-blur-md',
            'border-2 border-white/60 bg-white/90 dark:border-white/10 dark:bg-neutral-900/90',
          ]"
        >
          <div :class="['px-2.5 py-1.5 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('stage.agent-backend.title') }}
          </div>
          <button
            v-for="backend in backends"
            :key="backend.id"
            :class="[
              'w-full flex items-center justify-between px-2.5 py-1.5 text-left',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800',
              backend.id === currentBackendId ? 'text-primary-600 dark:text-primary-400' : 'text-neutral-700 dark:text-neutral-200',
            ]"
            @click="switchBackend(backend.id)"
          >
            <div :class="['flex items-center gap-2']">
              <div :class="['size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500']" />
              <span :class="['text-sm']">{{ backend.label }}</span>
            </div>
            <div v-if="backend.id === currentBackendId" :class="['i-ph:check text-sm']" />
          </button>
          <div :class="['px-2.5 py-1.5 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('stage.agent-backend.desktop-only') }}
          </div>
        </div>
      </Transition>
    </div>

    <div
      :class="[
        'max-w-64 px-2.5 py-1.5',
        'rounded-xl border-2 border-neutral-200/60 bg-neutral-50/80 backdrop-blur-md dark:border-neutral-800/10 dark:bg-neutral-800/70',
        'text-xs text-neutral-700 font-medium dark:text-neutral-200',
      ]"
    >
      <ChatActiveSessionName />
    </div>
  </div>
</template>
