const SEARCH_PREFIXES = ['tìm kiếm:', 'tim kiem:']

/**
 * Extracts the search query from a chat message when it uses the builtin
 * web-search keyword ("tìm kiếm:" / "tim kiem:").
 *
 * Returns `undefined` when the message is not a search command or the query
 * after the prefix is empty.
 *
 * Before:
 * - "tìm kiếm: kyoto" -> "kyoto"
 * - "tim kiem: kyoto" -> "kyoto"
 *
 * After:
 * - "hello" -> undefined
 */
export function parseSearchCommand(message: string): string | undefined {
  const trimmed = message.trim()
  const normalized = trimmed.toLowerCase()
  for (const prefix of SEARCH_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      const query = trimmed.slice(prefix.length).trim()
      return query.length > 0 ? query : undefined
    }
  }
  return undefined
}
