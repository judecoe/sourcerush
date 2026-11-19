import { describe, expect, it } from 'vitest'
import { DISPLAY_NAME_MAX, parseDisplayName, pickDisplayName } from './display-name'

describe('parseDisplayName', () => {
  it('trims and collapses repeated spaces', () => {
    expect(parseDisplayName('  Ada   Lovelace ')).toEqual({ ok: true, name: 'Ada Lovelace' })
  })

  it('accepts exactly the maximum length', () => {
    const name = 'a'.repeat(DISPLAY_NAME_MAX)
    expect(parseDisplayName(name)).toEqual({ ok: true, name })
  })

  it('refuses empty, too long, multi-line and non-string input', () => {
    expect(parseDisplayName('   ').ok).toBe(false)
    expect(parseDisplayName('a'.repeat(DISPLAY_NAME_MAX + 1)).ok).toBe(false)
    expect(parseDisplayName('Ada\nLovelace').ok).toBe(false)
    expect(parseDisplayName('Ada\tLovelace').ok).toBe(false)
    expect(parseDisplayName(42).ok).toBe(false)
    expect(parseDisplayName(undefined).ok).toBe(false)
  })
})

describe('pickDisplayName', () => {
  it('prefers a valid chosen name', () => {
    expect(pickDisplayName(' Ada ', 'Augusta King')).toBe('Ada')
  })

  it('falls back to the sign-in name when the chosen one is missing or invalid', () => {
    expect(pickDisplayName(undefined, ' Augusta King ')).toBe('Augusta King')
    expect(pickDisplayName('x'.repeat(DISPLAY_NAME_MAX + 1), 'Augusta King')).toBe('Augusta King')
    expect(pickDisplayName('two\nlines', 'Augusta King')).toBe('Augusta King')
  })

  it('falls back to "Player" when there is no usable name at all', () => {
    expect(pickDisplayName('', '')).toBe('Player')
    expect(pickDisplayName(undefined, undefined)).toBe('Player')
  })
})
