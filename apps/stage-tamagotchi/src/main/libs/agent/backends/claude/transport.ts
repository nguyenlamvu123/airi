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
}

/**
 * Claude Code CLI flags shared by every turn.
 *
 * `--verbose` is required by Claude Code when combining `-p` with
 * `--output-format stream-json`; `--include-partial-messages` turns the answer
 * into incremental deltas so AIRI can stream it.
 *
 * The rest enforces AIRI's policy that an agent backend may read project files
 * to answer and do nothing else:
 * - `--tools Read,Glob,Grep` leaves only the read-only built-in tools, so no
 *   shell, edits, web access or subagents exist to be called, whatever the
 *   user's allow rules say.
 * - `--strict-mcp-config` without `--mcp-config` loads no MCP server, which
 *   also drops claude.ai connectors (mail, drive, ...).
 * - `--disable-slash-commands` drops skills and custom commands.
 * - `--settings` turns off every hook, so no user hook runs a command on each
 *   turn, and denies `.env` reads so secrets never reach the model.
 * - `--permission-mode dontAsk` pins the mode instead of inheriting the
 *   user's default, which varies per machine (Claude Code 2.1.312 defaults to
 *   `auto`). Anything that would need approval, such as reading outside the
 *   working directory, is denied because a print-mode turn has no one to ask.
 */
const CLAUDE_BASE_ARGS = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--tools',
  'Read,Glob,Grep',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--settings',
  JSON.stringify({
    disableAllHooks: true,
    permissions: { deny: ['Read(**/.env)', 'Read(**/.env.*)'] },
  }),
  '--permission-mode',
  'dontAsk',
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

    prompt(sessionID, text, onText, promptOptions): Promise<AgentPromptResult> {
      const args = [...CLAUDE_BASE_ARGS]
      if (sessionID)
        args.push('--resume', sessionID)
      if (options.model)
        args.push('--model', options.model)
      // Appended, not `--system-prompt`: replacing Claude Code's own prompt would
      // drop the working-directory and tool-use context its read tools rely on.
      if (promptOptions?.systemPrompt)
        args.push('--append-system-prompt', promptOptions.systemPrompt)
      // `--` ends option parsing, so a message such as "-v" reaches Claude as
      // the prompt instead of being read as a CLI flag.
      args.push('--', text)

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
      child = spawn(command, args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] })
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
