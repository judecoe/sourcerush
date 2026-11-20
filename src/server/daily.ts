/**
 * Quiz of the Day, server side. Everything here takes `tools`, so the cron
 * (src/cron.ts), the generation job (src/jobs.ts) and the actions can share it.
 *
 * How a day's quiz is made: a "source room" (hosted by the app owner, never
 * played, no members) is generated like any topic room by the existing
 * job. When it reaches 'lobby', recordDailyGeneration marks the day ready
 * and ends the source room as 'finished'. Players then each get their own
 * room with copies of its answer keys (playDailyQuiz).
 */

import { enqueueJob, RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionTools, QueryActionData } from 'deepspace/worker'
import type { Env } from '../../worker'
import { baselineAverage, DAILY_MAX_ATTEMPTS, dailyAverage, topicForDay } from '../lib/daily'
import { stepValue } from '../lib/generation-steps'
import { failRoom, GENERATE_JOB_TYPE, jobQueueId, type GenerateJobPayload } from './generation'

export type DailyQuizData = {
  day: string
  status: 'generating' | 'ready' | 'failed'
  attempts: number
  startedAt: number
  sourceRoomId: string
}

type DailyPlayData = { day: string; userId: string; roomId: string; status: string }

/** Read one record's data, or null if it doesn't exist (other errors are logged). */
export async function readData<T extends Record<string, unknown>>(
  tools: ActionTools,
  collection: string,
  recordId: string,
): Promise<T | null> {
  const result = await tools.get<T>(collection, recordId)
  if (result.success) return result.data.record.data
  if (!result.error.startsWith(RECORD_NOT_FOUND)) console.error(`[daily] ${collection}/${recordId}: ${result.error}`)
  return null
}

/** Record id of one person's attempt on one day. */
export function dailyPlayId(day: string, userId: string): string {
  return `${day}:${userId}`
}

/**
 * Write fields to the day's public daily_stats row, creating it if needed
 * (`create` with an explicit id merges over an existing row). Best effort:
 * a failure is logged and returned as false.
 */
async function setDailyStats(tools: ActionTools, day: string, fields: Record<string, unknown>): Promise<boolean> {
  const written = await tools.create('daily_stats', { day, ...fields }, day)
  if (!written.success) console.error(`[daily] ${day}: daily_stats write failed: ${written.error}`)
  return written.success
}

/**
 * Start attempt number `attempt` for `day`: create the source room (as
 * 'generating', hosted by `hostId`), point daily_quizzes at it, and mark the
 * day 'preparing'. Returns the source room id and the topic, or null if a
 * write failed. The caller then generates the questions (the job, or the
 * sample pipeline in dev).
 *
 * The source room's code is `daily-<roomId>`: never 6 characters, so no
 * joinRoom code can match it.
 */
export async function createDailySourceRoom(
  tools: ActionTools,
  day: string,
  attempt: number,
  hostId: string,
): Promise<{ roomId: string; topic: string } | null> {
  const topic = topicForDay(day, attempt)
  const roomId = crypto.randomUUID()
  const room = await tools.create(
    'rooms',
    {
      roomId,
      code: `daily-${roomId}`,
      hostId,
      status: 'generating',
      sourceTitle: '',
      sourceUrl: '',
      currentIndex: -1,
      answeredCount: 0,
      generationStep: stepValue('topic', 'searching'),
      dailyDay: day,
    },
    roomId,
  )
  if (!room.success) {
    console.error(`[daily] ${day}: source room create failed: ${room.error}`)
    return null
  }
  const quiz = await tools.create(
    'daily_quizzes',
    { day, status: 'generating', attempts: attempt, startedAt: Date.now(), sourceRoomId: roomId, topic },
    day,
  )
  if (!quiz.success) {
    console.error(`[daily] ${day}: daily_quizzes write failed: ${quiz.error}`)
    await failRoom(tools, roomId, 'Could not set up this room. Please try again.')
    return null
  }
  await setDailyStats(tools, day, { status: 'preparing' })
  return { roomId, topic }
}

/**
 * Cron: start a real generation attempt for `day` on the job queue (Exa,
 * Firecrawl, Anthropic; billed to the app owner).
 */
export async function startDailyAttempt(tools: ActionTools, env: Env, day: string, attempt: number): Promise<void> {
  const source = await createDailySourceRoom(tools, day, attempt, env.OWNER_USER_ID)
  if (!source) return
  const payload: GenerateJobPayload = {
    roomId: source.roomId,
    hostId: env.OWNER_USER_ID,
    topic: source.topic,
    dailyDay: day,
  }
  try {
    await enqueueJob(env.JOB_ROOMS, jobQueueId(source.roomId), GENERATE_JOB_TYPE, payload, {
      maxAttempts: 1,
      enqueuedBy: env.OWNER_USER_ID,
    })
    console.info(`[daily] ${day}: attempt ${attempt} queued (room ${source.roomId})`)
  } catch (err) {
    console.error(`[daily] ${day}: enqueue failed: ${err instanceof Error ? err.message : String(err)}`)
    await failRoom(tools, source.roomId, 'Could not set up this room. Please try again.')
    await recordDailyGeneration(tools, day, source.roomId, 'failed')
  }
}

