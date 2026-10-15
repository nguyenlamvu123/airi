import { findCommandKeywords } from '@proj-airi/stage-ui/stores/command-keywords'

/**
 * Decides whether a sent chat message should open the builtin file browser.
 *
 * Keywords come from `states.json` (the `@command:file-browser` entries), so the
 * trigger can be renamed there. Matching mirrors the chat keyword matcher
 * (trim + lowercase); the whole message must equal one keyword.
 */
export function matchFileBrowserCommand(message: string, keywords: string[] = findCommandKeywords('file-browser')): boolean {
  const normalized = message.trim().toLowerCase()
  return keywords.some(keyword => keyword.toLowerCase() === normalized)
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
