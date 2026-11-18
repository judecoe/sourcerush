/**
 * Worker-side half of question generation: the real Exa, Firecrawl and
 * Anthropic calls, and writing the pipeline's result to the room. Used by createRoom
 * ("Try it yourself" runs finishGeneration directly) and by the
 * 'generate-questions' job in src/jobs.ts (everything here).
 *
 * The pipeline itself (src/lib/questions/pipeline.ts) is pure; this file is
 * the only place that knows about `tools`.
 */

import type { ActionTools } from 'deepspace/worker'
import type { GenerationStepValue } from '../lib/generation-steps'
import { GENERATE_TIMEOUT_MS, SCRAPE_TIMEOUT_MS, SEARCH_TIMEOUT_MS } from '../lib/generation-timing'
import { USER_MESSAGES, type GenerateResult, type PipelineResult, type ScrapeResult } from '../lib/questions/pipeline'
import {
  readGenerateResponse,
  readScrapeResponse,
  readSearchResponse,
  SEARCH_EXCLUDED_DOMAINS,
  type SearchResult,
} from '../lib/questions/responses'

export const QUESTION_MODEL = 'claude-haiku-5-5'
/**
 * Output tokens include the model's thinking, which the integration can't
 * turn off or cap. Real runs (AGENT_LOG.md, 2026-11-18): 5003 and 7677
 * tokens for 12 questions, where the question JSON alone is ~2–2.5k tokens.
 * 12000 leaves room for long thinking; at the observed ~250 tokens/s a full
 * 12000 takes ~48 s, still inside GENERATE_TIMEOUT_MS (60 s). Billing follows
 * actual usage.
 */
export const GENERATE_MAX_TOKENS = 12_000

export const GENERATE_JOB_TYPE = 'generate-questions'
/** Exactly one of `url` (a pasted link) or `topic` (search for an article first). */
export type GenerateJobPayload =
  | { roomId: string; hostId: string; url: string; topic?: undefined }
  | { roomId: string; hostId: string; topic: string; url?: undefined }

/** How many Exa results to look through for a usable link. */
export const SEARCH_NUM_RESULTS = 5

/** One job queue per room, so two hosts' rooms never wait on each other. */
export function jobQueueId(roomId: string): string {
  return `room:${roomId}`
}

/** Id of question number `index` in a room. Shared by `questions` and `answerKeys`. */
export function questionRecordId(roomId: string, index: number): string {
  return `${roomId}:${index}`
}

/**
 * Mark a room 'failed' so it never sits in 'generating'. If this write fails
 * too, the room stays in 'generating' and only the log records it.
 */
export async function failRoom(tools: ActionTools, roomId: string, errorMessage: string): Promise<void> {
  const failed = await tools.update('rooms', roomId, { status: 'failed', errorMessage })
  if (!failed.success) {
    console.error(`[generate] room ${roomId}: could not mark failed: ${failed.error}`)
  }
}

/**
 * Record which generation step the job is on, for the room page's progress
 * list. Display only and best effort: a failed write is logged and the job
 * carries on (the page then shows the previous step).
 */
