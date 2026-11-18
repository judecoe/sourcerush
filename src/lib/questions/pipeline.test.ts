import { describe, expect, it, vi } from 'vitest'
import { GENERATE_TIMEOUT_MS, SCRAPE_TIMEOUT_MS, SEARCH_TIMEOUT_MS, STALE_GENERATING_MS } from '../generation-timing'
import { BROKEN_FIXTURE_CANDIDATES, FIXTURE_CANDIDATES, FIXTURE_SOURCE, SAMPLE_PIPELINE_DEPS } from './fixtures'
import {
  GENERATE_ATTEMPTS,
  MIN_ARTICLE_CHARS,
  topicRoomResult,
  USER_MESSAGES,
  runQuestionPipeline,
  type GenerateResult,
  type PipelineDeps,
  type PipelineResult,
  type ScrapeResult,
  type UserMessage,
} from './pipeline'
import { MAX_SOURCE_CHARS, QUESTIONS_MIN_USABLE, systemPrompt } from './prompt'
import { readGenerateResponse, readScrapeResponse, readSearchResponse } from './responses'

const URL = 'https://example.com/article'
const GOOD = JSON.stringify({ questions: FIXTURE_CANDIDATES })
const BROKEN = JSON.stringify({ questions: BROKEN_FIXTURE_CANDIDATES })

/** Fakes: scrape returns the fixture article; generate returns `outputs` in order. */
function fakes(outputs: GenerateResult[], scrape?: ScrapeResult) {
  const generate = vi.fn<PipelineDeps['generate']>()
  for (const out of outputs) generate.mockResolvedValueOnce(out)
  const deps: PipelineDeps = {
    scrape: async () => scrape ?? { ok: true, title: FIXTURE_SOURCE.title, markdown: FIXTURE_SOURCE.text, statusCode: 200 },
    generate,
  }
  return { deps, generate }
}

const ALL_MESSAGES: string[] = Object.values(USER_MESSAGES)

describe('topicRoomResult', () => {
  const failed = (userMessage: UserMessage): PipelineResult => ({ ok: false, userMessage, log: ['x'] })

  it('rewords the two "that page" failures, keeping the log', () => {
    for (const m of [USER_MESSAGES.tooLittleText, USER_MESSAGES.pageUnreachable]) {
      expect(topicRoomResult(failed(m))).toEqual({
        ok: false,
        userMessage: USER_MESSAGES.topicArticleUnusable,
        log: ['x'],
      })
    }
  })

  it('leaves every other failure and success unchanged', () => {
    for (const m of [USER_MESSAGES.notEnoughQuestions, USER_MESSAGES.serviceUnavailable, USER_MESSAGES.noArticleFound]) {
      expect(topicRoomResult(failed(m))).toEqual(failed(m))
    }
    const ok: PipelineResult = { ok: true, title: 't', sourceUsed: 's', questions: [], log: [] }
    expect(topicRoomResult(ok)).toBe(ok)
  })

  it('always yields one of USER_MESSAGES', () => {
    for (const m of Object.values(USER_MESSAGES)) {
      const r = topicRoomResult(failed(m))
      if (!r.ok) expect(ALL_MESSAGES).toContain(r.userMessage)
    }
  })
})

