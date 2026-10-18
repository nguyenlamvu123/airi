import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { ProviderValidationCheck } from '../../types'
import { createOpenAICompatibleValidators } from '../../validators'
import { defineProvider } from '../registry'

/**
 * Default base URL of AIRI's local Claude Code bridge.
 *
 * The desktop main process spawns `claude` and wraps it in an
 * OpenAI-compatible proxy; the renderer rewrites this value at boot to the
 * proxy's actual URL (`electronAgentBackendEnsure`). The static default keeps
 * the settings page usable when the bridge is not running.
 */
const DEFAULT_CLAUDE_CODE_BASE_URL = 'http://127.0.0.1:46801/v1'

const claudeCodeConfigSchema = z.object({
  baseUrl: z
    .string('Base URL')
    .default(DEFAULT_CLAUDE_CODE_BASE_URL),
})

type ClaudeCodeConfig = z.input<typeof claudeCodeConfigSchema>

/**
 * Chat provider that proxies to a local Claude Code agent session.
 *
 * Spawning `claude`, resuming sessions, and mapping its stream-json output all
 * happen in the desktop main process; from the renderer's point of view this is
 * another OpenAI-compatible endpoint whose real model is chosen by Claude Code.
 */
export const providerClaudeCode = defineProvider<ClaudeCodeConfig>({
  id: 'claude-code',
  order: 4,
  name: 'Claude Code',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.claude-code.title'),
  description: 'Run a local Claude Code agent session as the chat backend.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.claude-code.description'),
  tasks: ['chat'],
  icon: 'i-simple-icons:anthropic',
  // The bridge needs no API key: Claude Code authenticates on its own.
  requiresCredentials: false,

  createProviderConfig: ({ t }) => claudeCodeConfigSchema.extend({
    baseUrl: claudeCodeConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    // No API key: the local bridge ignores it.
    return createOpenAI('', config.baseUrl)
  },

  // The bridge is managed by the desktop main process, so we never gate the
  // provider behind credential validation.
  validationRequiredWhen: () => false,
  validators: {
    ...createOpenAICompatibleValidators({
      checks: [ProviderValidationCheck.Connectivity, ProviderValidationCheck.ModelList],
    }),
  },
})
