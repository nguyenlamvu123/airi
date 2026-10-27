import { findCommandKeywords } from '@proj-airi/stage-ui/stores/command-keywords'
import { describe, expect, it } from 'vitest'

import { getParentPath, matchFileBrowserCommand } from './file-browser-core'

const keywords = ['duyệt file', 'duyet file']

describe('matchFileBrowserCommand', () => {
  it('matches an exact keyword', () => {
    expect(matchFileBrowserCommand('duyệt file', keywords)).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(matchFileBrowserCommand('Duyệt File', keywords)).toBe(true)
  })

  it('matches surrounding whitespace', () => {
    expect(matchFileBrowserCommand('  duyệt file  ', keywords)).toBe(true)
  })

  it('matches the diacritic-free variant', () => {
    expect(matchFileBrowserCommand('duyet file', keywords)).toBe(true)
  })

  it('rejects longer messages that merely start with the keyword', () => {
    expect(matchFileBrowserCommand('duyệt file nào', keywords)).toBe(false)
  })

  it('rejects unrelated messages', () => {
    expect(matchFileBrowserCommand('google: thời tiết', keywords)).toBe(false)
    expect(matchFileBrowserCommand('', keywords)).toBe(false)
  })

  it('reads its keywords from states.json', () => {
    const configured = findCommandKeywords('file-browser')
    expect(configured.length).toBeGreaterThan(0)
    for (const keyword of configured)
      expect(matchFileBrowserCommand(keyword)).toBe(true)
  })
})

describe('getParentPath', () => {
  it('returns the parent of a nested POSIX path', () => {
    expect(getParentPath('/home/user/docs')).toBe('/home/user')
    expect(getParentPath('/home/user')).toBe('/home')
  })

  it('returns the root for a top-level path', () => {
    expect(getParentPath('/home')).toBe('/')
    expect(getParentPath('/')).toBe('/')
  })

  it('handles Windows-style separators', () => {
    expect(getParentPath('C:\\Users\\name')).toBe('C:/Users')
    expect(getParentPath('C:\\Users\\name\\docs')).toBe('C:/Users/name')
  })
})