describe('runQuestionPipeline', () => {
  it('succeeds on the first try', async () => {
    const { deps, generate } = fakes([{ ok: true, text: GOOD, stopReason: 'end_turn' }])
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(8)
    expect(result.title).toBe(FIXTURE_SOURCE.title)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('regenerates once when too few questions pass, then succeeds', async () => {
    const { deps, generate } = fakes([
      { ok: true, text: BROKEN },
      { ok: true, text: GOOD },
    ])
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result.ok).toBe(true)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(result.log.some((l) => l.includes('passage not found in source'))).toBe(true)
  })

  it('fails with notEnoughQuestions after two low-yield attempts', async () => {
    const { deps, generate } = fakes([
      { ok: true, text: BROKEN },
      { ok: true, text: BROKEN },
    ])
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result).toMatchObject({ ok: false, userMessage: USER_MESSAGES.notEnoughQuestions })
    expect(generate).toHaveBeenCalledTimes(GENERATE_ATTEMPTS)
  })

  it('treats unparseable output (e.g. cut off at max_tokens) as a low-yield attempt', async () => {
    const { deps, generate } = fakes([
      { ok: true, text: GOOD.slice(0, 200), stopReason: 'max_tokens' },
      { ok: true, text: GOOD },
    ])
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result.ok).toBe(true)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(result.log.some((l) => l.includes('not valid JSON') && l.includes('max_tokens'))).toBe(true)
  })

  it('validates passages against the cleaned text, not the markdown', async () => {
    // "Hallow Cross" sits inside a fixture passage. As a Wikipedia-style link
    // (parentheses in the URL, plus a title) the raw markdown would not match it.
    const markdown = FIXTURE_SOURCE.text.replace(
      'Hallow Cross',
      '[Hallow Cross](/wiki/Hallow_Cross_(town) "Hallow Cross (town)")',
    )
    const { deps } = fakes([{ ok: true, text: GOOD }], { ok: true, title: 'T', markdown })
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(8)
    expect(result.sourceUsed).not.toContain('](')
  })

  it('fails with tooLittleText when the cleaned text is short, even if the markdown is long', async () => {
    const markdown = '![chart](https://example.com/a.png)\n'.repeat(200) + 'A short paragraph.'
    expect(markdown.length).toBeGreaterThan(MIN_ARTICLE_CHARS)
    const { deps, generate } = fakes([], { ok: true, title: 'T', markdown })
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result).toMatchObject({ ok: false, userMessage: USER_MESSAGES.tooLittleText })
    expect(generate).not.toHaveBeenCalled()
  })

  it('fails with pageUnreachable when the page returned an HTTP error', async () => {
    const { deps, generate } = fakes([], { ok: true, title: '', markdown: FIXTURE_SOURCE.text, statusCode: 404 })
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result).toMatchObject({ ok: false, userMessage: USER_MESSAGES.pageUnreachable })
    expect(generate).not.toHaveBeenCalled()
  })

  it('fails with serviceUnavailable when the scrape fails or throws', async () => {
    const failed = await runQuestionPipeline(URL, fakes([], { ok: false, log: 'insufficient_credits' }).deps, 'link')
    expect(failed).toMatchObject({ ok: false, userMessage: USER_MESSAGES.serviceUnavailable })

    const threw = await runQuestionPipeline(URL, {
      scrape: async () => {
        throw new Error('scrape timed out after 30000 ms')
      },
      generate: vi.fn(),
    }, 'link')
    expect(threw).toMatchObject({ ok: false, userMessage: USER_MESSAGES.serviceUnavailable })
    expect(threw.log.join('\n')).toContain('timed out')
  })

  it('does not regenerate when the generate call itself fails', async () => {
    const { deps, generate } = fakes([{ ok: false, log: 'insufficient_credits (HTTP 402): Insufficient credits.' }])
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result).toMatchObject({ ok: false, userMessage: USER_MESSAGES.serviceUnavailable })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('fails with serviceUnavailable when an integration error throws from res.json()', async () => {
    // What callIntegration does when the api-worker answers with a non-JSON body.
    const generate = vi.fn<PipelineDeps['generate']>(async () => JSON.parse('<html>502 Bad Gateway</html>'))
    const result = await runQuestionPipeline(URL, { ...fakes([]).deps, generate }, 'link')
    expect(result).toMatchObject({ ok: false, userMessage: USER_MESSAGES.serviceUnavailable })
    expect(result.log.join('\n')).toMatch(/generate attempt 1 threw/)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('only ever stores one of the fixed user messages, never raw error text', async () => {
    const raw = 'SECRET-LOOKING upstream detail 12345'
    const cases: PipelineDeps[] = [
      fakes([], { ok: false, log: raw }).deps,
      fakes([{ ok: false, log: raw }]).deps,
      { scrape: async () => Promise.reject(new Error(raw)), generate: vi.fn() },
      fakes([{ ok: true, text: raw }, { ok: true, text: raw }]).deps,
    ]
    for (const deps of cases) {
      const result = await runQuestionPipeline(URL, deps, 'link')
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(ALL_MESSAGES).toContain(result.userMessage)
      expect(result.userMessage).not.toContain(raw)
    }
  })

  it('sends the prompt for the given kind', async () => {
    for (const kind of ['link', 'topic'] as const) {
      const { deps, generate } = fakes([{ ok: true, text: GOOD }])
      await runQuestionPipeline(URL, deps, kind)
      expect(generate.mock.calls[0][0]).toBe(systemPrompt(kind))
    }
  })

  it("keeps the model's question order (only the choices are shuffled)", async () => {
    const { deps } = fakes([{ ok: true, text: GOOD }])
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions.map((q) => q.prompt)).toEqual((FIXTURE_CANDIDATES as { prompt: string }[]).map((q) => q.prompt))
  })

  it('the "Try it yourself" fakes produce a full question set', async () => {
    const result = await runQuestionPipeline('sample', SAMPLE_PIPELINE_DEPS, 'link')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions.length).toBeGreaterThanOrEqual(QUESTIONS_MIN_USABLE)
    expect(result.title).toBe(FIXTURE_SOURCE.title)
    // The sample is shorter than MAX_SOURCE_CHARS, so it is stored whole, as before.
    expect(result.sourceUsed).toBe(FIXTURE_SOURCE.text.trim())
  })

  it('returns sourceUsed (the trimmed text the model saw), not the whole article', async () => {
    const long = FIXTURE_SOURCE.text + '\n\n' + 'More harbour history follows here. '.repeat(1500)
    expect(long.length).toBeGreaterThan(MAX_SOURCE_CHARS)
    const { deps } = fakes([{ ok: true, text: GOOD }], { ok: true, title: 'T', markdown: long })
    const result = await runQuestionPipeline(URL, deps, 'link')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sourceUsed).toHaveLength(MAX_SOURCE_CHARS)
    expect(long.startsWith(result.sourceUsed)).toBe(true)
  })
})

