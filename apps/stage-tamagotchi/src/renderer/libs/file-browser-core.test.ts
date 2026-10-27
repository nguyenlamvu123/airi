import { describe, expect, it } from 'vitest'

import { getParentPath, matchFileBrowserCommand } from './file-browser-core'

describe('matchFileBrowserCommand', () => {
  it('matches the canonical "duyệt file" keyword', () => {
    expect(matchFileBrowserCommand('duyệt file')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(matchFileBrowserCommand('Duyệt File')).toBe(true)
  })

  it('matches surrounding whitespace', () => {
    expect(matchFileBrowserCommand('  duyệt file  ')).toBe(true)
  })

  it('matches the diacritic-free variant', () => {
    expect(matchFileBrowserCommand('duyet file')).toBe(true)
  })

  it('rejects longer messages that merely start with the keyword', () => {
    expect(matchFileBrowserCommand('duyệt file nào')).toBe(false)
  })

  it('rejects unrelated messages', () => {
    expect(matchFileBrowserCommand('google: thời tiết')).toBe(false)
    expect(matchFileBrowserCommand('')).toBe(false)
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
