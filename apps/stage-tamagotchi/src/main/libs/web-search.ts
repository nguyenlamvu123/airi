import type { WebSearchResult } from '../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'

import { fetchDuckDuckGoResults } from './duckduckgo'
import { fetchWikipediaResults } from './wikipedia'

/**
 * Upper bound for one search, both sources included. Without it a stalled
 * connection would keep the panel spinner up indefinitely.
 */
const SEARCH_TIMEOUT_MS = 10_000

const MAX_RESULTS = 8

/**
 * Runs the "duyệt web" search: DuckDuckGo Instant Answer and Wikipedia, in
 * parallel.
 *
 * Instant Answer only knows well-known entities and returns nothing for most
 * other queries (every Vietnamese query in testing), so Wikipedia full-text
 * search fills the gap. Instant Answer comes first because its abstract, when
 * present, is the most direct answer. Duplicate URLs keep the first copy.
 *
 * A source that fails or times out is skipped; this only rejects when both
 * fail. Neither source is a general web search, so the panel always offers the
 * full DuckDuckGo results page as well.
 */
export async function searchWeb(query: string): Promise<WebSearchResult[]> {
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  const [instantAnswer, wikipedia] = await Promise.allSettled([
    fetchDuckDuckGoResults(query, signal),
    fetchWikipediaResults(query, signal),
  ])

  if (instantAnswer.status === 'rejected' && wikipedia.status === 'rejected') {
    throw new Error(`DuckDuckGo: ${errorMessageFrom(instantAnswer.reason) ?? 'failed'}; Wikipedia: ${errorMessageFrom(wikipedia.reason) ?? 'failed'}`)
  }

  const results: WebSearchResult[] = []
  const seenUrls = new Set<string>()
  for (const source of [instantAnswer, wikipedia]) {
    if (source.status !== 'fulfilled')
      continue
    for (const result of source.value) {
      const key = result.url.replace(/\/+$/, '').toLowerCase()
      if (seenUrls.has(key))
        continue
      seenUrls.add(key)
      results.push(result)
      if (results.length >= MAX_RESULTS)
        return results
    }
  }
  return results
}
