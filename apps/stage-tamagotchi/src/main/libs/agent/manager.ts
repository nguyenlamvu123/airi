import type { AgentBackendStatus } from '../../../shared/eventa'
import type { AgentProxy } from './proxy'
import type { AgentBackendFactory, AgentBackendInstance, AgentTransport } from './types'

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
  /** Undefined until the first chat request launches the backend. */
  getServerBaseUrl: () => string | undefined
  close: () => Promise<void>
}

/**
 * Owns the single active agent backend + proxy for the main process.
 *
 * Switching the backend id or the project directory tears the previous pair
 * down first, so ports and session state never mix between backends or
 * repositories. Concurrent `ensure` calls share one in-flight start.
 *
 * `ensure` only starts the proxy. The backend process and its session are
 * created by the first chat request, so `status().sessionID` stays undefined
 * until a turn has run, and launch errors surface on that request rather than
 * in `status().error`.
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
      proxyApiKey: active?.proxy.apiKey,
      serverBaseUrl: active?.getServerBaseUrl(),
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

  function resolveFactory(options: EnsureAgentBackendOptions): AgentBackendFactory {
    const definition = getAgentBackendDefinition(options.backendId)
    if (!definition || !definition.create)
      throw new Error(`Agent backend "${options.backendId}" is not supported yet`)
    if (!options.commandPath && !isCommandAvailable(definition.command))
      throw new Error(`Agent backend "${definition.label}" is not installed (missing "${definition.command}")`)
    return definition.create
  }

  async function start(create: AgentBackendFactory, options: EnsureAgentBackendOptions, directory: string): Promise<AgentBackendStatus> {
    // `ensure` runs at app launch, but AIRI policy is that nothing touches the
    // machine or spends tokens until the user actually talks to AIRI. So only
    // the proxy (an idle local HTTP server) starts here; the backend process is
    // spawned and the session opened by the first chat request.
    let launching: Promise<AgentBackendInstance> | undefined
    let launched: AgentBackendInstance | undefined
    function launch(): Promise<AgentBackendInstance> {
      // A failed launch is forgotten so the next request retries it instead of
      // replaying the same error until restart.
      launching ??= create({ directory, commandPath: options.commandPath }).then(
        (instance) => {
          launched = instance
          return instance
        },
        (error) => {
          launching = undefined
          throw error
        },
      )
      return launching
    }

    const transport: AgentTransport = {
      async createSession(sessionOptions) {
        const instance = await launch()
        return instance.transport.createSession({ ...sessionOptions, resumeSessionID: options.resumeSessionID })
      },
      async prompt(sessionID, text, onText, promptOptions) {
        const instance = await launch()
        return instance.transport.prompt(sessionID, text, onText, promptOptions)
      },
      // The launched instance is closed by `active.close` below.
      async close() {},
    }

    const proxy = await startAgentProxy({ transport })
    active = {
      backendId: options.backendId,
      directory,
      proxy,
      getServerBaseUrl: () => launched?.serverBaseUrl,
      async close() {
        await proxy.close()
        // Wait out a launch still in flight so its process is not leaked.
        const instance = await launching?.catch(() => undefined)
        await instance?.close()
      },
    }
    lastError = undefined
    return snapshot()
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

      starting = (async () => {
        // Validate before tearing anything down: switching to a backend that is
        // missing must leave the running one, and the chat using it, untouched.
        const create = resolveFactory(options)
        if (active)
          await stop()
        return await start(create, options, directory)
      })()
        .catch((error) => {
          lastError = errorMessageFrom(error) ?? 'Unknown error'
          // Unlike `status()`, the caller of this `ensure` must learn why its
          // request failed even while the previous backend keeps running, so
          // callers compare `backendId` with the one they asked for.
          return { ...snapshot(), error: lastError }
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
