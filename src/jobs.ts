/**
 * Background-job handler, invoked by AppJobRoom (worker.ts) for every job
 * picked up from a queue. One job type:
 *
 * 'generate-questions' { roomId, hostId, url } or { roomId, hostId, topic }
 *   Queued by createRoom (server only: worker.ts closes the job sockets to
 *   clients) on the room's own queue, `room:${roomId}`, with maxAttempts 1.
 *   For a topic, first asks Exa for an article (searchArticle); no usable
 *   result fails the room with USER_MESSAGES.noArticleFound. Then runs the
 *   question pipeline on the link against the real Firecrawl + Anthropic
 *   integrations, and sets the room to 'lobby' (with sourceUrl) or 'failed'.
 *   For a topic room, a too-short or unreachable article fails with
 *   USER_MESSAGES.topicArticleUnusable instead (topicRoomResult).
 *   The topic is never logged.
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
import { runQuestionPipeline, topicRoomResult, USER_MESSAGES } from './lib/questions/pipeline.js'
import { createActionTools } from './server/action-routes.js'
import {
  failRoom,
  finishGeneration,
  generateText,
  GENERATE_JOB_TYPE,
  scrapeArticle,
  searchArticle,
  type GenerateJobPayload,
} from './server/generation.js'

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
    // usable" both end the room here, with different messages.
    let url = payload.url
    if (payload.topic !== undefined) {
      const found = await searchArticle(tools, roomId, payload.topic)
      if (!found.ok) {
        if (!(await stillGenerating(tools, roomId, hostId))) return
        await finishGeneration(tools, roomId, {
          ok: false,
          userMessage: found.noneFound ? USER_MESSAGES.noArticleFound : USER_MESSAGES.serviceUnavailable,
          log: [`search: ${found.log}`],
        })
        return
      }
      url = found.url
    }
    if (url === undefined) throw new Error('job payload has neither url nor topic')

    let attempt = 0
    const pipelineResult = await runQuestionPipeline(url, {
      scrape: (u) => scrapeArticle(tools, roomId, u),
      generate: (system, user) => generateText(tools, roomId, ++attempt, system, user),
    })
    // A topic room's host never chose the page, so "that page" messages are reworded.
    const result = payload.topic !== undefined ? topicRoomResult(pipelineResult) : pipelineResult

    // Up to ~150 s have passed; don't overwrite a room that moved on.
    if (!(await stillGenerating(tools, roomId, hostId))) return
    const finished = await finishGeneration(tools, roomId, result, url)
    console.info(`[generate] room ${roomId}: done in ${Date.now() - started} ms -> ${finished?.status ?? 'status write failed'}`)
  } catch (err) {
    console.error(`[generate] room ${roomId}: job error: ${err instanceof Error ? err.message : String(err)}`)
    // Only fail a room that is still waiting on us. If even this check
    // throws, the room stays 'generating' and the room page's
    // "taking longer than expected" message covers it.
    if (await stillGenerating(tools, roomId, hostId).catch(() => false)) {
      await failRoom(tools, roomId, USER_MESSAGES.serviceUnavailable)
    }
  }
}
