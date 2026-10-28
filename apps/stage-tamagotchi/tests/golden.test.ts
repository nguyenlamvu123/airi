import type { AgentTransport } from '../src/main/libs/agent/types'

import process from 'node:process'

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { createClaudeTransport } from '../src/main/libs/agent/backends/claude/transport'
import { startAgentProxy } from '../src/main/libs/agent/proxy'
import { searchWeb } from '../src/main/libs/web-search'

/**
 * Golden-file tests for the agent bridge and the "duyệt web" search.
 *
 * This file holds no test case. Each case is data:
 *
 *   tests/input/testcaseN/mota.txt        Vietnamese: purpose, input, expectation, why it matters
 *   tests/input/testcaseN/params.json     `{ kind, ... }`; `kind` picks the runner below
 *   tests/input/testcaseN/responses.json  (web-search) scripted HTTP responses, matched by exact URL
 *   tests/input/testcaseN/stream.ndjson   (claude-turn) real Claude Code stream-json output
 *   tests/expect/testcaseN/*.json         expected outputs
 *   tests/actual/testcaseN/*.json         rewritten on every run, then compared with expect/
 *
 * Adding a case means adding directories, not editing this file. The set of
 * files in actual/ must equal the set in expect/, so an output that should be
 * absent (e.g. `prompt.json` when the proxy refuses a request) is asserted too.
 *
 * Nothing reaches the network or a real agent: web-search cases stub `fetch`
 * and fail on any request outside responses.json, claude-turn cases run a fake
 * `claude` that replays stream.ndjson, and proxy cases use a recording
 * transport behind the real proxy on 127.0.0.1.
 *
 * Call stack:
 *
 * describe('golden')
 *   -> runCase (per tests/input/testcaseN)
 *     -> {@link runWebSearch}  -> searchWeb (stubbed fetch)
 *     -> {@link runClaudeTurn} -> createClaudeTransport -> fake claude
 *     -> {@link runProxy}      -> startAgentProxy -> recording transport
 *   -> compare actual/ with expect/
 */

const ROOT = import.meta.dirname
const INPUT = join(ROOT, 'input')
const EXPECT = join(ROOT, 'expect')
const ACTUAL = join(ROOT, 'actual')

interface ScriptedResponse {
  url: string
  status?: number
  body?: unknown
  /** Makes `fetch` reject with this message, like a network failure. */
  error?: string
}

type CaseParams
  = | { kind: 'web-search', query: string }
    | { kind: 'claude-turn', text: string, sessionID?: string, systemPrompt?: string }
    | { kind: 'proxy', request: unknown, authorized: boolean, reply: string }

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`)
}

async function runWebSearch(params: { query: string }, input: string, out: string): Promise<void> {
  const scripted = readJson<ScriptedResponse[]>(join(input, 'responses.json'))
  const requested: string[] = []
  const unscripted: string[] = []

  vi.stubGlobal('fetch', async (url: URL | string) => {
    const href = url.toString()
    requested.push(href)
    const response = scripted.find(entry => entry.url === href)
    if (!response) {
      unscripted.push(href)
      throw new Error(`unscripted request: ${href}`)
    }
    if (response.error)
      throw new Error(response.error)
    return new Response(JSON.stringify(response.body ?? {}), { status: response.status ?? 200 })
  })

  try {
    writeJson(out, 'result.json', await searchWeb(params.query))
  }
  catch (error) {
    writeJson(out, 'error.json', { message: errorMessageFrom(error) })
  }
  finally {
    vi.unstubAllGlobals()
  }

  // searchWeb tolerates one failing source, so an unscripted request would
  // otherwise pass silently as "that source failed".
  expect(unscripted).toEqual([])
  // Both sources are requested concurrently; sort so the order is stable.
  writeJson(out, 'urls.json', requested.sort())
}

// Replays the case's stream.ndjson and records the argv it was started with.
// POSIX only: it relies on the shebang line.
const FAKE_CLAUDE = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs')
writeFileSync(process.env.AIRI_FAKE_CLAUDE_ARGV, JSON.stringify(process.argv.slice(2)))
process.stdout.write(readFileSync(process.env.AIRI_FAKE_CLAUDE_NDJSON))
`