describe('integration response readers', () => {
  it('reads a Firecrawl scrape body', () => {
    const { result, metrics } = readScrapeResponse({
      data: { markdown: '# Tide', metadata: { title: 'Tide - Wikipedia', statusCode: 200 } },
      creditsUsed: 1,
      costUsd: 0.0038,
    })
    expect(result).toEqual({ ok: true, title: 'Tide - Wikipedia', markdown: '# Tide', statusCode: 200 })
    expect(metrics).toBe('creditsUsed 1, costUsd 0.0038')
  })

  it('reads an Anthropic message body', () => {
    const { result, metrics } = readGenerateResponse({
      content: [{ type: 'text', text: '{"questions":[]}' }],
      stop_reason: 'end_turn',
      usage: { output_tokens: 9 },
      costUsd: 0.0000078,
    })
    expect(result).toEqual({ ok: true, text: '{"questions":[]}', stopReason: 'end_turn' })
    expect(metrics).toBe(
      'stop_reason end_turn, output_tokens 9, costUsd 0.0000078, content types: text, text chars 16',
    )
  })

  it('finds the text when a non-text block comes first', () => {
    const { result, metrics } = readGenerateResponse({
      content: [
        { type: 'thinking', thinking: 'PRIVATE REASONING' },
        { type: 'text', text: '{"questions":[]}' },
      ],
      stop_reason: 'end_turn',
    })
    expect(result).toEqual({ ok: true, text: '{"questions":[]}', stopReason: 'end_turn' })
    expect(metrics).toContain('content types: thinking,text, text chars 16')
    expect(metrics).not.toContain('PRIVATE REASONING')
  })

  it('joins several text blocks in order', () => {
    const { result, metrics } = readGenerateResponse({
      content: [
        { type: 'text', text: '{"questions":' },
        { type: 'thinking', thinking: 'x' },
        { type: 'text', text: '[]}' },
      ],
    })
    expect(result).toEqual({ ok: true, text: '{"questions":[]}', stopReason: undefined })
    expect(metrics).toContain('content types: text,thinking,text, text chars 16')
  })

  it('fails when there is no text block, naming the block types only', () => {
    const { result, metrics } = readGenerateResponse({
      content: [{ type: 'thinking', thinking: 'PRIVATE REASONING' }, { type: 'redacted_thinking', data: 'zzz' }],
    })
    expect(result).toEqual({
      ok: false,
      log: 'response has no text block in data.content (types: thinking,redacted_thinking)',
    })
    expect(metrics).toContain('text chars 0')
    expect(JSON.stringify(result) + metrics).not.toContain('PRIVATE REASONING')
  })

  it('fails when content is missing or not an array', () => {
    for (const body of [{}, { content: 'not an array' }, { content: { type: 'text', text: 'x' } }, null]) {
      expect(readGenerateResponse(body).result, JSON.stringify(body)).toEqual({
        ok: false,
        log: 'response has no array at data.content',
      })
    }
  })

  it('returns not-ok naming the missing path instead of throwing', () => {
    expect(readScrapeResponse({ data: { metadata: {} } }).result).toEqual({
      ok: false,
      log: 'response has no string at data.data.markdown',
    })
    expect(readScrapeResponse({ data: { markdown: 'x' } }).result).toEqual({
      ok: false,
      log: 'response has no object at data.data.metadata',
    })
    expect(readScrapeResponse(undefined).result.ok).toBe(false)
    expect(readGenerateResponse({ content: [] }).result).toEqual({
      ok: false,
      log: 'response has no text block in data.content (types: none)',
    })
    expect(readGenerateResponse({ content: [{ type: 'text', text: 42 }] }).result.ok).toBe(false)
    expect(readGenerateResponse(null).metrics).toBe(
      'stop_reason unknown, output_tokens unknown, costUsd unknown, content types: none',
    )
  })

  it('a malformed response fails the room with serviceUnavailable', async () => {
    const badScrape = await runQuestionPipeline(URL, {
      scrape: async () => readScrapeResponse({ data: {} }).result,
      generate: vi.fn(),
    }, 'link')
    expect(badScrape).toMatchObject({ ok: false, userMessage: USER_MESSAGES.serviceUnavailable })
    expect(badScrape.log.join('\n')).toContain('data.data.markdown')

    const badGenerate = await runQuestionPipeline(URL, {
      ...fakes([]).deps,
      generate: async () => readGenerateResponse({ content: 'not an array' }).result,
    }, 'link')
    expect(badGenerate).toMatchObject({ ok: false, userMessage: USER_MESSAGES.serviceUnavailable })
    expect(badGenerate.log.join('\n')).toContain('data.content')
  })
})

