import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'

import { spawn } from 'node:child_process'

import { startOpencodeProxy } from './openai-proxy'

export interface OpencodeBridgeOptions {
  /** Working directory opencode treats as the project root. */
  directory: string
  /** opencode executable name or absolute path. */
  opencodePath?: string
  /** Explicit port for the opencode server; `0`/omitted lets opencode choose. */
  serverPort?: number
  /** Explicit port for the OpenAI proxy; `0`/omitted lets the OS choose. */
  proxyPort?: number
  host?: string
  title?: string
}

export interface OpencodeBridge {
  /** OpenAI-compatible base URL (`http://127.0.0.1:<port>/v1`) for AIRI's provider. */
  proxyBaseUrl: string
  /** Base URL of the underlying opencode server. */
  serverBaseUrl: string
  close: () => Promise<void>
}

const SERVER_START_TIMEOUT_MS = 30_000

/** Matches the `opencode server listening on http://host:port` startup line. */
const LISTENING_PATTERN = /listening on (https?:\/\/\S+)/

/**
 * Spawns `opencode serve` and resolves with its HTTP base URL once the server
 * reports that it is listening.
 *
 * opencode prints the listening URL to its own log stream, so we watch stdout
 * and stderr rather than probing a fixed port. The child is unref'd and killed
 * by the returned `close`; on spawn failure (e.g. opencode not installed) the
 * promise rejects with the underlying error.
 */
export function startOpencodeServer(options: OpencodeBridgeOptions): Promise<{ baseUrl: string, close: () => Promise<void> }> {
  const host = options.host ?? '127.0.0.1'
  const path = options.opencodePath?.trim() || 'opencode'
  const args = ['serve', '--hostname', host]
  if (typeof options.serverPort === 'number')
    args.push('--port', String(options.serverPort))

  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(path, args, { cwd: options.directory, stdio: ['ignore', 'pipe', 'pipe'] })
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

/**
 * Starts the full opencode chat backend: a local `opencode serve` process plus
 * an OpenAI-compatible proxy in front of it.
 *
 * Callers only need the returned `proxyBaseUrl`, which plugs into AIRI's
 * OpenAI-compatible chat provider. `close` tears both layers down in order.
 */
export async function startOpencodeBridge(options: OpencodeBridgeOptions): Promise<OpencodeBridge> {
  const server = await startOpencodeServer(options)

  let proxy
  try {
    proxy = await startOpencodeProxy({
      opencodeBaseUrl: server.baseUrl,
      host: options.host,
      port: options.proxyPort,
      title: options.title,
    })
  }
  catch (error) {
    await server.close()
    throw error
  }

  return {
    proxyBaseUrl: proxy.baseUrl,
    serverBaseUrl: server.baseUrl,
    async close() {
      await proxy.close()
      await server.close()
    },
  }
}
