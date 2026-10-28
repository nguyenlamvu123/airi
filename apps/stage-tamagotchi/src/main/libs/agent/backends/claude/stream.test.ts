import { describe, expect, it } from 'vitest'

import { parseClaudeStreamLine } from './stream'

// Lines copied from real `claude -p --output-format stream-json --verbose
// --include-partial-messages` output (Claude Code 2.1.312, 28-29/10/2026).
// Whole turns, hook and rate-limit lines removed, are replayed in the golden
// cases tests/input/testcase7..9.
const INIT_LINE = '{"type":"system","subtype":"init","cwd":"/tmp/airi-fixture","session_id":"49f03e18-f042-42a3-92fb-9e6f9a9658a7","model":"claude-opus-5-5","permissionMode":"auto","claude_code_version":"2.1.312"}'
const TEXT_DELTA_LINE = '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"xin chào"}},"session_id":"49f03e18-f042-42a3-92fb-9e6f9a9658a7","parent_tool_use_id":null,"uuid":"a1d8db17-d6f5-49b3-a72b-055c66c0818b","api_message_id":"msg_011CgU3xWahfi4cDzF8gCtQJ"}'
const THINKING_DELTA_LINE = '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"","estimated_tokens":50}},"session_id":"ed4707c4-b7d6-41ee-b3fe-8db59e2b36fc","parent_tool_use_id":null,"uuid":"a5d6e387-3efa-483a-86f7-de27a232a134","thinking_display":"updates","api_message_id":"msg_011CgVkjp5KqmCwR7hD2Vd6i"}'
const ASSISTANT_LINE = '{"type":"assistant","message":{"model":"claude-opus-5-5","id":"msg_011CgU3xWahfi4cDzF8gCtQJ","type":"message","role":"assistant","content":[{"type":"text","text":"xin chào"}],"container":null,"stop_reason":null,"stop_sequence":null,"stop_details":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":30998,"cache_read_input_tokens":11736,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":30998},"output_tokens":6,"service_tier":"standard","inference_geo":"global","speed":"standard"},"input_transformations":[],"diagnostics":null,"context_management":null},"parent_tool_use_id":null,"session_id":"49f03e18-f042-42a3-92fb-9e6f9a9658a7","uuid":"1f1cc46a-a177-4e20-b6c7-4803980b41c4","timestamp":"2026-10-28T05:04:42.957Z","request_id":"req_011CgU3xWPY7Vzmh8KJvxamc"}'

describe('parseClaudeStreamLine', () => {
  it('reads the session and model from the init line', () => {
    expect(parseClaudeStreamLine(INIT_LINE)).toEqual({
      sessionID: '49f03e18-f042-42a3-92fb-9e6f9a9658a7',
      modelID: 'claude-opus-5-5',
    })
  })

  it('streams text deltas', () => {
    expect(parseClaudeStreamLine(TEXT_DELTA_LINE)?.delta).toBe('xin chào')
  })

  it('keeps thinking out of the answer text', () => {
    expect(parseClaudeStreamLine(THINKING_DELTA_LINE)?.delta).toBeUndefined()
  })

  // Regression for commit fa06bf0f2.
  it('does not stream the assistant message again after its deltas', () => {
    // ROOT CAUSE:
    //
    // With --include-partial-messages, Claude Code prints the text as
    // `text_delta` events and then prints the finished message once more as an
    // `assistant` line. fa06bf0f2 turned that line's text into a delta:
    //
    //   case 'assistant': ... update.delta = part.text
    //
    // so every answer reached the chat and TTS twice ("xin chàoxin chào").
    //
    // We fixed this by reverting to deltas from `text_delta` only; the
    // `result` line still carries the authoritative full text.
    expect(parseClaudeStreamLine(ASSISTANT_LINE)?.delta).toBeUndefined()
  })

  it('reports an error result with its message', () => {
    // Shape of a failed turn's terminal line; `result` holds the reason.
    const update = parseClaudeStreamLine('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"API Error: 529 overloaded","session_id":"ses_1"}')
    expect(update?.isError).toBe(true)
    expect(update?.errorText).toBe('API Error: 529 overloaded')
    expect(update?.resultText).toBeUndefined()
  })

  it('ignores blank lines and non-JSON noise', () => {
    expect(parseClaudeStreamLine('')).toBeUndefined()
    expect(parseClaudeStreamLine('Warning: something on stdout')).toBeUndefined()
    expect(parseClaudeStreamLine('{not json')).toBeUndefined()
  })
})
