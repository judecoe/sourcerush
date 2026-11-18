import { describe, expect, it } from 'vitest'
import { MAX_TOPIC_LENGTH, MAX_URL_LENGTH, parseCreateRoomParams } from './create-room-params'

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

  it('requires exactly one of url, topic or sample', () => {
    expect(parseCreateRoomParams({}).ok).toBe(false)
    expect(parseCreateRoomParams({ sample: true, url: 'https://example.com' }).ok).toBe(false)
    expect(parseCreateRoomParams({ sample: true, topic: 'tides' }).ok).toBe(false)
    expect(parseCreateRoomParams({ url: 'https://example.com', topic: 'tides' }).ok).toBe(false)
    expect(parseCreateRoomParams({ url: 'https://example.com', topic: 'tides', sample: true }).ok).toBe(false)
    expect(parseCreateRoomParams({ sample: 'yes' }).ok).toBe(false)
  })

  it('accepts a topic, trimmed', () => {
    expect(parseCreateRoomParams({ topic: '  history of the lighthouse  ' })).toEqual({
      ok: true,
      kind: 'topic',
      topic: 'history of the lighthouse',
    })
    expect(parseCreateRoomParams({ topic: 'abc' })).toMatchObject({ ok: true, kind: 'topic' })
    expect(parseCreateRoomParams({ topic: 'x'.repeat(MAX_TOPIC_LENGTH) })).toMatchObject({ ok: true })
  })

  it('rejects short, long, multi-line, non-string and link topics', () => {
    for (const topic of ['', '   ', 'ab', '  ab  ', 42, null, ['tides']]) {
      expect(parseCreateRoomParams({ topic }).ok, String(topic)).toBe(false)
    }
    expect(parseCreateRoomParams({ topic: 'x'.repeat(MAX_TOPIC_LENGTH + 1) }).ok).toBe(false)
    expect(parseCreateRoomParams({ topic: 'tides\nand moons' }).ok).toBe(false)
    expect(parseCreateRoomParams({ topic: 'tides\tand moons' }).ok).toBe(false)
    expect(parseCreateRoomParams({ topic: 'tides\u0000' }).ok).toBe(false)
    expect(parseCreateRoomParams({ topic: 'https://example.com/tides' }).ok).toBe(false)
    expect(parseCreateRoomParams({ topic: 'HTTP://example.com' }).ok).toBe(false)
  })

  it('rejects other schemes, malformed and over-long links', () => {
    for (const url of ['ftp://example.com/a', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', '', '   ', 42]) {
      expect(parseCreateRoomParams({ url }).ok, String(url)).toBe(false)
    }
    const long = 'https://example.com/' + 'a'.repeat(MAX_URL_LENGTH)
    expect(parseCreateRoomParams({ url: long })).toEqual({ ok: false, error: 'That link is too long.' })
  })
})
