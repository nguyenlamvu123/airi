import type { Tool } from '@xsai/shared-chat'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { tool } from '@xsai/tool'
import { z } from 'zod'

import { electronReadTextFile } from '../../../../shared/eventa'

function createInvoker() {
  const { context } = createContext(window.electron.ipcRenderer)
  return defineInvoke(context, electronReadTextFile)
}

let invokerCache: ReturnType<typeof createInvoker> | undefined

function getInvoker() {
  if (!invokerCache)
    invokerCache = createInvoker()
  return invokerCache
}

const readTextFileParams = z.object({
  path: z.string().describe('Absolute path to an existing local text file (UTF-8). On Windows e.g. "C:\\Users\\Alice\\Documents\\truyen.txt", on Linux/macOS e.g. "/home/alice/truyen.txt".'),
  maxChars: z.number().int().positive().max(50_000).optional().describe('Optional cap on characters to read (default 6000). Larger files are truncated.'),
})

async function executeReadTextFile(input: { path: string, maxChars?: number }): Promise<string> {
  if (!input.path.trim()) {
    return 'Error: "path" is required for reading a text file.'
  }

  try {
    const result = await getInvoker()({
      path: input.path,
      maxChars: input.maxChars,
    })

    if (!result.ok) {
      return `Error: could not read "${input.path}": ${result.error}. Ask the user to confirm the absolute path.`
    }

    const truncationNote = result.truncated ? '\n[Note: the file was truncated to keep the reply within limits.]' : ''
    return `Content of "${input.path}":\n\n${result.content}${truncationNote}`
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error reading "${input.path}": ${message}. Ask the user to confirm the absolute path.`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'read_text_file',
    description: 'Read a local text file (story, article, notes) from the user\'s computer. Use the absolute path. After reading, summarize or read the content aloud to the user as conversation.',
    execute: executeReadTextFile,
    parameters: readTextFileParams,
  }),
]

export const storyTellerTools = async () => Promise.all(tools)