export async function setGenerationStep(tools: ActionTools, roomId: string, step: GenerationStepValue): Promise<void> {
  try {
    const updated = await tools.update('rooms', roomId, { generationStep: step })
    if (!updated.success) console.warn(`[generate] room ${roomId}: could not record step ${step}: ${updated.error}`)
  } catch (err) {
    console.warn(`[generate] room ${roomId}: could not record step ${step}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Reject after `ms`. The wrapped call keeps running; we just stop waiting for it. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Find an article for a topic room. Logs duration, result count and cost,
 * never the topic or the chosen URL.
 */
export async function searchArticle(tools: ActionTools, roomId: string, topic: string): Promise<SearchResult> {
  const started = Date.now()
  try {
    const r = await withTimeout(
      tools.integration('exa/search', {
        query: topic,
        numResults: SEARCH_NUM_RESULTS,
        type: 'auto',
        excludeDomains: [...SEARCH_EXCLUDED_DOMAINS],
      }),
      SEARCH_TIMEOUT_MS,
      'search',
    )
    if (!r.success) {
      console.info(`[generate] room ${roomId}: search ${Date.now() - started} ms, failed`)
      // Code and status only: a provider error message could echo the query (the topic).
      return { ok: false, noneFound: false, log: `${r.code ?? 'error'} (HTTP ${r.status ?? '?'})` }
    }
    const { result, metrics } = readSearchResponse(r.data)
    console.info(`[generate] room ${roomId}: search ${Date.now() - started} ms, ${metrics}`)
    return result
  } catch (err) {
    console.info(`[generate] room ${roomId}: search ${Date.now() - started} ms, threw`)
    throw err
  }
}

/** Real scrape for the pipeline. Logs duration and cost, never page text. */
export async function scrapeArticle(tools: ActionTools, roomId: string, url: string): Promise<ScrapeResult> {
  const started = Date.now()
  try {
    const r = await withTimeout(
      tools.integration('firecrawl/scrape', {
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        // Ask Firecrawl to give up a little before we stop waiting.
        timeout: SCRAPE_TIMEOUT_MS - 5_000,
      }),
      SCRAPE_TIMEOUT_MS,
      'scrape',
    )
    if (!r.success) {
      console.info(`[generate] room ${roomId}: scrape ${Date.now() - started} ms, failed`)
      return { ok: false, log: `${r.code ?? 'error'} (HTTP ${r.status ?? '?'}): ${r.error}` }
    }
    const { result, metrics } = readScrapeResponse(r.data)
    console.info(`[generate] room ${roomId}: scrape ${Date.now() - started} ms, ${metrics}`)
    return result
  } catch (err) {
    console.info(`[generate] room ${roomId}: scrape ${Date.now() - started} ms, threw`)
    throw err
  }
}

/** Real generation for the pipeline. Logs duration, tokens and cost, never model output. */
export async function generateText(
  tools: ActionTools,
  roomId: string,
  attempt: number,
  system: string,
  user: string,
): Promise<GenerateResult> {
  const started = Date.now()
  try {
    const r = await withTimeout(
      tools.integration('anthropic/chat-completion', {
        model: QUESTION_MODEL,
        max_tokens: GENERATE_MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      GENERATE_TIMEOUT_MS,
      'generate',
    )
    if (!r.success) {
      console.info(`[generate] room ${roomId}: generate attempt ${attempt} ${Date.now() - started} ms, failed`)
      return { ok: false, log: `${r.code ?? 'error'} (HTTP ${r.status ?? '?'}): ${r.error}` }
    }
    const { result, metrics } = readGenerateResponse(r.data)
    console.info(`[generate] room ${roomId}: generate attempt ${attempt} ${Date.now() - started} ms, ${metrics}`)
    return result
  } catch (err) {
    console.info(`[generate] room ${roomId}: generate attempt ${attempt} ${Date.now() - started} ms, threw`)
    throw err
  }
}

/** Write the source and answer keys. Throws if any write fails. */
async function storeQuestions(
  tools: ActionTools,
  roomId: string,
  result: Extract<PipelineResult, { ok: true }>,
): Promise<void> {
  // fullText holds sourceUsed: exactly the text the model saw and every passage was
  // checked against, so a stored passage can always be found in it.
  const source = await tools.create('sources', { roomId, title: result.title, fullText: result.sourceUsed }, roomId)
  if (!source.success) throw new Error(`sources create failed: ${source.error}`)

  for (const [index, q] of result.questions.entries()) {
    const key = await tools.create(
      'answerKeys',
      {
        roomId,
        index,
        prompt: q.prompt,
        choices: q.choices,
        correctIndex: q.correctIndex,
        passage: q.passage,
        explanation: q.explanation,
      },
      questionRecordId(roomId, index),
    )
    if (!key.success) throw new Error(`answerKeys create failed for #${index}: ${key.error}`)
  }
}

/**
 * Apply a pipeline result to a room: store the questions and move to
 * 'lobby' (with `sourceUrl`, the article's link, when there is one; the
 * sample has none), or move to 'failed' with the result's user-safe
 * message. Logs the pipeline's log lines. Returns the room's new status, or null if the
 * final status write itself failed (the room then stays 'generating').
 */
export async function finishGeneration(
  tools: ActionTools,
  roomId: string,
  result: PipelineResult,
  sourceUrl?: string,
): Promise<{ status: 'lobby' | 'failed'; errorMessage?: string } | null> {
  for (const line of result.log) console.warn(`[generate] room ${roomId}: ${line}`)

  let next: { status: 'lobby' | 'failed'; sourceTitle?: string; sourceUrl?: string; errorMessage?: string }
  if (result.ok) {
    try {
      await storeQuestions(tools, roomId, result)
      next = { status: 'lobby', sourceTitle: result.title, ...(sourceUrl ? { sourceUrl } : {}) }
    } catch (err) {
      console.error(`[generate] room ${roomId}: storing questions failed: ${err instanceof Error ? err.message : String(err)}`)
      next = { status: 'failed', errorMessage: USER_MESSAGES.serviceUnavailable }
    }
  } else {
    next = { status: 'failed', errorMessage: result.userMessage }
  }

  const updated = await tools.update('rooms', roomId, next)
  if (!updated.success) {
    console.error(`[generate] room ${roomId}: status update to '${next.status}' failed: ${updated.error}`)
    return null
  }
  return { status: next.status, errorMessage: next.errorMessage }
}
