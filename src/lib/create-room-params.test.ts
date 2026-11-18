import { describe, expect, it } from 'vitest'
import { MAX_URL_LENGTH, parseCreateRoomParams } from './create-room-params'

describe('parseCreateRoomParams', () => {
  it('accepts { sample: true }', () => {
    expect(parseCreateRoomParams({ sample: true })).toEqual({ ok: true, kind: 'sample' })
  })

  it('accepts http and https links, trimmed', () => {
    expect(parseCreateRoomParams({ url: '  https://en.wikipedia.org/wiki/Tide ' })).toEqual({
      ok: true,
      kind: 'url',
      url: 'https://en.wikipedia.org/wiki/Tide',
    })
    expect(parseCreateRoomParams({ url: 'http://example.com/a' })).toMatchObject({ ok: true, kind: 'url' })
  })

  it('requires exactly one of url or sample', () => {
    expect(parseCreateRoomParams({}).ok).toBe(false)
    expect(parseCreateRoomParams({ sample: true, url: 'https://example.com' }).ok).toBe(false)
    expect(parseCreateRoomParams({ sample: 'yes' }).ok).toBe(false)
  })

  it('rejects other schemes, malformed and over-long links', () => {
    for (const url of ['ftp://example.com/a', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', '', '   ', 42]) {
      expect(parseCreateRoomParams({ url }).ok, String(url)).toBe(false)
    }
    const long = 'https://example.com/' + 'a'.repeat(MAX_URL_LENGTH)
    expect(parseCreateRoomParams({ url: long })).toEqual({ ok: false, error: 'That link is too long.' })
  })
})