/**
 * Cron: out of attempts. Mark the day failed and show "no quiz today".
 */
export async function giveUpDaily(tools: ActionTools, day: string): Promise<void> {
  const updated = await tools.update('daily_quizzes', day, { status: 'failed' })
  if (!updated.success) console.error(`[daily] ${day}: could not mark failed: ${updated.error}`)
  await setDailyStats(tools, day, { status: 'unavailable' })
}

/**
 * A source room's generation ended (`status` is finishGeneration's result;
 * null if even its status write failed). Ignored if the day has since moved
 * on to another attempt's room.
 *
 * - 'lobby': the day is ready. Copy title and question count to daily_stats,
 *   and end the source room as 'finished' (it is never played; this also
 *   keeps it out of the owner's "Return to your room" link).
 * - otherwise: this attempt failed. The cron retries on its next run; after
 *   the last attempt the day shows "no quiz today".
 */
export async function recordDailyGeneration(
  tools: ActionTools,
  day: string,
  roomId: string,
  status: 'lobby' | 'failed' | null,
): Promise<void> {
  const quiz = await readData<DailyQuizData>(tools, 'daily_quizzes', day)
  if (!quiz || quiz.sourceRoomId !== roomId) {
    console.warn(`[daily] ${day}: room ${roomId} is not the current attempt, ignoring`)
    return
  }

  if (status === 'lobby') {
    const room = await readData<{ sourceTitle?: string }>(tools, 'rooms', roomId)
    const keys = await tools.query('answerKeys', { where: { roomId }, limit: 500 })
    const questionCount = keys.success ? (keys.data as QueryActionData).records.length : 0
    const ready = await tools.update('daily_quizzes', day, { status: 'ready' })
    if (!ready.success) {
      console.error(`[daily] ${day}: could not mark ready: ${ready.error}`)
      return
    }
    const ended = await tools.update('rooms', roomId, { status: 'finished' })
    if (!ended.success) console.warn(`[daily] ${day}: could not end source room: ${ended.error}`)
    // The day starts at its baseline average (2000–3000, src/lib/daily.ts).
    await setDailyStats(tools, day, {
      status: 'ready',
      title: room?.sourceTitle ?? '',
      questionCount,
      ...dailyAverage(baselineAverage(day), []),
    })
    console.info(`[daily] ${day}: ready, ${questionCount} questions`)
    return
  }

  const failed = await tools.update('daily_quizzes', day, { status: 'failed' })
  if (!failed.success) console.error(`[daily] ${day}: could not mark failed: ${failed.error}`)
  if (quiz.attempts >= DAILY_MAX_ATTEMPTS) await setDailyStats(tools, day, { status: 'unavailable' })
  console.warn(`[daily] ${day}: attempt ${quiz.attempts} failed`)
}

/**
 * A player's daily room finished. Their result is compared with the day's
 * average from just before they finished (baseline + everyone else who had
 * finished), saved on their daily_plays row so their result screen never
 * changes. Only then is their score added to the day's public average.
 * Recomputing from every finished play (not incrementing) means a lost
 * update fixes itself on the next finish. Returns false if a write failed,
 * so openQuestion can refuse and the player's Next retries.
 *
 * Known limit: the recount reads at most 500 finished plays per day.
 */
export async function recordDailyFinish(
  tools: ActionTools,
  day: string,
  roomId: string,
  userId: string,
): Promise<boolean> {
  const playId = dailyPlayId(day, userId)
  const play = await readData<DailyPlayData>(tools, 'daily_plays', playId)
  if (!play || play.roomId !== roomId) {
    // Not this user's counted attempt (shouldn't happen): finish without recording.
    console.warn(`[daily] ${day}: room ${roomId} has no matching play, not recorded`)
    return true
  }
  const player = await readData<{ score?: number }>(tools, 'players', `${roomId}:${userId}`)
  if (!player) return false
  const myScore = player.score ?? 0

  const plays = await tools.query('daily_plays', { where: { day, status: 'finished' }, limit: 500 })
  if (!plays.success) {
    console.error(`[daily] ${day}: plays query failed: ${plays.error}`)
    return false
  }
  // Everyone else who has finished (on a retry, this player may already be in the list).
  const otherScores = (plays.data as QueryActionData).records
    .filter((r) => r.data.userId !== userId)
    .map((r) => Number(r.data.score ?? 0))
  const baseline = baselineAverage(day)
  const before = dailyAverage(baseline, otherScores)

  const finished = await tools.update('daily_plays', playId, {
    status: 'finished',
    score: myScore,
    averageAtFinish: before.averageScore,
    stdDevAtFinish: before.stdDev,
    finishedAt: Date.now(),
  })
  if (!finished.success) {
    console.error(`[daily] ${day}: play update failed: ${finished.error}`)
    return false
  }
  return setDailyStats(tools, day, dailyAverage(baseline, [...otherScores, myScore]))
}
