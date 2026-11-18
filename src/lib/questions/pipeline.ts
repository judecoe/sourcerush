/**
 * The question pipeline, with scrape and generate passed in:
 *
 *   scrape → markdownToPlainText → length check → buildQuestionPrompt
 *   → generate → parseModelOutput → prepareQuestions (validate against
 *   sourceUsed + shuffle) → if fewer than QUESTIONS_MIN_USABLE pass,
 *   generate once more → otherwise fail.
 *
 * Pure apart from the two functions it is given: the job passes real
 * integration calls (src/server/generation.ts), the "Try it yourself" path
 * and the unit tests pass fakes. No SDK imports here.
 *
 * `userMessage` is stored on the room, which players can read, so it is
 * always one of USER_MESSAGES. Raw errors and rejection reasons go into
 * `log`, which only the server prints.
 */

import { markdownToPlainText } from './markdown'
import { prepareQuestions } from './prepare'
import { buildQuestionPrompt, type SourceKind } from './prompt'
import { parseModelOutput, type Question } from './validate'

/** Minimum article length, in characters of plain text after cleanup. */
export const MIN_ARTICLE_CHARS = 2000

/** The first generation plus one regenerate. */
export const GENERATE_ATTEMPTS = 2

export const USER_MESSAGES = {
  tooLittleText: "There isn't enough article text on that page to make a quiz.",
  pageUnreachable: "Couldn't open that page.",
  noArticleFound: "Couldn't find a suitable article for that topic. Try wording it differently.",
  // Topic rooms only, in place of tooLittleText / pageUnreachable (see topicRoomResult):
  // the host typed a topic and never chose "that page".
  topicArticleUnusable: "The article we found didn't have enough usable text. Try a different topic.",
  notEnoughQuestions: "Couldn't make enough questions from this article.",
  serviceUnavailable: 'The question service is unavailable right now. Please try again.',
} as const

export type UserMessage = (typeof USER_MESSAGES)[keyof typeof USER_MESSAGES]

export type ScrapeResult =
  | { ok: true; title: string; markdown: string; statusCode?: number }
  | { ok: false; log: string }

export type GenerateResult = { ok: true; text: string; stopReason?: string } | { ok: false; log: string }

export interface PipelineDeps {
  scrape: (url: string) => Promise<ScrapeResult>
  generate: (system: string, user: string) => Promise<GenerateResult>
  random?: () => number
}

export type PipelineResult =
  /** `sourceUsed` is the trimmed text the model saw and the passages were validated against. */
  | { ok: true; title: string; sourceUsed: string; questions: Question[]; log: string[] }
  | { ok: false; userMessage: UserMessage; log: string[] }

/**
 * A topic room's version of a pipeline result. The page was picked by the
 * search, not the host, so the two "this page" failures (tooLittleText,
 * pageUnreachable) become topicArticleUnusable. Everything else, success
 * included, is returned unchanged. Link rooms don't use this.
 */
export function topicRoomResult(result: PipelineResult): PipelineResult {
  if (result.ok) return result
  if (result.userMessage !== USER_MESSAGES.tooLittleText && result.userMessage !== USER_MESSAGES.pageUnreachable) {
    return result
  }
  return { ...result, userMessage: USER_MESSAGES.topicArticleUnusable }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * `kind` picks the prompt: 'link' when the host chose the article, 'topic'
 * when a search found it (see buildQuestionPrompt). Nothing else depends on it.
 */
export async function runQuestionPipeline(
  url: string,
  deps: PipelineDeps,
  kind: SourceKind,
): Promise<PipelineResult> {
  const log: string[] = []
  function fail(userMessage: UserMessage, line: string): PipelineResult {
    log.push(line)
    return { ok: false, userMessage, log }
  }

  // 1. Scrape. Anything unexpected here is the service's fault, not the article's.
  let scraped: ScrapeResult
  try {
    scraped = await deps.scrape(url)
  } catch (err) {
    return fail(USER_MESSAGES.serviceUnavailable, `scrape threw: ${errorText(err)}`)
  }
  if (!scraped.ok) return fail(USER_MESSAGES.serviceUnavailable, `scrape failed: ${scraped.log}`)
  if (scraped.statusCode !== undefined && scraped.statusCode >= 400) {
    return fail(USER_MESSAGES.pageUnreachable, `page returned HTTP ${scraped.statusCode}`)
  }

  // 2. Clean to plain text, so sourceUsed and every passage are plain text too.
  const text = markdownToPlainText(scraped.markdown)
  if (text.length < MIN_ARTICLE_CHARS) {
    return fail(
      USER_MESSAGES.tooLittleText,
      `only ${text.length} chars of text after cleanup (need ${MIN_ARTICLE_CHARS})`,
    )
  }
  const source = { title: scraped.title.trim() || url, text }
  const { system, user, sourceUsed } = buildQuestionPrompt(source, kind)

  // 3. Generate; regenerate once if too few questions pass or the output
  //    doesn't parse. A failed call is not retried (it may be out of credits).
  for (let attempt = 1; attempt <= GENERATE_ATTEMPTS; attempt++) {
    let generated: GenerateResult
    try {
      generated = await deps.generate(system, user)
    } catch (err) {
      return fail(USER_MESSAGES.serviceUnavailable, `generate attempt ${attempt} threw: ${errorText(err)}`)
    }
    if (!generated.ok) {
      return fail(USER_MESSAGES.serviceUnavailable, `generate attempt ${attempt} failed: ${generated.log}`)
    }

    let candidates: unknown[]
    try {
      candidates = parseModelOutput(generated.text)
    } catch (err) {
      log.push(`attempt ${attempt}: ${errorText(err)} (stop_reason ${generated.stopReason ?? 'unknown'})`)
      continue
    }

    const prepared = prepareQuestions(source, candidates, deps.random)
    for (const r of prepared.rejected) {
      log.push(`attempt ${attempt}: rejected question ${r.index}: ${r.reasons.join('; ')}`)
    }
    if (prepared.ok) return { ok: true, title: source.title, sourceUsed, questions: prepared.questions, log }
    log.push(`attempt ${attempt}: ${prepared.error}`)
  }
  return fail(USER_MESSAGES.notEnoughQuestions, `gave up after ${GENERATE_ATTEMPTS} attempts`)
}
