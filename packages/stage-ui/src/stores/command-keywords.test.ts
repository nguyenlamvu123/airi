import { describe, expect, it } from 'vitest'

import { COMMAND_PREFIX, findCommandKeywords, isCommandFilename, omitCommandEntries } from './command-keywords'

describe('isCommandFilename', () => {
  it('detects the @command: sentinel', () => {
    expect(isCommandFilename(`${COMMAND_PREFIX}file-browser`)).toBe(true)
    expect(COMMAND_PREFIX).toBe('@command:')
  })

  it('does not flag regular state images', () => {
    expect(isCommandFilename('character.png')).toBe(false)
    expect(isCommandFilename('duatay.png')).toBe(false)
  })
})

describe('findCommandKeywords', () => {
  it('returns every keyword mapped to the command', () => {
    const mapping = {
      'duyệt file': '@command:file-browser',
      'duyet file': '@command:file-browser',
      'bình thường': 'character.png',
    }

    expect(findCommandKeywords('file-browser', mapping)).toEqual(['duyệt file', 'duyet file'])
  })

  it('returns an empty list when no keyword is registered', () => {
    expect(findCommandKeywords('file-browser', { 'bình thường': 'character.png' })).toEqual([])
  })

  it('finds the bundled states.json keywords', () => {
    expect(findCommandKeywords('file-browser').length).toBeGreaterThan(0)
    expect(findCommandKeywords('web-search').length).toBeGreaterThan(0)
  })
})

describe('omitCommandEntries', () => {
  it('drops @command: entries and keeps state images', () => {
    const mapping = {
      'duyệt file': '@command:file-browser',
      'bình thường': 'character.png',
    }

    expect(omitCommandEntries(mapping)).toEqual({ 'bình thường': 'character.png' })
  })

  it('preserves an empty mapping', () => {
    expect(omitCommandEntries({})).toEqual({})
  })
})
