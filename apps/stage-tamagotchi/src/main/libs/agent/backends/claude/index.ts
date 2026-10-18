import type { AgentBackendFactory } from '../../types'

import { createClaudeTransport } from './transport'

/**
 * Registry-facing factory for the Claude Code backend. Claude Code has no
 * long-running process, so there is nothing to close.
 */
export const createClaudeBackendFromOptions: AgentBackendFactory = async options => ({
  transport: createClaudeTransport({
    directory: options.directory,
    command: options.commandPath,
  }),
  close: async () => {},
})
