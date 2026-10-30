<script setup lang="ts">
import type { AgentBackendInfo, AgentBackendStatus } from '../../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { ChatActiveSessionName } from '@proj-airi/stage-ui/components/scenarios/chat'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useClipboard } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import ControlButtonTooltip from '../controls-island/control-button-tooltip.vue'
import ControlButton from '../controls-island/control-button.vue'

import { useAgentBackend } from '../../../composables/use-agent-backend'

const { t } = useI18n()
const { getBackends, getStatus, selectedBackendId, setBackend, storedSessionID } = useAgentBackend()
const chatOrchestrator = useChatOrchestratorStore()
const { copy } = useClipboard({ legacy: true })

const backends = ref<AgentBackendInfo[]>([])
const currentBackendId = ref<string>(selectedBackendId())
const status = ref<AgentBackendStatus>()
const open = ref(false)
const loading = ref(false)

const backendLabel = computed(() => {
  const backend = backends.value.find(b => b.id === currentBackendId.value)
  return backend?.label || currentBackendId.value
})

// The agent's own session id (what the next launch resumes), not AIRI's chat
// session, which the row above it names. Before the first turn of this launch
// only the id stored by an earlier launch exists.
const agentSessionID = computed(() =>
  (status.value?.backendId === currentBackendId.value && status.value.sessionID)
  || storedSessionID(currentBackendId.value)
  || '')

const agentSessionLabel = computed(() => {
  const sid = agentSessionID.value
  return sid.length > 16 ? `${sid.slice(0, 10)}…${sid.slice(-4)}` : sid
})

const directory = computed(() => (status.value?.backendId === currentBackendId.value && status.value.directory) || '')

const directoryLabel = computed(() => {
  const parts = directory.value.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || directory.value
})

const agentSessionTitle = computed(() => {
  const parts = [`${t('stage.agent-backend.session')}: ${agentSessionID.value || t('stage.agent-backend.session-pending')}`]
  if (directory.value)
    parts.push(`${t('stage.agent-backend.folder')}: ${directory.value}`)
  if (agentSessionID.value)
    parts.push(t('stage.agent-backend.copy-session'))
  return parts.join('\n')
})

const isRunning = computed(() => status.value?.running === true && status.value.backendId === currentBackendId.value)

const tooltipLabel = computed(() => {
  const parts = [`${t('stage.agent-backend.title')}: ${backendLabel.value}`]
  if (!isRunning.value) {
    parts.push(status.value?.error
      ? t('stage.agent-backend.not-running-error', { error: status.value.error })
      : t('stage.agent-backend.not-running'))
  }
  parts.push(t('stage.agent-backend.switch'))
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

async function refreshStatus() {
  try {
    currentBackendId.value = selectedBackendId()
    status.value = await getStatus()
  }
  catch (error) {
    console.warn('[agent-backend-indicator] failed to read status:', error)
  }
}

async function refresh() {
  try {
    backends.value = await getBackends()
  }
  catch (error) {
    console.warn('[agent-backend-indicator] failed to list backends:', error)
  }
  await refreshStatus()
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

async function copyAgentSession() {
  if (!agentSessionID.value)
    return
  await copy(agentSessionID.value)
  toast.success(t('stage.agent-backend.session-copied'))
}

let stopTurnRefresh: (() => void) | undefined

onMounted(() => {
  void refresh()
  // CLI backends mint their session id on the first answer. Without this the
  // session row kept showing the pending text until the dropdown was opened.
  stopTurnRefresh = chatOrchestrator.onChatTurnComplete(() => refreshStatus())
})

onUnmounted(() => {
  stopTurnRefresh?.()
  stopTurnRefresh = undefined
})

function toggle() {
  open.value = !open.value
  if (open.value)
    void refresh()
}
</script>

<template>
  <div :class="['fixed left-3 top-3 z-20', 'flex flex-col items-start gap-1.5']">
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
          absolute left-0 top-full z-10 mt-2 min-w-48 overflow-hidden rounded-xl shadow-lg backdrop-blur-md
        >
          <div px-2.5 py-1.5 text-xs text-neutral-500 dark:text-neutral-400>
            {{ t('stage.agent-backend.title') }}
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
                {{ t('stage.agent-backend.unavailable') }}
              </div>
            </div>
            <div v-if="backend.id === currentBackendId" i-ph:check text-sm />
          </button>
        </div>
      </Transition>
    </div>

    <!-- Session card: AIRI's chat session on top, the agent's own session below. -->
    <div
      :class="[
        'max-w-64 flex flex-col gap-1 px-2.5 py-1.5',
        'rounded-xl border-2 border-white/60 bg-white/85 backdrop-blur-md dark:border-white/10 dark:bg-neutral-900/75',
        'text-xs text-neutral-500 dark:text-neutral-400',
      ]"
    >
      <ChatActiveSessionName :class="['font-medium text-neutral-700 dark:text-neutral-200']" />
      <button
        :class="[
          'min-w-0 flex items-center gap-1.5 text-left',
          agentSessionID ? 'cursor-pointer hover:text-primary-600 dark:hover:text-primary-400' : 'cursor-default',
        ]"
        :title="agentSessionTitle"
        :disabled="!agentSessionID"
        @click="copyAgentSession"
      >
        <div :class="['i-ph:terminal-window shrink-0']" />
        <span v-if="agentSessionID" :class="['truncate font-mono']">{{ agentSessionLabel }}</span>
        <span v-else :class="['truncate']">{{ t('stage.agent-backend.session-pending') }}</span>
        <span v-if="directoryLabel" :class="['shrink-0']">• {{ directoryLabel }}</span>
      </button>
    </div>
  </div>
</template>
