import type { AgentBackendInfo } from '../../../shared/eventa'
import type { AgentBackendFactory } from './types'

import process from 'node:process'

import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import { createClaudeBackendFromOptions } from './backends/claude'
import { createOpencodeBackendFromOptions } from './backends/opencode'

interface AgentBackendDefinition {
  id: string
  label: string
  description: string
  kind: 'http' | 'cli' | 'acp'
  command: string
  /**
   * False for backends that are listed as selectable options but have no
   * adapter yet. They always report `available: false` so the UI can gray them
   * out instead of failing at start time.
   */
  implemented: boolean
  create?: AgentBackendFactory
}

/**
 * The user-selectable agent backends.
 *
 * opencode and Claude Code are wired to real adapters. Gemini CLI, Codex CLI,
 * and ACP are listed so they show up as future choices; they have no adapter
 * yet and are never reported as available.
 */
export const AGENT_BACKEND_DEFINITIONS: AgentBackendDefinition[] = [
  {
    id: 'opencode',
    label: 'opencode',
    description: 'Local opencode agent session (HTTP server + OpenAI bridge).',
    kind: 'http',
    command: 'opencode',
    implemented: true,
    create: createOpencodeBackendFromOptions,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Claude Code CLI, resumed per turn through its stream-json output.',
    kind: 'cli',
    command: 'claude',
    implemented: true,
    create: createClaudeBackendFromOptions,
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    description: 'Google Gemini CLI (not implemented yet).',
    kind: 'cli',
    command: 'gemini',
    implemented: false,
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    description: 'OpenAI Codex CLI (not implemented yet).',
    kind: 'cli',
    command: 'codex',
    implemented: false,
  },
  {
    id: 'acp',
    label: 'ACP agent',
    description: 'Any agent speaking the Agent Client Protocol (not implemented yet).',
    kind: 'acp',
    command: 'opencode',
    implemented: false,
  },
]

/**
 * Checks whether an executable is reachable on PATH.
 *
 * Node has no built-in `which`, so this mirrors the shell's PATH lookup. On
 * Windows the `.exe` suffix is probed as well.
 */
export function isCommandAvailable(command: string): boolean {
  const pathValue = process.env.PATH
  if (!pathValue)
    return false

  const candidates = process.platform === 'win32' ? [command, `${command}.exe`, `${command}.cmd`] : [command]
  for (const dir of pathValue.split(delimiter)) {
    if (!dir)
      continue
    for (const candidate of candidates) {
      if (existsSync(join(dir, candidate)))
        return true
    }
  }
  return false
}

export function listAgentBackends(): AgentBackendInfo[] {
  return AGENT_BACKEND_DEFINITIONS.map(definition => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    kind: definition.kind,
    command: definition.command,
    available: definition.implemented && isCommandAvailable(definition.command),
  }))
}

export function getAgentBackendDefinition(id: string): AgentBackendDefinition | undefined {
  return AGENT_BACKEND_DEFINITIONS.find(definition => definition.id === id)
}

export type { AgentBackendDefinition }
