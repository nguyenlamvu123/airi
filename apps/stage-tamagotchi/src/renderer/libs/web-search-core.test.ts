import { describe, expect, it } from 'vitest'

import { parseSearchCommand } from './web-search-core'

describe('parseSearchCommand', () => {
  it('extracts the query after the accented keyword', () => {
    expect(parseSearchCommand('tìm kiếm: kyoto')).toBe('kyoto')
  })

  it('extracts the query after the unaccented keyword', () => {
    expect(parseSearchCommand('tim kiem: kyoto')).toBe('kyoto')
  })

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(parseSearchCommand('  TÌM KIẾM:   kyoto  ')).toBe('kyoto')
  })

  it('returns undefined when the query is empty', () => {
    expect(parseSearchCommand('tìm kiếm:')).toBeUndefined()
    expect(parseSearchCommand('tim kiem:   ')).toBeUndefined()
  })

  it('returns undefined for unrelated messages', () => {
    expect(parseSearchCommand('hello')).toBeUndefined()
    expect(parseSearchCommand('kyoto tìm kiếm:')).toBeUndefined()
  })
})
