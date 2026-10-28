<script setup lang="ts">
import type { AgentBackendInfo, AgentBackendStatus } from '../../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'

import ControlButtonTooltip from '../controls-island/control-button-tooltip.vue'
import ControlButton from '../controls-island/control-button.vue'

import { useAgentBackend } from '../../../composables/use-agent-backend'

const { getBackends, getStatus, selectedBackendId, setBackend, storedSessionID } = useAgentBackend()

const backends = ref<AgentBackendInfo[]>([])
const currentBackendId = ref<string>(selectedBackendId())
const status = ref<AgentBackendStatus>()
const open = ref(false)
const loading = ref(false)

const backendLabel = computed(() => {
  const backend = backends.value.find(b => b.id === currentBackendId.value)
  return backend?.label || currentBackendId.value
})

// The agent's own session id, not AIRI's chat session id: this is what gets
// resumed on the next launch. Before the first turn only the stored id exists.
const sessionLabel = computed(() => {
  const sid = (status.value?.backendId === currentBackendId.value && status.value.sessionID)
    || storedSessionID(currentBackendId.value)
    || ''
  if (!sid)
    return ''
  return sid.length > 10 ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : sid
})

const directoryLabel = computed(() => {
  const dir = (status.value?.backendId === currentBackendId.value && status.value.directory) || ''
  if (!dir)
    return ''
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || dir
})

const sessionDirLabel = computed(() => {
  const s = sessionLabel.value
  const d = directoryLabel.value
  if (s && d)
    return `${s} • ${d}`
  if (s)
    return s
  if (d)
    return d
  return ''
})

const isRunning = computed(() => status.value?.running === true && status.value.backendId === currentBackendId.value)

const tooltipLabel = computed(() => {
  const parts = [`Backend: ${backendLabel.value}`]
  if (sessionLabel.value)
    parts.push(`Session: ${sessionLabel.value}`)
  if (directoryLabel.value)
    parts.push(`Folder: ${directoryLabel.value}`)
  if ((status.value?.backendId === currentBackendId.value && status.value.directory))
    parts.push(`Path: ${status.value.directory}`)
  if (!isRunning.value)
    parts.push(status.value?.error ? `Not running: ${status.value.error}` : 'Not running')
  parts.push('Click to switch backend')
  return parts.join(' • ')
})

// Gray: not installed. Red: selected but not running (failed start or stopped).
// Green: the selected backend's proxy is up; the backend process itself still
// launches lazily on the first message.
const statusDotClass = computed(() => {
  const backend = backends.value.find(b => b.id === currentBackendId.value)
  if (backend && !backend.available)
    return 'bg-neutral-400 dark:bg-neutral-500'
  if (!isRunning.value)
    return 'bg-red-500 dark:bg-red-400'
  return 'bg-emerald-500 dark:bg-emerald-400'
})

async function refresh() {
  try {
    backends.value = await getBackends()
    currentBackendId.value = selectedBackendId()
    status.value = await getStatus()
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
    await setBackend(backendId)
  }
  catch (error) {
    // The previous backend keeps running and stays selected.
    toast.error(errorMessageFrom(error) ?? `Failed to switch to "${backendId}"`)
  }
  finally {
    await refresh()
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
            <div text-xs text-neutral-700 font-medium dark:text-neutral-200>
              {{ backendLabel }}
            </div>
            <div v-if="sessionDirLabel" text-xs text-neutral-500 dark:text-neutral-400>
              {{ sessionDirLabel }}
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

          border="2 white/60 dark:white/10"
          bg="white/90 dark:neutral-900/90"
          absolute left-0 top-full mt-2 min-w-48 overflow-hidden rounded-xl shadow-lg backdrop-blur-md
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
