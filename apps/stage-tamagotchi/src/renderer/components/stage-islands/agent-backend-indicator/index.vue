<script setup lang="ts">
import type { AgentBackendInfo } from '../../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'

import { electronAgentBackendStatus } from '../../../../shared/eventa'
import { useAgentBackend } from '../../../composables/use-agent-backend'
import ControlButton from '../controls-island/control-button.vue'
import ControlButtonTooltip from '../controls-island/control-button-tooltip.vue'

const BACKEND_KEY = 'settings/agent/backend'
const FALLBACK_BACKEND_ID = 'opencode'
const sessionKey = (backendId: string) => `settings/agent/session/${backendId}`

const { getBackends, setBackend } = useAgentBackend()
const getStatus = useElectronEventaInvoke(electronAgentBackendStatus)
const chatSessionStore = useChatSessionStore()
const { activeSessionId } = storeToRefs(chatSessionStore)

const backends = ref<AgentBackendInfo[]>([])
const currentBackendId = ref<string>(localStorage.getItem(BACKEND_KEY) || FALLBACK_BACKEND_ID)
const statusSessionId = ref<string>('')
const open = ref(false)
const loading = ref(false)

const backendLabel = computed(() => {
  const backend = backends.value.find(b => b.id === currentBackendId.value)
  return backend?.label || currentBackendId.value
})

const sessionLabel = computed(() => {
  const sid = activeSessionId.value || statusSessionId.value || localStorage.getItem(sessionKey(currentBackendId.value)) || ''
  if (!sid)
    return ''
  return sid.length > 10 ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : sid
})

const tooltipLabel = computed(() => {
  const parts = [`Backend: ${backendLabel.value}`]
  if (sessionLabel.value)
    parts.push(`Session: ${sessionLabel.value}`)
  parts.push('Click to switch backend')
  return parts.join(' • ')
})

const statusDotClass = computed(() => {
  const backend = backends.value.find(b => b.id === currentBackendId.value)
  if (backend && !backend.available)
    return 'bg-neutral-400 dark:bg-neutral-500'
  return 'bg-emerald-500 dark:bg-emerald-400'
})

async function refresh() {
  try {
    backends.value = await getBackends()
    currentBackendId.value = localStorage.getItem(BACKEND_KEY) || FALLBACK_BACKEND_ID
    try {
      const status = await getStatus()
      statusSessionId.value = status.sessionID || ''
    }
    catch {}
  }
  catch (error) {
    console.warn('[agent-backend-indicator] failed to refresh:', error)
  }
}

async function switchBackend(backendId: string) {
  if (loading.value || backendId === currentBackendId.value)
    return
  loading.value = true
  try {
    const status = await setBackend(backendId)
    if (status.running)
      currentBackendId.value = backendId
    await refresh()
  }
  catch (error) {
    console.warn('[agent-backend-indicator] failed to switch backend:', error)
  }
  finally {
    loading.value = false
    open.value = false
  }
}

onMounted(() => {
  void refresh()
})

function toggle() {
  open.value = !open.value
  if (open.value)
    void refresh()
}
</script>

<template>
  <div fixed left-3 top-3 z-20>
    <div relative>
      <ControlButtonTooltip side="right">
        <ControlButton
          button-style="border-2 px-2.5 py-2 transition-all duration-300 ease-in-out border-white/60 bg-white/85 hover:bg-white/95 dark:border-white/10 dark:bg-neutral-900/75 dark:hover:bg-neutral-900/88"
          :aria-label="tooltipLabel"
          :title="tooltipLabel"
          @click="toggle"
        >
          <div flex items-center gap-1.5>
            <div :class="['size-2 rounded-full', statusDotClass]" />
            <div text-xs font-medium text-neutral-700 dark:text-neutral-200>
              {{ backendLabel }}
            </div>
            <div v-if="sessionLabel" text-xs text-neutral-500 dark:text-neutral-400>
              {{ sessionLabel }}
            </div>
            <div i-ph:caret-down text-xs text-neutral-500 dark:text-neutral-400 />
          </div>
        </ControlButton>
        <template #tooltip>
          {{ tooltipLabel }}
        </template>
      </ControlButtonTooltip>

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
          absolute left-0 top-full mt-2 min-w-48
          border="2 white/60 dark:white/10"
          bg="white/90 dark:neutral-900/90"
          backdrop-blur-md rounded-xl shadow-lg overflow-hidden
        >
          <div px-2.5 py-1.5 text-xs text-neutral-500 dark:text-neutral-400>
            Agent backend
          </div>
          <button
            v-for="backend in backends"
            :key="backend.id"
            w-full flex items-center justify-between px-2.5 py-1.5 text-left
            hover="bg-neutral-100 dark:bg-neutral-800"
            :class="backend.id === currentBackendId ? 'text-primary-600 dark:text-primary-400' : 'text-neutral-700 dark:text-neutral-200'"
            :disabled="loading || !backend.available"
            @click="switchBackend(backend.id)"
          >
            <div flex items-center gap-2>
              <div :class="['size-1.5 rounded-full', backend.available ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-neutral-400 dark:bg-neutral-500']" />
              <div text-sm>
                {{ backend.label }}
              </div>
              <div v-if="!backend.available" text-xs text-neutral-400>
                (unavailable)
              </div>
            </div>
            <div v-if="backend.id === currentBackendId" i-ph:check text-sm />
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>
