import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { ResizeDirection } from '@proj-airi/electron-eventa'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

import type {
  ElectronDirectoryEntry,
  ElectronListDirectoryResult,
  ElectronOpenExternalUrlResult,
  ElectronOpenPathResult,
  ElectronReadTextFileResult,
  OpencodeBridgeStatus,
  WebSearchResultsResult,
} from '../../../shared/eventa'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { Buffer } from 'node:buffer'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { isRendererUnavailable } from '@proj-airi/electron-vueuse/main'
import { shell } from 'electron'
import { isMacOS } from 'std-env'

import {
  electronGetHomeDirectory,
  electronListDirectory,
  electronOpencodeEnsure,
  electronOpencodeStatus,
  electronOpencodeStop,
  electronOpenExternalUrl,
  electronOpenPath,
  electronReadTextFile,
  electronSearchWeb,
} from '../../../shared/eventa'
import { fetchDuckDuckGoResults } from '../../libs/duckduckgo'
import { opencodeBridgeManager } from '../../libs/opencode/manager'
import { createServerChannelService } from '../../services/airi/channel-server'
import { createI18nService } from '../../services/airi/i18n'
import { createAppService, createPowerMonitorService, createScreenService, createSystemPreferencesService, createWindowService } from '../../services/electron'

export function toggleWindowShow(window?: BrowserWindow | null): void {
  if (!window) {
    return
  }
  if (isRendererUnavailable(window)) {
    return
  }

  if (window?.isMinimized()) {
    window?.restore()
  }

  window?.show()
  window?.focus()
}

export function transparentWindowConfig(): BrowserWindowConstructorOptions {
  return {
    frame: false,
    titleBarStyle: isMacOS ? 'hidden' : undefined,
    transparent: true,
    hasShadow: false,
  }
}

/**
 * Blocks renderer navigation while allowing safe links to open in the system browser.
 *
 * Use when:
 * - Creating an Electron window that receives the shared privileged preload
 *
 * Expects:
 * - The window loads only AIRI-controlled renderer content
 *
 * Returns:
 * - Nothing; installs navigation and popup guards on the window's web contents
 */
