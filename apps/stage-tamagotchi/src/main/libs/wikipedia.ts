import type { WebSearchResult } from '../../shared/eventa'

const MAX_RESULTS = 5

/**
 * Wikimedia asks every API client to identify itself; generic user agents can
 * be throttled or refused.
 * https://meta.wikimedia.org/wiki/User-Agent_policy
 */
const USER_AGENT = 'AIRI-desktop (https://github.com/moeru-ai/airi)'

// Letters that, among Latin scripts, practically only Vietnamese uses: đ, ă,
// â, ê, ô, ơ, ư and the toned vowels.
const VIETNAMESE_LETTERS = /[ăâđêôơưàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i

interface WikipediaSearchResponse {
  query?: {
    search?: Array<{ title?: string, snippet?: string }>
  }
}

/**
 * Picks the Wikipedia edition to search. Vietnamese when the query contains
 * Vietnamese letters, English otherwise, which also covers technical terms
 * typed in English. A Vietnamese query typed without diacritics goes to the
 * English edition; that is the accepted miss of this heuristic.
 */
export function wikipediaLanguageFor(query: string): 'vi' | 'en' {
  return VIETNAMESE_LETTERS.test(query) ? 'vi' : 'en'
}

/**
 * Normalizes a Wikipedia search snippet, which is HTML with highlight spans
 * and entities, into plain text. `&amp;` is decoded last so an escaped entity
 * such as `&amp;quot;` stays literal.
 *
 * Before:
 * - 'dân số <span class="searchmatch">Hà</span> &quot;Nội&quot;'
 *
 * After:
 * - 'dân số Hà "Nội"'
 */
export function stripWikipediaSnippet(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Maps a `list=search` response into AIRI's search result list. */
export function parseWikipediaSearch(payload: unknown, language: string): WebSearchResult[] {
  if (!payload || typeof payload !== 'object')
    return []

  const results: WebSearchResult[] = []
  for (const hit of (payload as WikipediaSearchResponse).query?.search ?? []) {
    const title = hit.title?.trim()
    if (!title)
      continue
    // Article paths use underscores; keep "/" readable (e.g. "AC/DC") because
    // an encoded slash is not accepted in every article path.
    const path = encodeURIComponent(title.replaceAll(' ', '_')).replaceAll('%2F', '/')
    results.push({
      title,
      url: `https://${language}.wikipedia.org/wiki/${path}`,
      snippet: stripWikipediaSnippet(hit.snippet ?? ''),
    })
    if (results.length >= MAX_RESULTS)
      break
  }
  return results
}

/** Full-text searches Wikipedia in the edition picked by {@link wikipediaLanguageFor}. */
export async function fetchWikipediaResults(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const language = wikipediaLanguageFor(query)
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`)
  url.searchParams.set('action', 'query')
  url.searchParams.set('list', 'search')
  url.searchParams.set('srsearch', query)
  url.searchParams.set('srlimit', String(MAX_RESULTS))
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  url.searchParams.set('utf8', '1')

  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal })
  if (!response.ok)
    throw new Error(`Wikipedia request failed with status ${response.status}`)

  return parseWikipediaSearch(await response.json() as unknown, language)
}
