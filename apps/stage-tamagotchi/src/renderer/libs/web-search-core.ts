import { findCommandKeywords } from '@proj-airi/stage-ui/stores/command-keywords'

/**
 * Extracts the search query from a chat message when it uses the builtin
 * web-search keyword, e.g. "duyệt web: kyoto".
 *
 * Keywords come from `states.json` (the `@command:web-search` entries), so the
 * trigger can be renamed there. Matching is a case-insensitive prefix match;
 * the keyword must be a standalone token, so "duyệt web" does not fire on
 * "duyệt webbing". A separating ":" after the keyword is optional.
 *
 * Returns `undefined` when the message is not a search command or the query
 * after the keyword is empty.
 *
 * Before:
 * - "duyệt web: kyoto" -> "kyoto"
 * - "duyet web: kyoto" -> "kyoto"
 *
 * After:
 * - "hello" -> undefined
 */
export function parseSearchCommand(message: string, keywords: string[] = findCommandKeywords('web-search')): string | undefined {
  const trimmed = message.trim()
  const normalized = trimmed.toLowerCase()

  // Longest keyword first so a longer trigger wins over one of its prefixes.
  const orderedKeywords = [...keywords].sort((a, b) => b.length - a.length)
  for (const keyword of orderedKeywords) {
    const key = keyword.trim().toLowerCase()
    if (!key || !normalized.startsWith(key))
      continue

    const rest = trimmed.slice(key.length)
    // Only a standalone token counts; reject "duyệt webbing" style continuations.
    if (rest !== '' && !/^[\s:]/.test(rest))
      continue

    const query = rest.replace(/^[\s:]+/, '').trim()
    return query.length > 0 ? query : undefined
  }
  return undefined
}