let fakeClaudeDir: string | undefined
function fakeClaudePath(): string {
  if (!fakeClaudeDir) {
    fakeClaudeDir = mkdtempSync(join(tmpdir(), 'airi-golden-'))
    writeFileSync(join(fakeClaudeDir, 'claude.cjs'), FAKE_CLAUDE)
    chmodSync(join(fakeClaudeDir, 'claude.cjs'), 0o755)
  }
  return join(fakeClaudeDir, 'claude.cjs')
}

async function runClaudeTurn(params: { text: string, sessionID?: string, systemPrompt?: string }, input: string, out: string): Promise<void> {
  const argvFile = join(out, 'argv.tmp.json')
  vi.stubEnv('AIRI_FAKE_CLAUDE_ARGV', argvFile)
  vi.stubEnv('AIRI_FAKE_CLAUDE_NDJSON', join(input, 'stream.ndjson'))

  const transport = createClaudeTransport({ directory: tmpdir(), command: fakeClaudePath() })
  const streamed: string[] = []
  try {
    const result = await transport.prompt(params.sessionID ?? '', params.text, delta => streamed.push(delta), { systemPrompt: params.systemPrompt })
    // `streamed` is what the chat (and TTS) received live; `text` is the final
    // answer. They must match, or the user hears the answer twice or cut off.
    writeJson(out, 'result.json', { streamed: streamed.join(''), text: result.text, sessionID: result.sessionID, modelID: result.modelID })
  }
  catch (error) {
    writeJson(out, 'error.json', { message: errorMessageFrom(error) })
  }
  finally {
    vi.unstubAllEnvs()
  }

  writeJson(out, 'args.json', readJson<string[]>(argvFile))
  rmSync(argvFile)
}

async function runProxy(params: { request: unknown, authorized: boolean, reply: string }, out: string): Promise<void> {
  const received: Array<{ sessionID: string, text: string, systemPrompt?: string }> = []
  const transport: AgentTransport = {
    async createSession() {
      return { id: 'ses_golden' }
    },
    async prompt(sessionID, text, onText, options) {
      received.push({ sessionID, text, systemPrompt: options?.systemPrompt })
      onText(params.reply)
      return { text: params.reply, sessionID }
    },
    async close() {},
  }

  const proxy = await startAgentProxy({ transport })
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (params.authorized)
      headers.authorization = `Bearer ${proxy.apiKey}`
    const response = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(params.request) })
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>, error?: { message?: string } }
    writeJson(out, 'response.json', {
      status: response.status,
      content: body.choices?.[0]?.message?.content,
      error: body.error?.message,
    })
  }
  finally {
    await proxy.close()
  }

  if (received.length > 0)
    writeJson(out, 'prompt.json', received)
}

function listJson(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.json')).sort() : []
}

const cases = readdirSync(INPUT)
  .filter(name => /^testcase\d+$/.test(name))
  .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))

describe('golden', () => {
  afterAll(() => {
    if (fakeClaudeDir)
      rmSync(fakeClaudeDir, { recursive: true, force: true })
  })

  for (const name of cases) {
    const input = join(INPUT, name)
    const params = readJson<CaseParams>(join(input, 'params.json'))
    const skip = params.kind === 'claude-turn' && process.platform === 'win32'

    it.skipIf(skip)(`${name} (${params.kind})`, async () => {
      const out = join(ACTUAL, name)
      rmSync(out, { recursive: true, force: true })
      mkdirSync(out, { recursive: true })

      switch (params.kind) {
        case 'web-search':
          await runWebSearch(params, input, out)
          break
        case 'claude-turn':
          await runClaudeTurn(params, input, out)
          break
        case 'proxy':
          await runProxy(params, out)
          break
      }

      const expectDir = join(EXPECT, name)
      expect(listJson(out)).toEqual(listJson(expectDir))
      for (const file of listJson(expectDir))
        expect({ file, value: readJson(join(out, file)) }).toEqual({ file, value: readJson(join(expectDir, file)) })
    })
  }
})
