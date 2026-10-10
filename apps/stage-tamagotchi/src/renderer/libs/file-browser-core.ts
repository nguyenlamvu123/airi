const FILE_BROWSER_KEYWORDS = ['duyệt file', 'duyet file']

/**
 * Decides whether a sent chat message should open the builtin file browser.
 *
 * Matching mirrors the chat keyword matcher (trim + lowercase) so typing
 * "duyệt file" (with or without diacritics) opens the browser from $HOME.
 */
export function matchFileBrowserCommand(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  return FILE_BROWSER_KEYWORDS.includes(normalized)
}

/**
 * Returns the parent directory of an absolute path without touching the fs.
 *
 * POSIX and Windows separators are both handled; the filesystem root and any
 * path without a parent resolve back to themselves.
 *
 * Before:
 * - '/home/user/docs' -> '/home/user'
 * - 'C:\\Users\\name' -> 'C:/Users'
 *
 * After:
 * - '/home/user/docs' -> '/home/user'
 */
export function getParentPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0)
    return normalized.startsWith('/') ? '/' : normalized
  return normalized.slice(0, index)
}
