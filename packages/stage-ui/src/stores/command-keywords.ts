import type { KeywordMapping } from './keyword-reactions'

import statesMappingJson from '../assets/emoji-videos/states.json'

/**
 * Filename sentinel prefix in `states.json` marking a keyword as a builtin chat
 * command instead of an avatar state image. The text after the prefix is the
 * command name (`file-browser`, `web-search`, ...).
 *
 * Commands live in `states.json` so they are editable in one place alongside the
 * avatar keywords, but they must never resolve to an image — hence the sentinel
 * never matches a file in the state assets folder.
 */
export const COMMAND_PREFIX = '@command:'

/** Whether a `states.json` filename value declares a builtin chat command. */
export function isCommandFilename(filename: string): boolean {
  return filename.startsWith(COMMAND_PREFIX)
}

/**
 * Returns every keyword registered for a builtin command, e.g. the keywords of
 * `file-browser` are the `states.json` entries whose value is `@command:file-browser`.
 *
 * The returned keywords keep their original casing so callers can slice the
 * original message after a case-insensitive prefix match.
 */
export function findCommandKeywords(command: string, mapping: KeywordMapping = statesMappingJson): string[] {
  const expected = `${COMMAND_PREFIX}${command}`
  return Object.entries(mapping)
    .filter(([, filename]) => filename === expected)
    .map(([keyword]) => keyword)
}

/**
 * Drops the `@command:` entries from a `states.json` shaped mapping.
 *
 * Before:
 * - `{ "duyệt file": "@command:file-browser", "bình thường": "character.png" }`
 *
 * After:
 * - `{ "bình thường": "character.png" }`
 */
export function omitCommandEntries(mapping: KeywordMapping): KeywordMapping {
  const result: KeywordMapping = {}
  for (const [keyword, filename] of Object.entries(mapping)) {
    if (!isCommandFilename(filename)) {
      result[keyword] = filename
    }
  }
  return result
}
