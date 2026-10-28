<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const BACKEND_KEY = 'settings/agent/backend'
const FALLBACK_BACKEND_ID = 'opencode'
const sessionKey = (backendId: string) => `settings/agent/session/${backendId}`

const backends = [
  { id: 'opencode', label: 'opencode', available: true },
  { id: 'claude-code', label: 'Claude Code', available: true },
]

const currentBackendId = ref<string>(localStorage.getItem(BACKEND_KEY) || FALLBACK_BACKEND_ID)
const open = ref(false)

const backendLabel = computed(() => {
  const backend = backends.find(b => b.id === currentBackendId.value)
  return backend?.label || currentBackendId.value
})

const sessionLabel = computed(() => {
  const sid = localStorage.getItem(sessionKey(currentBackendId.value)) || ''
  if (!sid)
    return ''
  return sid.length > 10 ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : sid
})

const directoryLabel = computed(() => {
  const dir = localStorage.getItem('settings/agent/directory') || ''
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

const tooltipLabel = computed(() => {
  const parts = [`Backend: ${backendLabel.value}`]
  if (sessionLabel.value)
    parts.push(`Session: ${sessionLabel.value}`)
  if (directoryLabel.value)
    parts.push(`Folder: ${directoryLabel.value}`)
  parts.push('Click to switch backend')
  return parts.join(' • ')
})

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
  <div fixed left-3 top-3 z-50>
    <div relative>
      <button
        class="flex items-center gap-1.5 border-2 px-2.5 py-2 transition-all duration-300 ease-in-out border-white/60 bg-white/85 hover:bg-white/95 dark:border-white/10 dark:bg-neutral-900/75 dark:hover:bg-neutral-900/88 rounded-lg"
        :title="tooltipLabel"
        @click="toggle"
      >
        <div class="size-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
        <div text-xs text-neutral-700 font-medium dark:text-neutral-200>
          {{ backendLabel }}
        </div>
        <div v-if="sessionDirLabel" text-xs text-neutral-500 dark:text-neutral-400>
          {{ sessionDirLabel }}
        </div>
        <div i-ph:caret-down text-xs text-neutral-500 dark:text-neutral-400 />
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
            @click="switchBackend(backend.id)"
          >
            <div flex items-center gap-2>
              <div class="size-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              <span text-sm>{{ backend.label }}</span>
            </div>
            <div v-if="backend.id === currentBackendId" i-ph:check text-sm />
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>
