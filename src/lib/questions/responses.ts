/**
 * Read the integration responses into the pipeline's result types,
 * checking every field we use. Pure, so a changed response shape is caught
 * by a unit test and turns into a "not ok" result instead of a crash.
 *
 * Shapes confirmed with one real call each (AGENT_LOG.md, 2026-11-18):
 *   firecrawl/scrape:          data = { data: { markdown, metadata: { title, statusCode } }, creditsUsed, costUsd }
 *   anthropic/chat-completion: data = { content: [...blocks], stop_reason, usage: { output_tokens }, costUsd }
 *     where the text is in the block(s) with type 'text', not necessarily content[0]
 *   exa/search:                data = { results: [{ title, url, publishedDate, author, id, ... }], costDollars: { total }, costUsd }
 *     (from `npx deepspace integrations info exa/search`'s output schema; one real call, 2026-11-18,
 *     confirmed `results` (5 items, a usable `url` that Firecrawl scraped) and a numeric `costUsd`
 *     (0.007). The `costDollars.total` fallback has not been seen in a real response.)
 * `data` is what `tools.integration` returns on success. Paths in log lines
 * are written from there, e.g. `data.data.markdown`.
 */

import type { GenerateResult, ScrapeResult } from './pipeline'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function numberOrUnknown(v: unknown): string {
  return typeof v === 'number' ? String(v) : 'unknown'
}

/** The scrape result, plus a metrics line for the logs (no article text). */
export function readScrapeResponse(data: unknown): { result: ScrapeResult; metrics: string } {
  const body = isObject(data) ? data : {}
  const metrics = `creditsUsed ${numberOrUnknown(body.creditsUsed)}, costUsd ${numberOrUnknown(body.costUsd)}`
  const page = isObject(body.data) ? body.data : {}

  if (typeof page.markdown !== 'string') {
    return { result: { ok: false, log: 'response has no string at data.data.markdown' }, metrics }
  }
  if (!isObject(page.metadata)) {
    return { result: { ok: false, log: 'response has no object at data.data.metadata' }, metrics }
  }
  const title = typeof page.metadata.title === 'string' ? page.metadata.title : ''
  const statusCode = typeof page.metadata.statusCode === 'number' ? page.metadata.statusCode : undefined
  return { result: { ok: true, title, markdown: page.markdown, statusCode }, metrics }
}

/**
 * The model's text, plus a metrics line for the logs (block types and
 * lengths only, never model output).
 *
 * `content` is a list of blocks and the text is not always first: the first
 * real run (AGENT_LOG.md, 2026-11-18) had a non-text block at content[0]. So
 * every `type: 'text'` block is collected and joined in order; other block
 * types (e.g. 'thinking') are ignored.
 */
export function readGenerateResponse(data: unknown): { result: GenerateResult; metrics: string } {
  const body = isObject(data) ? data : {}
  const usage = isObject(body.usage) ? body.usage : {}
  const stopReason = typeof body.stop_reason === 'string' ? body.stop_reason : undefined

  if (!Array.isArray(body.content)) {
    const metrics = `stop_reason ${stopReason ?? 'unknown'}, output_tokens ${numberOrUnknown(usage.output_tokens)}, costUsd ${numberOrUnknown(body.costUsd)}, content types: none`
    return { result: { ok: false, log: 'response has no array at data.content' }, metrics }
  }

  const blocks = body.content.map((b) => (isObject(b) ? b : {}))
  const types = blocks.map((b) => (typeof b.type === 'string' ? b.type : '?')).join(',') || 'none'
  const textBlocks = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string')
  // Joined with nothing in between: consecutive text blocks are one continuous answer.
  const text = textBlocks.map((b) => b.text as string).join('')

  const metrics =
    `stop_reason ${stopReason ?? 'unknown'}, output_tokens ${numberOrUnknown(usage.output_tokens)}, ` +
    `costUsd ${numberOrUnknown(body.costUsd)}, content types: ${types}, text chars ${text.length}`

  if (textBlocks.length === 0) {
    return { result: { ok: false, log: `response has no text block in data.content (types: ${types})` }, metrics }
  }
  return { result: { ok: true, text, stopReason }, metrics }
}

/**
 * Sites Exa is told to skip for topic rooms: video and social pages, which
 * rarely have enough article text for a quiz. Passed to exa/search as
 * `excludeDomains`, and checked again in readSearchResponse (subdomains
 * included) in case one slips through.
 */
export const SEARCH_EXCLUDED_DOMAINS = [
  'youtube.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'reddit.com',
] as const

/**
 * The article search result: the first usable link, or not ok. `noneFound`
 * is true when the search worked but no result was usable (the host should
 * try another topic), false when the call or the response itself was bad.
 */
export type SearchResult = { ok: true; url: string } | { ok: false; noneFound: boolean; log: string }

function isExcludedHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return SEARCH_EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
}

/**
 * The first result with an http(s) URL on an allowed site, plus a metrics
 * line for the logs. Neither the metrics nor the log line contain the topic,
 * a title or a URL (the URL would give the topic away).
 */
export function readSearchResponse(data: unknown): { result: SearchResult; metrics: string } {
  const body = isObject(data) ? data : {}
  const costDollars = isObject(body.costDollars) ? body.costDollars : {}
  const cost = typeof body.costUsd === 'number' ? body.costUsd : costDollars.total
  const count = Array.isArray(body.results) ? body.results.length : 0
  const metrics = `results ${count}, costUsd ${numberOrUnknown(cost)}`

  if (!Array.isArray(body.results)) {
    return { result: { ok: false, noneFound: false, log: 'response has no array at data.results' }, metrics }
  }

  let skipped = 0
  for (const item of body.results) {
    const raw = isObject(item) && typeof item.url === 'string' ? item.url : ''
    let parsed: URL | null = null
    try {
      parsed = new URL(raw)
    } catch {
      parsed = null
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || isExcludedHost(parsed.hostname)) {
      skipped++
      continue
    }
    return { result: { ok: true, url: parsed.href }, metrics }
  }
  return {
    result: {
      ok: false,
      noneFound: true,
      log: `no usable search result (${count} results, ${skipped} skipped: bad URL or excluded site)`,
    },
    metrics,
  }
}