export function protectPrivilegedWindowNavigation(window: BrowserWindow): void {
  function openSafeExternalUrl(rawUrl: string): void {
    try {
      const url = new URL(rawUrl)
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:')
        void shell.openExternal(url.toString())
    }
    catch {
      // Ignore malformed navigation targets.
    }
  }

  window.webContents.setWindowOpenHandler((details) => {
    openSafeExternalUrl(details.url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    // Renderer-initiated reloads keep the exact current URL in both packaged
    // (`file:`) and Vite (`http:`) builds. Let those through without widening
    // navigation to other local files or development-server paths.
    if (navigationUrl === window.webContents.getURL())
      return

    event.preventDefault()
    openSafeExternalUrl(navigationUrl)
  })
}

export function blurryWindowConfig(): BrowserWindowConstructorOptions {
  return {
    vibrancy: 'hud',
    backgroundMaterial: 'acrylic',
  }
}

export function spotlightLikeWindowConfig(): BrowserWindowConstructorOptions {
  return {
    ...blurryWindowConfig(),
    titleBarStyle: isMacOS ? 'hidden' : undefined,
  }
}

export function resizeWindowByDelta(params: {
  window: BrowserWindow
  deltaX: number
  deltaY: number
  direction: ResizeDirection
  minWidth?: number
  minHeight?: number
}): void {
  const bounds = params.window.getBounds()
  const minWidth = params.minWidth ?? 100
  const minHeight = params.minHeight ?? 200

  let { x, y, width, height } = bounds

  if (params.direction.includes('e')) {
    width = Math.max(minWidth, width + params.deltaX)
  }
  if (params.direction.includes('w')) {
    const newWidth = Math.max(minWidth, width - params.deltaX)
    if (newWidth !== width) {
      x = x + (width - newWidth)
      width = newWidth
    }
  }

  if (params.direction.includes('s')) {
    height = Math.max(minHeight, height + params.deltaY)
  }
  if (params.direction.includes('n')) {
    const newHeight = Math.max(minHeight, height - params.deltaY)
    if (newHeight !== height) {
      y = y + (height - newHeight)
      height = newHeight
    }
  }

  params.window.setBounds({ x, y, width, height })
}

export async function setupBaseWindowElectronInvokes(params: {
  context: ReturnType<typeof createContext>['context']
  window: BrowserWindow
  serverChannel: ServerChannel
  i18n: I18n
}) {
  createScreenService({ context: params.context, window: params.window })
  createWindowService({ context: params.context, window: params.window })
  createAppService({ context: params.context, window: params.window })
  createPowerMonitorService({ context: params.context, window: params.window })
  createSystemPreferencesService({ context: params.context, window: params.window })

  await createI18nService({ context: params.context, window: params.window, i18n: params.i18n })

  createServerChannelService({ serverChannel: params.serverChannel })

  // Builtin story/reader tool: bounded UTF-8 read of a local text file.
  defineInvokeHandler(params.context, electronReadTextFile, async ({ path, maxChars }): Promise<ElectronReadTextFileResult> => {
    const limit = Math.max(1, Math.min(maxChars ?? 6_000, 50_000))
    const byteLimit = (limit + 4) * 4 // worst-case UTF-8 expansion, bounded
    const fileHandle = await open(path, 'r')
    try {
      const fileStats = await fileHandle.stat()
      if (!fileStats.isFile())
        return { ok: false, error: 'Path is not a file' }

      // Never read whole files into memory; only the slice the model needs.
      const readLength = Math.min(fileStats.size, byteLimit)
      const buffer = Buffer.alloc(readLength)
      const { bytesRead } = await fileHandle.read(buffer, 0, readLength, 0)
      const fullContent = buffer.subarray(0, bytesRead).toString('utf8')
      const content = fullContent.slice(0, limit)
      return {
        ok: true,
        content,
        truncated: fileStats.size > readLength || fullContent.length > limit,
      }
    }
    catch (error) {
      return { ok: false, error: errorMessageFrom(error) ?? 'Unknown error' }
    }
    finally {
      await fileHandle.close()
    }
  })

  // Builtin file browser: resolve $HOME so the renderer can open there on demand.
  defineInvokeHandler(params.context, electronGetHomeDirectory, async (): Promise<{ path: string }> => ({
    path: homedir(),
  }))

  defineInvokeHandler(params.context, electronListDirectory, async ({ path }): Promise<ElectronListDirectoryResult> => {
    try {
      const dirents = await readdir(path, { withFileTypes: true })
      const entries: ElectronDirectoryEntry[] = []

      for (const dirent of dirents) {
        if (dirent.name.startsWith('.'))
          continue

        const entryPath = join(path, dirent.name)

        if (dirent.isDirectory()) {
          entries.push({ name: dirent.name, path: entryPath, kind: 'directory' })
          continue
        }

        if (dirent.isFile()) {
          let size: number | undefined
          try {
            size = (await stat(entryPath)).size
          }
          catch {
            size = undefined
          }
          entries.push({ name: dirent.name, path: entryPath, kind: 'file', size })
          continue
        }

        if (dirent.isSymbolicLink()) {
          // Resolve symlinks so users can navigate symlinked folders instead of
          // treating them as opaque entries that cannot be opened.
          try {
            const stats = await stat(entryPath)
            entries.push({
              name: dirent.name,
              path: entryPath,
              kind: stats.isDirectory() ? 'directory' : 'file',
              size: stats.isDirectory() ? undefined : stats.size,
            })
          }
          catch {
            entries.push({ name: dirent.name, path: entryPath, kind: 'file' })
          }
        }
      }

      entries.sort((a, b) => {
        if (a.kind !== b.kind)
          return a.kind === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      })

      return { ok: true, path, entries }
    }
    catch (error) {
      return { ok: false, error: errorMessageFrom(error) ?? 'Unknown error' }
    }
  })

  defineInvokeHandler(params.context, electronOpenPath, async ({ path }): Promise<ElectronOpenPathResult> => {
    try {
      const openedWithError = await shell.openPath(path)
      if (openedWithError)
        return { ok: false, error: openedWithError }
      return { ok: true }
    }
    catch (error) {
      return { ok: false, error: errorMessageFrom(error) ?? 'Unknown error' }
    }
  })

  // Builtin web search: DuckDuckGo Instant Answer behind the "duyệt web" keyword.
  defineInvokeHandler(params.context, electronSearchWeb, async ({ query }): Promise<WebSearchResultsResult> => {
    const trimmed = query.trim()
    if (!trimmed)
      return { ok: false, error: 'Search query is empty' }
    try {
      const results = await fetchDuckDuckGoResults(trimmed)
      return { ok: true, query: trimmed, results }
    }
    catch (error) {
      return { ok: false, error: errorMessageFrom(error) ?? 'Web search failed' }
    }
  })

  // Opens a result in the user's default browser.
  defineInvokeHandler(params.context, electronOpenExternalUrl, async ({ url }): Promise<ElectronOpenExternalUrlResult> => {
    try {
      await shell.openExternal(url)
      return { ok: true }
    }
    catch (error) {
      return { ok: false, error: errorMessageFrom(error) ?? 'Failed to open URL' }
    }
  })

  // Local opencode chat backend. `ensure` lazily spawns `opencode serve` plus
  // the OpenAI-compatible proxy; the renderer points the `opencode` provider at
  // the returned `proxyBaseUrl`.
  defineInvokeHandler(params.context, electronOpencodeEnsure, async ({ directory }): Promise<OpencodeBridgeStatus> =>
    await opencodeBridgeManager.ensure({ directory }))

  defineInvokeHandler(params.context, electronOpencodeStatus, async (): Promise<OpencodeBridgeStatus> =>
    opencodeBridgeManager.status())

  defineInvokeHandler(params.context, electronOpencodeStop, async (): Promise<OpencodeBridgeStatus> => {
    await opencodeBridgeManager.stop()
    return opencodeBridgeManager.status()
  })
}
