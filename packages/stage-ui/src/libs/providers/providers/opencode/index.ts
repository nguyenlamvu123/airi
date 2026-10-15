import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { ProviderValidationCheck } from '../../types'
import { createOpenAICompatibleValidators } from '../../validators'
import { defineProvider } from '../registry'

/**
 * Default base URL of AIRI's local opencode bridge.
 *
 * The desktop main process spawns `opencode serve` plus an OpenAI-compatible
 * proxy; the renderer rewrites this value at boot to the proxy's actual URL
 * (`electronOpencodeEnsure`). The static default keeps the settings page usable
 * when the bridge is not running and documents the intended endpoint.
 */
const DEFAULT_OPENCODE_BASE_URL = 'http://127.0.0.1:46800/v1'

const opencodeConfigSchema = z.object({
  baseUrl: z
    .string('Base URL')
    .default(DEFAULT_OPENCODE_BASE_URL),
})

type OpencodeConfig = z.input<typeof opencodeConfigSchema>

/**
 * Chat provider that proxies to a local `opencode` agent session.
 *
 * The heavy lifting (spawning opencode, mapping its event stream) lives in the
 * desktop main process; from the renderer's point of view this is just another
 * OpenAI-compatible endpoint whose real model is chosen by opencode itself.
 */
export const providerOpencode = defineProvider<OpencodeConfig>({
  id: 'opencode',
  order: 3,
  name: 'OpenCode',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.opencode.title'),
  description: 'Run a local opencode agent session as the chat backend.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.opencode.description'),
  tasks: ['chat'],
  icon: 'i-lobe-icons:opencode',
  // The bridge needs no API key: it talks to a locally spawned opencode server.
  requiresCredentials: false,

  createProviderConfig: ({ t }) => opencodeConfigSchema.extend({
    baseUrl: opencodeConfigSchema.shape.baseUrl.meta({
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
  // provider behind credential validation. Reachability checks are light.
  validationRequiredWhen: () => false,
  validators: {
    ...createOpenAICompatibleValidators({
      checks: [ProviderValidationCheck.Connectivity, ProviderValidationCheck.ModelList],
    }),
  },
})
