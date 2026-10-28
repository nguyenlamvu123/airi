import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'

import process from 'node:process'

import { spawn } from 'node:child_process'

/**
 * Spawns `opencode serve` and resolves with its HTTP base URL once the server
 * reports that it is listening.
 *
 * opencode prints the listening URL to its own log stream, so we watch stdout
 * and stderr rather than probing a fixed port. The child is unref'd and killed
 * by the returned `close`; on spawn failure (e.g. opencode not installed) the
 * promise rejects with the underlying error.
 */
export interface OpencodeServerOptions {
  /** Working directory opencode treats as the project root. */
  directory: string
  /** opencode executable name or absolute path. */
  opencodePath?: string
  /** Explicit port for the opencode server; `0`/omitted lets opencode choose. */
  serverPort?: number
  host?: string
}

export interface OpencodeServer {
  baseUrl: string
  close: () => Promise<void>
}

const SERVER_START_TIMEOUT_MS = 30_000

/**
 * Inline opencode config, passed as `OPENCODE_CONFIG_CONTENT`. Inline config
 * overrides the user's global and project `opencode.json`.
 *
 * Mirrors the read-only session ruleset in `./transport` for opencode builds
 * that ignore per-session rules. Dangerous keys are denied by name, not only
 * through `*`, because the user's config is merged key by key and a later
 * user rule would otherwise win over the catch-all. `.env` files stay
 * unreadable so secrets never reach the model provider. `autoupdate` and
 * `share` are off so the server never touches the network or the install on
 * its own.
 */
const AIRI_OPENCODE_CONFIG = {
  permission: {
    '*': 'deny',
    'read': { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny' },
    'list': 'allow',
    'glob': 'allow',
    'grep': 'allow',
    'edit': 'deny',
    'bash': 'deny',
    'task': 'deny',
    'webfetch': 'deny',
    'websearch': 'deny',
    'codesearch': 'deny',
    'external_directory': 'deny',
    'lsp': 'deny',
    'skill': 'deny',
    'question': 'deny',
    'todowrite': 'deny',
    'doom_loop': 'deny',
  },
  autoupdate: false,
  share: 'disabled',
}

/** Matches the `opencode server listening on http://host:port` startup line. */
const LISTENING_PATTERN = /listening on (https?:\/\/\S+)/

export function startOpencodeServer(options: OpencodeServerOptions): Promise<OpencodeServer> {
  const host = options.host ?? '127.0.0.1'
  const path = options.opencodePath?.trim() || 'opencode'
  const args = ['serve', '--hostname', host]
  if (typeof options.serverPort === 'number')
    args.push('--port', String(options.serverPort))

  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(path, args, {
        cwd: options.directory,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(AIRI_OPENCODE_CONFIG) },
      })
    }
    catch (error) {
      reject(error)
      return
    }

    let settled = false
    let buffer = ''

    const timeout = setTimeout(() => {
      finish(new Error(`opencode serve did not start within ${SERVER_START_TIMEOUT_MS}ms`))
    }, SERVER_START_TIMEOUT_MS)

    function cleanup() {
      clearTimeout(timeout)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
    }

    function finish(error: Error | undefined, baseUrl?: string) {
      if (settled)
        return
      settled = true
      if (error) {
        cleanup()
        child.kill()
        reject(error)
        return
      }
      // Stop watching logs once the URL is known; the child keeps running.
      clearTimeout(timeout)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.unref()
      resolve({
        baseUrl: baseUrl!,
        close: () => stopChild(child),
      })
    }

    function onData(chunk: Buffer) {
      buffer += chunk.toString('utf8')
      const match = buffer.match(LISTENING_PATTERN)
      if (match)
        finish(undefined, match[1].replace(/\/+$/, ''))
    }

    function onError(error: Error) {
      finish(new Error(`Failed to launch opencode (${path}): ${error.message}`))
    }

    function onExit(code: number | null) {
      finish(new Error(`opencode serve exited early with code ${code}`))
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', onError)
    child.on('exit', onExit)
  })
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve()

  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}
