import { describe, expect, it } from 'vitest'

import { parseWikipediaSearch, stripWikipediaSnippet, wikipediaLanguageFor } from './wikipedia'

describe('wikipediaLanguageFor', () => {
  it('picks Vietnamese when the query has Vietnamese letters', () => {
    expect(wikipediaLanguageFor('thời tiết hà nội')).toBe('vi')
    expect(wikipediaLanguageFor('Đà Lạt')).toBe('vi')
  })

  it('picks English otherwise, including Vietnamese typed without diacritics', () => {
    expect(wikipediaLanguageFor('vue 3 composition api')).toBe('en')
    expect(wikipediaLanguageFor('thoi tiet ha noi')).toBe('en')
  })
})

describe('stripWikipediaSnippet', () => {
  it('drops highlight markup and decodes entities', () => {
    expect(stripWikipediaSnippet('dân số <span class="searchmatch">Hà</span> &quot;Nội&quot;')).toBe('dân số Hà "Nội"')
  })

  it('decodes &amp; last so an escaped entity stays literal', () => {
    expect(stripWikipediaSnippet('A &amp;quot; B &amp; C')).toBe('A &quot; B & C')
  })
})

describe('parseWikipediaSearch', () => {
  it('builds article links with underscores and a readable slash', () => {
    const results = parseWikipediaSearch({
      query: { search: [{ title: 'AC/DC', snippet: '<span class="searchmatch">AC/DC</span> are a rock band' }] },
    }, 'en')
    expect(results).toEqual([{ title: 'AC/DC', url: 'https://en.wikipedia.org/wiki/AC/DC', snippet: 'AC/DC are a rock band' }])
  })

  it('returns an empty list for an unexpected payload', () => {
    expect(parseWikipediaSearch(null, 'vi')).toEqual([])
    expect(parseWikipediaSearch({ error: { code: 'maxlag' } }, 'vi')).toEqual([])
  })
})
