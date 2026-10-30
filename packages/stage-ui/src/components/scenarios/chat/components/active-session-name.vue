<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useChatSessionStore } from '../../../../stores/chat/session-store'
import { sessionPreview } from './session-preview'

/**
 * One-line name of the chat session the stage is talking in, the same name
 * the sessions drawer lists for it. Display only: switching sessions stays in
 * the drawer. Text size and color come from the parent.
 */

const { t } = useI18n()
const { activeSessionId, sessionMetas, sessionMessages } = storeToRefs(useChatSessionStore())

const name = computed(() => {
  const meta = sessionMetas.value[activeSessionId.value]
  // No meta while the session store is still hydrating, and no title or
  // message in a fresh session: both are a new chat as far as the user knows.
  if (!meta)
    return t('stage.chat.sessions.new-chat-fallback')
  return sessionPreview(meta, sessionMessages.value[meta.sessionId]) ?? t('stage.chat.sessions.new-chat-fallback')
})
</script>

<template>
  <div
    :class="['flex items-center gap-1.5 min-w-0']"
    :title="`${t('stage.chat.sessions.current')}: ${name}`"
  >
    <div :class="['i-ph:chat-circle-text shrink-0']" />
    <span :class="['truncate']">{{ name }}</span>
  </div>
</template>