describe('readSearchResponse (exa/search)', () => {
  const result = (url: unknown) => ({ title: 't', url, publishedDate: null, author: null, id: 'x' })

  it('picks the first usable result and reports count and cost', () => {
    const { result: r, metrics } = readSearchResponse({
      results: [result('https://example.com/tides'), result('https://example.org/other')],
      costUsd: 0.005,
    })
    expect(r).toEqual({ ok: true, url: 'https://example.com/tides' })
    expect(metrics).toBe('results 2, costUsd 0.005')
  })

  it('falls back to costDollars.total for the cost', () => {
    const { metrics } = readSearchResponse({ results: [], costDollars: { total: 0.007 } })
    expect(metrics).toBe('results 0, costUsd 0.007')
  })

  it('skips excluded sites (and their subdomains), non-http and malformed URLs', () => {
    const { result: r } = readSearchResponse({
      results: [
        result('https://www.youtube.com/watch?v=1'),
        result('https://m.facebook.com/post'),
        result('https://old.reddit.com/r/x'),
        result('https://x.com/a'),
        result('https://twitter.com/a'),
        result('https://www.tiktok.com/@a'),
        result('https://instagram.com/a'),
        result('ftp://example.com/file'),
        result('not a url'),
        result(42),
        'not an object',
        result('https://box.com/article'), // ends in "x.com" but isn't x.com
      ],
    })
    expect(r).toEqual({ ok: true, url: 'https://box.com/article' })
  })

  it('is not ok when nothing is usable, without naming any URL', () => {
    const { result: r, metrics } = readSearchResponse({ results: [result('https://youtube.com/watch?v=1')] })
    expect(r).toEqual({
      ok: false,
      noneFound: true,
      log: 'no usable search result (1 results, 1 skipped: bad URL or excluded site)',
    })
    expect(metrics).toBe('results 1, costUsd unknown')
    expect(readSearchResponse({ results: [] }).result).toMatchObject({ ok: false, noneFound: true })
  })

  it('is not ok when results is missing', () => {
    expect(readSearchResponse({}).result).toEqual({
      ok: false,
      noneFound: false,
      log: 'response has no array at data.results',
    })
    expect(readSearchResponse(null).result.ok).toBe(false)
  })
})

describe('generation timing', () => {
  it('the worst case (topic room: search + scrape + both generations) finishes before the room page calls it stale', () => {
    expect(SEARCH_TIMEOUT_MS + SCRAPE_TIMEOUT_MS + GENERATE_ATTEMPTS * GENERATE_TIMEOUT_MS).toBeLessThan(
      STALE_GENERATING_MS,
    )
  })
})
