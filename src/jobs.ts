/**
 * Background-job handler, invoked by AppJobRoom (worker.ts) for every job
 * picked up from a queue. One job type:
 *
 * 'generate-questions' { roomId, hostId, url } or { roomId, hostId, topic }
 *   Queued by createRoom (server only: worker.ts closes the job sockets to
 *   clients) on the room's own queue, `room:${roomId}`, with maxAttempts 1.
 *   For a topic, first asks Exa for articles (searchArticle); no usable
 *   result fails the room with USER_MESSAGES.noArticleFound. If a page is
 *   too short or unreachable it tries the next result, within one shared
 *   scrape budget (SCRAPE_TIMEOUT_MS). Then runs the
 *   question pipeline on the link against the real Firecrawl + Anthropic
 *   integrations, and sets the room to 'lobby' (with sourceUrl) or 'failed'.
 *   A topic room gets the topic prompt (kind 'topic'), a link room 'link'.
 *   For a topic room, a too-short or unreachable article fails with
 *   USER_MESSAGES.topicArticleUnusable instead (topicRoomResult).
 *   The topic is never logged.
 *   Before each step it records `rooms.generationStep` (topic:searching is
 *   set by createRoom; then reading, writing, checking once a reply arrives,
 *   rewriting on a second generation, and saving before the questions are
 *   stored), which the room page shows as a progress list.
 *
 * It acts as the room's host, so every row it creates has the same
 * `_created_by` as when createRoom did this work inline. It only creates
 * `sources` and `answerKeys` (read: false for everyone) and updates `rooms`
 * (an update keeps `_created_by`), so nobody can read anything new.
 *
 * It exits without writing if the room is no longer 'generating', checked
 * before and after the slow part. It never throws for a pipeline problem:
 * with maxAttempts 1 a throw would only mark the job failed and leave the
 * room stuck, so failures go to the room instead.
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../worker.js'
import { stepValue } from './lib/generation-steps.js'
import { DAILY_QUESTION_COUNT, pickEvenly } from './lib/daily.js'
import { MIN_SCRAPE_MS, SCRAPE_TIMEOUT_MS } from './lib/generation-timing.js'
import { runOnFirstUsableArticle, runQuestionPipeline, topicRoomResult, USER_MESSAGES } from './lib/questions/pipeline.js'
import { createActionTools } from './server/action-routes.js'
import {
  failRoom,
  finishGeneration,
  generateText,
  GENERATE_JOB_TYPE,
  scrapeArticle,
  searchArticle,
  setGenerationStep,
  type GenerateJobPayload,
} from './server/generation.js'
import { recordDailyGeneration } from './server/daily.js'

/** True if the room exists, belongs to `hostId`, and is still 'generating'. */
async function stillGenerating(tools: ActionTools, roomId: string, hostId: string): Promise<boolean> {
  const result = await tools.get('rooms', roomId)
  if (!result.success) {
    console.warn(`[generate] room ${roomId}: room lookup failed: ${result.error}`)
    return false
  }
  const room = result.data.record.data
  if (room.hostId !== hostId || room.status !== 'generating') {
    console.warn(`[generate] room ${roomId}: status is '${String(room.status)}', skipping`)
    return false
  }
  return true
}

