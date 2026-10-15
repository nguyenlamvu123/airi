import { findCommandKeywords } from '@proj-airi/stage-ui/stores/command-keywords'
import { describe, expect, it } from 'vitest'

import { parseSearchCommand } from './web-search-core'

const keywords = ['duyệt web', 'duyet web']

describe('parseSearchCommand', () => {
  it('extracts the query after the accented keyword', () => {
    expect(parseSearchCommand('duyệt web: kyoto', keywords)).toBe('kyoto')
  })

  it('extracts the query after the unaccented keyword', () => {
    expect(parseSearchCommand('duyet web: kyoto', keywords)).toBe('kyoto')
  })

  it('accepts the query without a separating colon', () => {
    expect(parseSearchCommand('duyệt web kyoto', keywords)).toBe('kyoto')
  })

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(parseSearchCommand('  DUYỆT WEB:   kyoto  ', keywords)).toBe('kyoto')
  })

  it('returns undefined when the query is empty', () => {
    expect(parseSearchCommand('duyệt web:', keywords)).toBeUndefined()
    expect(parseSearchCommand('duyet web:   ', keywords)).toBeUndefined()
  })

  it('rejects tokens that merely start with the keyword', () => {
    expect(parseSearchCommand('duyệt webbing', keywords)).toBeUndefined()
  })

  it('returns undefined for unrelated messages', () => {
    expect(parseSearchCommand('hello', keywords)).toBeUndefined()
    expect(parseSearchCommand('kyoto duyệt web:', keywords)).toBeUndefined()
  })

  it('reads its keywords from states.json', () => {
    const configured = findCommandKeywords('web-search')
    expect(configured.length).toBeGreaterThan(0)
    for (const keyword of configured)
      expect(parseSearchCommand(`${keyword} kyoto`)).toBe('kyoto')
  })
})
