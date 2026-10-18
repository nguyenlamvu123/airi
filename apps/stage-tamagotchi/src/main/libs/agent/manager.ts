import type { AgentBackendStatus } from '../../../shared/eventa'
import type { AgentProxy } from './proxy'

import process from 'node:process'

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { startAgentProxy } from './proxy'
import { getAgentBackendDefinition, isCommandAvailable } from './registry'

export interface EnsureAgentBackendOptions {
  backendId: string
  /** Explicit project directory; falls back to `startDirectory` discovery. */
  directory?: string
  /** Where discovery starts when `directory` is omitted (usually `process.cwd()`). */
  startDirectory?: string
  /** Executable override for CLI/HTTP backends. */
  commandPath?: string
  /** Persisted session id to resume, from a previous run. */
  resumeSessionID?: string
}

/**
 * Resolves the directory an agent should treat as its project root.
 *
 * Preference order:
 * 1. An explicit directory from the caller (user setting / request).
 * 2. The nearest ancestor of `startDirectory` containing `pnpm-workspace.yaml`,
 *    which in this repository is the monorepo root.
 * 3. `startDirectory` itself when no workspace marker is found (packaged app).
 */
export function resolveAgentDirectory(startDirectory: string, explicit?: string): string {
  const requested = explicit?.trim()
  if (requested)
    return requested

  let current = startDirectory
  // Walk up until the filesystem root; `dirname` returns the same path there.
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml')))
      return current
    const parent = dirname(current)
    if (parent === current)
      return startDirectory
    current = parent
  }
}

export interface AgentBackendManager {
  ensure: (options: EnsureAgentBackendOptions) => Promise<AgentBackendStatus>
  status: () => AgentBackendStatus
  stop: () => Promise<void>
}

interface ActiveBackend {
  backendId: string
  directory: string
  proxy: AgentProxy
  serverBaseUrl?: string
  close: () => Promise<void>
}

/**
 * Owns the single active agent backend + proxy for the main process.
 *
 * Switching the backend id or the project directory tears the previous pair
 * down first, so ports and session state never mix between backends or
 * repositories. Concurrent `ensure` calls share one in-flight start.
 */
export function createAgentBackendManager(): AgentBackendManager {
  let active: ActiveBackend | undefined
  let starting: Promise<AgentBackendStatus> | undefined
  let lastError: string | undefined

  function snapshot(): AgentBackendStatus {
    return {
      running: active != null,
      backendId: active?.backendId,
      proxyBaseUrl: active?.proxy.baseUrl,
      serverBaseUrl: active?.serverBaseUrl,
      // The proxy owns the live session; it updates after each turn when a
      // backend mints the id lazily.
      sessionID: active?.proxy.getSessionID(),
      directory: active?.directory,
      // Only surface an error while nothing is running; a stale error must not
      // mask a healthy backend.
      error: active ? undefined : lastError,
    }
  }

  async function stop() {
    const current = active
    active = undefined
    if (current)
      await current.close()
  }

  async function start(options: EnsureAgentBackendOptions, directory: string): Promise<AgentBackendStatus> {
    const definition = getAgentBackendDefinition(options.backendId)
    if (!definition || !definition.create)
      throw new Error(`Agent backend "${options.backendId}" is not supported yet`)
    if (!options.commandPath && !isCommandAvailable(definition.command))
      throw new Error(`Agent backend "${definition.label}" is not installed (missing "${definition.command}")`)

    const instance = await definition.create({ directory, commandPath: options.commandPath })
    try {
      const session = await instance.transport.createSession({ title: 'AIRI', resumeSessionID: options.resumeSessionID })
      const proxy = await startAgentProxy({ transport: instance.transport, sessionID: session.id })

      active = {
        backendId: options.backendId,
        directory,
        proxy,
        serverBaseUrl: instance.serverBaseUrl,
        async close() {
          await proxy.close()
          await instance.close()
        },
      }
      lastError = undefined
      return snapshot()
    }
    catch (error) {
      await instance.close().catch(() => {})
      throw error
    }
  }

  return {
    async ensure(options) {
      const directory = resolveAgentDirectory(options.startDirectory ?? process.cwd(), options.directory)

      // Reuse the running backend for the same id + directory; a resume hint for
      // an already-running session is redundant and safely ignored.
      if (active && active.backendId === options.backendId && active.directory === directory)
        return snapshot()

      if (starting)
        return starting

      if (active)
        await stop()

      starting = start(options, directory)
        .catch((error) => {
          lastError = errorMessageFrom(error) ?? 'Unknown error'
          return snapshot()
        })
        .finally(() => {
          starting = undefined
        })

      return starting
    },

    status: snapshot,

    stop,
  }
}

/**
 * Process-wide manager used by the Eventa handlers in the main process.
 *
 * Exposed as a module singleton (rather than DI) because the base-window invoke
 * setup runs once per window and all windows must observe the same backend.
 */
export const agentBackendManager = createAgentBackendManager()