export async function runJob(job: Job, _ctx: JobContext, env: Env): Promise<void> {
  if (job.type !== GENERATE_JOB_TYPE) throw new Error(`Unknown job type: ${job.type}`)

  const payload = job.payload as GenerateJobPayload
  const { roomId, hostId } = payload
  const tools = createActionTools(env, hostId, '')
  const started = Date.now()

  try {
    if (!(await stillGenerating(tools, roomId, hostId))) return

    // A topic room: find the article first. A failed call and "nothing
    // usable" both end the room here, with different messages. A link room
    // has just its own link.
    let candidates: string[] = payload.url !== undefined ? [payload.url] : []
    if (payload.topic !== undefined) {
      const found = await searchArticle(tools, roomId, payload.topic)
      if (!found.ok) {
        if (!(await stillGenerating(tools, roomId, hostId))) return
        const failed = await finishGeneration(tools, roomId, {
          ok: false,
          userMessage: found.noneFound ? USER_MESSAGES.noArticleFound : USER_MESSAGES.serviceUnavailable,
          log: [`search: ${found.log}`],
        })
        if (payload.dailyDay) await recordDailyGeneration(tools, payload.dailyDay, roomId, failed?.status ?? null)
        return
      }
      candidates = found.urls
    }
    if (candidates.length === 0) throw new Error('job payload has neither url nor topic')

    let attempt = 0
    const kind = payload.topic !== undefined ? 'topic' : 'link'
    // Every scrape in this room shares one SCRAPE_TIMEOUT_MS budget, so
    // trying more pages never makes the worst case longer.
    const scrapeDeadline = Date.now() + SCRAPE_TIMEOUT_MS
    // Each step is recorded just before it starts, for the room page's
    // progress list (display only; see setGenerationStep).
    const deps = {
      scrape: async (u: string) => {
        await setGenerationStep(tools, roomId, stepValue(kind, 'reading'))
        return scrapeArticle(tools, roomId, u, Math.min(SCRAPE_TIMEOUT_MS, scrapeDeadline - Date.now()))
      },
      generate: async (system: string, user: string) => {
        attempt += 1
        await setGenerationStep(tools, roomId, stepValue(kind, attempt === 1 ? 'writing' : 'rewriting'))
        const generated = await generateText(tools, roomId, attempt, system, user)
        // The pipeline parses and validates the reply next (checking every
        // passage against the article). A failed call ends the room instead.
        if (generated.ok) await setGenerationStep(tools, roomId, stepValue(kind, 'checking'))
        return generated
      },
    }
    // Quiz of the Day: plain, everyday questions anyone can have a go at.
    const everyday = payload.dailyDay !== undefined

    // Try the search results in order: a page that is too short or
    // unreachable fails before any model call, so move on to the next one
    // while the scrape budget lasts. Any other failure stops there.
    let stopped = false
    const { url, result: pipelineResult } = await runOnFirstUsableArticle(
      candidates,
      (u) => runQuestionPipeline(u, deps, kind, everyday),
      async () => {
        if (scrapeDeadline - Date.now() < MIN_SCRAPE_MS) return false
        if (!(await stillGenerating(tools, roomId, hostId))) {
          stopped = true
          return false
        }
        return true
      },
      (n, skipped) => {
        // Log lines only, never the URL (it would give the topic away).
        for (const line of skipped.log) console.warn(`[generate] room ${roomId}: article ${n} of ${candidates.length}: ${line}`)
        console.info(`[generate] room ${roomId}: article ${n} unusable, trying article ${n + 1}`)
      },
    )
    if (stopped) return
    // A topic room's host never chose the page, so "that page" messages are reworded.
    let result = payload.topic !== undefined ? topicRoomResult(pipelineResult) : pipelineResult
    // The Quiz of the Day always has exactly DAILY_QUESTION_COUNT (8): the
    // pipeline guarantees at least that many, and pickEvenly keeps the
    // easiest-to-hardest ramp.
    if (everyday && result.ok) result = { ...result, questions: pickEvenly(result.questions, DAILY_QUESTION_COUNT) }

    // Up to ~150 s have passed; don't overwrite a room that moved on.
    if (!(await stillGenerating(tools, roomId, hostId))) return
    if (result.ok) await setGenerationStep(tools, roomId, stepValue(kind, 'saving'))
    const finished = await finishGeneration(tools, roomId, result, url)
    // A Quiz of the Day source room: mark the day ready, or this attempt failed.
    if (payload.dailyDay) await recordDailyGeneration(tools, payload.dailyDay, roomId, finished?.status ?? null)
    console.info(`[generate] room ${roomId}: done in ${Date.now() - started} ms -> ${finished?.status ?? 'status write failed'}`)
  } catch (err) {
    console.error(`[generate] room ${roomId}: job error: ${err instanceof Error ? err.message : String(err)}`)
    // Only fail a room that is still waiting on us. If even this check
    // throws, the room stays 'generating' and the room page's
    // "taking longer than expected" message covers it.
    if (await stillGenerating(tools, roomId, hostId).catch(() => false)) {
      await failRoom(tools, roomId, USER_MESSAGES.serviceUnavailable)
      if (payload.dailyDay) await recordDailyGeneration(tools, payload.dailyDay, roomId, 'failed')
    }
  }
}
