import { describe, expect, it } from 'vitest'

import { parseDuckDuckGoInstantAnswer, splitDuckDuckGoResultText } from './duckduckgo'

describe('splitDuckDuckGoResultText', () => {
  it('splits title and snippet on the first separator', () => {
    expect(splitDuckDuckGoResultText('Kyoto - Historic city of Japan')).toEqual({
      title: 'Kyoto',
      snippet: 'Historic city of Japan',
    })
  })

  it('keeps the full text as title when there is no separator', () => {
    expect(splitDuckDuckGoResultText('Just a title')).toEqual({
      title: 'Just a title',
      snippet: '',
    })
  })
})

describe('parseDuckDuckGoInstantAnswer', () => {
  it('returns an empty list for a non-object payload', () => {
    expect(parseDuckDuckGoInstantAnswer(null, 'kyoto')).toEqual([])
    expect(parseDuckDuckGoInstantAnswer('nope', 'kyoto')).toEqual([])
  })

  it('promotes the abstract to the first result', () => {
    const results = parseDuckDuckGoInstantAnswer({
      Heading: 'Kyoto',
      AbstractURL: 'https://en.wikipedia.org/wiki/Kyoto',
      AbstractText: 'Kyoto is a city in Japan.',
    }, 'kyoto')

    expect(results[0]).toEqual({
      title: 'Kyoto',
      url: 'https://en.wikipedia.org/wiki/Kyoto',
      snippet: 'Kyoto is a city in Japan.',
    })
  })

  it('falls back to the computation answer when no abstract exists', () => {
    const results = parseDuckDuckGoInstantAnswer({
      Answer: '25',
      AnswerType: 'computation',
    }, '5*5')

    expect(results[0]).toEqual({
      title: '5*5',
      url: 'https://duckduckgo.com/?q=5*5',
      snippet: '25',
    })
  })

  it('flattens nested related-topic groups', () => {
    const results = parseDuckDuckGoInstantAnswer({
      RelatedTopics: [
        {
          Name: 'Cities',
          Topics: [
            { FirstURL: 'https://example.com/kyoto', Text: 'Kyoto - A city' },
            { FirstURL: 'https://example.com/osaka', Text: 'Osaka - Another city' },
          ],
        },
      ],
    }, 'kyoto')

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      title: 'Kyoto',
      url: 'https://example.com/kyoto',
      snippet: 'A city',
    })
  })

  it('accepts top-level flat topics', () => {
    const results = parseDuckDuckGoInstantAnswer({
      RelatedTopics: [
        { FirstURL: 'https://example.com/kyoto', Text: 'Kyoto - A city' },
      ],
    }, 'kyoto')

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://example.com/kyoto')
  })

  it('skips topics without text or url', () => {
    const results = parseDuckDuckGoInstantAnswer({
      RelatedTopics: [
        { FirstURL: 'https://example.com/ok', Text: 'Valid - result' },
        { FirstURL: '', Text: 'No url' },
        { FirstURL: 'https://example.com/no-text' },
      ],
    }, 'query')

    expect(results).toHaveLength(1)
  })

  it('caps the result list at 5 entries', () => {
    const topics = Array.from({ length: 8 }, (_, index) => ({
      FirstURL: `https://example.com/${index}`,
      Text: `Result ${index} - snippet ${index}`,
    }))
    const results = parseDuckDuckGoInstantAnswer({ RelatedTopics: topics }, 'query')

    expect(results).toHaveLength(5)
  })
})
