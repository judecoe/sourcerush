/**
 * Background-job handler, invoked by AppJobRoom (worker.ts) for every job
 * picked up from a queue. One job type:
 *
 * 'generate-questions' { roomId, hostId, url }
 *   Queued by createRoom (server only: worker.ts closes the job sockets to
 *   clients) on the room's own queue, `room:${roomId}`, with maxAttempts 1.
 *   Runs the question pipeline against the real Firecrawl + Anthropic
 *   integrations, then sets the room to 'lobby' or 'failed'.
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
import { runQuestionPipeline, USER_MESSAGES } from './lib/questions/pipeline.js'
import { createActionTools } from './server/action-routes.js'
import {
  failRoom,
  finishGeneration,
  generateText,
  GENERATE_JOB_TYPE,
  scrapeArticle,
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

  const { roomId, hostId, url } = job.payload as GenerateJobPayload
  const tools = createActionTools(env, hostId, '')
  const started = Date.now()

  try {
    if (!(await stillGenerating(tools, roomId, hostId))) return

    let attempt = 0
    const result = await runQuestionPipeline(url, {
      scrape: (u) => scrapeArticle(tools, roomId, u),
      generate: (system, user) => generateText(tools, roomId, ++attempt, system, user),
    })

    // Up to ~150 s have passed; don't overwrite a room that moved on.
    if (!(await stillGenerating(tools, roomId, hostId))) return
    const finished = await finishGeneration(tools, roomId, result)
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
