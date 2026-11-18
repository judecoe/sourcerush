/**
 * Read the two integration responses into the pipeline's result types,
 * checking every field we use. Pure, so a changed response shape is caught
 * by a unit test and turns into a "not ok" result instead of a crash.
 *
 * Shapes confirmed with one real call each (AGENT_LOG.md, 2026-11-18):
 *   firecrawl/scrape:          data = { data: { markdown, metadata: { title, statusCode } }, creditsUsed, costUsd }
 *   anthropic/chat-completion: data = { content: [...blocks], stop_reason, usage: { output_tokens }, costUsd }
 *     where the text is in the block(s) with type 'text', not necessarily content[0]
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
