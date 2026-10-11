import { describe, expect, test } from 'vitest'
import { readCookie } from './cookies'

describe('readCookie', () => {
  test('finds the named cookie among others', () => {
    expect(readCookie('a=1; sidebar_state=false; b=2', 'sidebar_state')).toBe(
      'false',
    )
  })

  test('matches the whole name, not a suffix or prefix', () => {
    expect(readCookie('xsidebar_state=true', 'sidebar_state')).toBeUndefined()
    expect(readCookie('sidebar_statex=true', 'sidebar_state')).toBeUndefined()
  })

  test('keeps "=" inside the value', () => {
    expect(readCookie('token=a=b', 'token')).toBe('a=b')
  })

  test('returns undefined when absent or empty', () => {
    expect(readCookie('', 'sidebar_state')).toBeUndefined()
    expect(readCookie(undefined, 'sidebar_state')).toBeUndefined()
    expect(readCookie('a=1', 'sidebar_state')).toBeUndefined()
  })
})
