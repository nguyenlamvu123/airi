import type { WebSearchResult } from '../../shared/eventa'

const MAX_RESULTS = 5

interface DuckDuckGoRelatedTopic {
  Name?: string
  FirstURL?: string
  Text?: string
  Topics?: Array<{ FirstURL?: string, Text?: string }>
}

interface DuckDuckGoInstantAnswer {
  AbstractText?: string
  AbstractURL?: string
  Heading?: string
  Answer?: string
  RelatedTopics?: DuckDuckGoRelatedTopic[]
}

/**
 * Splits a DuckDuckGo topic text ("Title - snippet") into title and snippet.
 * Topics without a separator keep the full text as the title.
 *
 * Before:
 * - "Kyoto - Historic city of Japan"
 *
 * After:
 * - { title: "Kyoto", snippet: "Historic city of Japan" }
 */
export function splitDuckDuckGoResultText(text: string): { title: string, snippet: string } {
  const index = text.indexOf(' - ')
  if (index === -1)
    return { title: text, snippet: '' }
  return { title: text.slice(0, index), snippet: text.slice(index + 3) }
}

/**
 * Maps a DuckDuckGo Instant Answer payload into AIRI's search result list.
 *
 * The abstract (or computation answer) becomes the first result, then related
 * topics fill the rest. Pure so it can be unit-tested without a network.
 */
export function parseDuckDuckGoInstantAnswer(payload: unknown, query: string): WebSearchResult[] {
  if (!payload || typeof payload !== 'object')
    return []

  const data = payload as DuckDuckGoInstantAnswer
  const results: WebSearchResult[] = []
  const resultsUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`

  const abstractText = data.AbstractText?.trim()
  if (abstractText) {
    results.push({
      title: data.Heading?.trim() || query,
      url: data.AbstractURL?.trim() || resultsUrl,
      snippet: abstractText,
    })
  }
  else if (data.Answer?.trim()) {
    results.push({
      title: query,
      url: resultsUrl,
      snippet: data.Answer.trim(),
    })
  }

  for (const topic of data.RelatedTopics ?? []) {
    // Top-level topics may be flat entries or grouped under a "Name" heading.
    const entries = topic.Topics && topic.Topics.length > 0 ? topic.Topics : [topic]
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS)
        return results
      if (!entry.Text?.trim() || !entry.FirstURL)
        continue
      const { title, snippet } = splitDuckDuckGoResultText(entry.Text.trim())
      results.push({ title, url: entry.FirstURL, snippet })
    }
  }

  return results
}

/**
 * Queries the DuckDuckGo Instant Answer API and returns up to 5 results.
 * The "t" parameter identifies the requesting application to DuckDuckGo.
 */
export async function fetchDuckDuckGoResults(query: string): Promise<WebSearchResult[]> {
  const url = new URL('https://api.duckduckgo.com/')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('no_html', '1')
  url.searchParams.set('skip_disambig', '1')
  url.searchParams.set('t', 'airi')

  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`DuckDuckGo request failed with status ${response.status}`)

  return parseDuckDuckGoInstantAnswer(await response.json() as unknown, query)
}
