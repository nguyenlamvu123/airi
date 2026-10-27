import type { OpencodeBridge, OpencodeBridgeOptions } from './index'

import process from 'node:process'

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { startOpencodeBridge } from './index'

export interface OpencodeBridgeStatus {
  running: boolean
  proxyBaseUrl?: string
  serverBaseUrl?: string
  directory?: string
  error?: string
}

/**
 * Resolves the directory opencode should treat as the project root.
 *
 * Preference order:
 * 1. An explicit directory passed by the caller (user setting / request).
 * 2. The nearest ancestor of `startDirectory` containing `pnpm-workspace.yaml`,
 *    which in this repository is the monorepo root.
 * 3. `startDirectory` itself when no workspace marker is found (packaged app).
 */
export function resolveOpencodeDirectory(startDirectory: string, explicit?: string): string {
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

export interface OpencodeBridgeManager {
  /**
   * Starts (or reuses) the opencode bridge for `directory` and reports its
   * status. Concurrent calls share one in-flight start. A different directory
   * restarts the bridge.
   */
  ensure: (options?: { directory?: string, startDirectory?: string, opencodePath?: string }) => Promise<OpencodeBridgeStatus>
  status: () => OpencodeBridgeStatus
  stop: () => Promise<void>
}

/**
 * Owns the single opencode bridge instance for the main process.
 *
 * Only one `opencode serve` + proxy pair runs at a time; switching the project
 * directory tears the previous pair down first so port/session state never
 * mixes between repositories.
 */
export function createOpencodeBridgeManager(): OpencodeBridgeManager {
  let bridge: OpencodeBridge | undefined
  let directory: string | undefined
  let starting: Promise<OpencodeBridgeStatus> | undefined
  let lastError: string | undefined

  function snapshot(): OpencodeBridgeStatus {
    return {
      running: bridge != null,
      proxyBaseUrl: bridge?.proxyBaseUrl,
      serverBaseUrl: bridge?.serverBaseUrl,
      directory,
      // Only surface an error while nothing is running; a stale error must not
      // mask a healthy bridge.
      error: bridge ? undefined : lastError,
    }
  }

  async function stop() {
    const current = bridge
    bridge = undefined
    directory = undefined
    if (current)
      await current.close()
  }

  async function start(options: OpencodeBridgeOptions, targetDirectory: string): Promise<OpencodeBridgeStatus> {
    const started = await startOpencodeBridge({ ...options, directory: targetDirectory })
    bridge = started
    directory = targetDirectory
    lastError = undefined
    return snapshot()
  }

  return {
    async ensure(options) {
      const targetDirectory = resolveOpencodeDirectory(
        options?.startDirectory ?? process.cwd(),
        options?.directory,
      )

      if (bridge && directory === targetDirectory)
        return snapshot()

      if (starting)
        return starting

      // Different directory (or nothing running yet): reset before starting.
      if (bridge && directory !== targetDirectory)
        await stop()

      const startOptions: OpencodeBridgeOptions = {
        directory: targetDirectory,
        opencodePath: options?.opencodePath,
      }

      starting = start(startOptions, targetDirectory)
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
 * Process-wide bridge manager used by the Eventa handlers in the main process.
 *
 * Exposed as a module singleton (rather than DI) because the base-window invoke
 * setup runs once per window and all windows must observe the same bridge.
 */
export const opencodeBridgeManager = createOpencodeBridgeManager()
