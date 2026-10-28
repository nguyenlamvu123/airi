import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'

import type { AgentPromptResult, AgentTransport } from '../../types'

import { spawn } from 'node:child_process'

import { parseClaudeStreamLine } from './stream'

export interface ClaudeTransportOptions {
  /** Working directory Claude Code runs in. */
  directory: string
  /** `claude` executable name or absolute path. */
  command?: string
  /** Optional model override (`--model`). */
  model?: string
  /** Extra instructions appended to Claude Code's system prompt. */
  appendSystemPrompt?: string
}

/**
 * Claude Code CLI flags shared by every turn.
 *
 * `--verbose` is required by Claude Code when combining `-p` with
 * `--output-format stream-json`; `--include-partial-messages` turns the answer
 * into incremental deltas so AIRI can stream it.
 */
const CLAUDE_BASE_ARGS = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
]

/**
 * Adapts the Claude Code CLI to the shared {@link AgentTransport} interface.
 *
 * Claude Code has no long-running server, so each turn spawns a short-lived
 * process. The session survives across turns through `--resume <id>`; the id is
 * read from the stream and persisted by the caller.
 */
export function createClaudeTransport(options: ClaudeTransportOptions): AgentTransport {
  const command = options.command?.trim() || 'claude'

  return {
    async createSession(sessionOptions) {
      // Claude mints the id on the first turn; until then there is nothing to
      // resume, so an empty id means "start a new conversation".
      return { id: sessionOptions?.resumeSessionID ?? '' }
    },

    prompt(sessionID, text, onText): Promise<AgentPromptResult> {
      const args = [...CLAUDE_BASE_ARGS]
      if (sessionID)
        args.push('--resume', sessionID)
      if (options.model)
        args.push('--model', options.model)
      if (options.appendSystemPrompt)
        args.push('--append-system-prompt', options.appendSystemPrompt)
      args.push(text)

      return runClaudeTurn(command, args, options.directory, onText)
    },

    async close() {
      // Turns are short-lived child processes; nothing long-running to release.
    },
  }
}

function runClaudeTurn(
  command: string,
  args: string[],
  directory: string,
  onText: (delta: string) => void,
): Promise<AgentPromptResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    }
    catch (error) {
      reject(error)
      return
    }

    let sessionID = ''
    let modelID: string | undefined
    let resultText: string | undefined
    let errorText: string | undefined
    const deltaParts: string[] = []
    let stdoutBuffer = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      let newlineIndex = stdoutBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex)
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        newlineIndex = stdoutBuffer.indexOf('\n')

        const update = parseClaudeStreamLine(line)
        if (!update)
          continue
        if (update.sessionID)
          sessionID = update.sessionID
        if (update.modelID)
          modelID = update.modelID
        if (update.delta) {
          deltaParts.push(update.delta)
          onText(update.delta)
        }
        if (update.resultText !== undefined)
          resultText = update.resultText
        if (update.isError)
          errorText = update.errorText
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      reject(new Error(`Failed to launch Claude Code (${command}): ${error.message}`))
    })

    child.on('exit', (code) => {
      if (errorText) {
        reject(new Error(`Claude Code reported an error: ${errorText}`))
        return
      }

      // Prefer the authoritative result text; fall back to the concatenated
      // deltas for older Claude Code builds that omit the `result` line.
      const text = resultText ?? deltaParts.join('')
      if (code !== 0 && !text) {
        reject(new Error(`Claude Code exited with code ${code}${stderr ? `: ${stderr.slice(0, 300)}` : ''}`))
        return
      }

      resolve({ text, sessionID, modelID })
    })
  })
}
