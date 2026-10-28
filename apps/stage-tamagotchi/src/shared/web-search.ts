/**
 * DuckDuckGo results page for a query. The web search panel links to it for
 * full results, and instant answers without a source link point there too.
 */
export function duckDuckGoResultsUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
}
