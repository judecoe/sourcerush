/**
 * Server actions. Each one runs with the verified caller's `userId` (from the
 * JWT) and with RBAC switched off, so every check that matters is done here.
 * Never read a user id from `params`.
 */

import { enqueueJob, RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler, ActionTools, GetActionData, QueryActionData } from 'deepspace/worker'
import type { Env } from '../../worker'
import { parseCreateRoomParams } from '../lib/create-room-params'
import { SAMPLE_PIPELINE_DEPS } from '../lib/questions/fixtures'
import { runQuestionPipeline, USER_MESSAGES } from '../lib/questions/pipeline'
import { QUESTION_DURATION_MS, scoreFor } from '../lib/scoring'
import {
  failRoom,
  finishGeneration,
  GENERATE_JOB_TYPE,
  jobQueueId,
  questionRecordId,
  type GenerateJobPayload,
} from '../server/generation'

// No 0/O or 1/I, so codes are easy to read aloud. 32 characters, so
// `byte % 32` is unbiased (256 is a multiple of 32).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const CODE_ATTEMPTS = 5

function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  let code = ''
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return code
}

/** Deterministic id for a user's row in a room (players and team_members). */
function memberRecordId(roomId: string, userId: string): string {
  return `${roomId}:${userId}`
}

/** The caller's display name, read on the server from their users row. */
async function displayNameFor(tools: ActionTools, userId: string): Promise<string> {
  const result = await tools.get('users', userId)
  if (!result.success) return 'Player'
  const name = (result.data as GetActionData).record.data.name
  return typeof name === 'string' && name.trim() ? name.trim() : 'Player'
}

/** Add the user to the room's member list, which is what grants read access. */
function addMember(tools: ActionTools, roomId: string, userId: string) {
  return tools.create(
    'team_members',
    { teamId: roomId, userId, status: 'active' },
    memberRecordId(roomId, userId),
  )
}

/**
 * Rooms made from a link, per user per UTC day. Each one spends owner
 * credits; "Try it yourself" rooms don't count.
 */
export const ROOM_DAILY_LIMIT = 10

/**
 * Claim one of today's ROOM_DAILY_LIMIT slots for this user, or return false
 * if none is free. Each slot is a room_quota row with an immutable, fresh
 * `attemptId`, so a slot can only ever be created once, even by two
 * concurrent calls.
 *
 * Any failed create counts as "taken", not just the immutable rejection.
 * That fails closed: during an outage a user may see "limit reached" early,
 * but nobody can ever get past the limit.
 */
async function claimRoomSlot(tools: ActionTools, userId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10) // UTC date, e.g. 2026-11-18
  for (let slot = 0; slot < ROOM_DAILY_LIMIT; slot++) {
    const claimed = await tools.create(
      'room_quota',
      { userId, day, slot, attemptId: crypto.randomUUID() },
      `${userId}:${day}:${slot}`,
    )
    if (claimed.success) return true
    if (!isImmutableRejection(claimed.error)) {
      console.error(`[createRoom] quota slot ${slot} for ${userId}: ${claimed.error}`)
    }
  }
  return false
}

/** The SDK's error when a write would change an `immutable` column. */
function isImmutableRejection(error: string): boolean {
  return error.startsWith('Cannot modify immutable field')
}

type RoomData = {
  roomId: string
  hostId: string
  status: string
  currentIndex: number
  endsAt?: number
}

type QuestionData = { roomId: string; index: number }

type AnswerKeyData = {
  prompt: string
  choices: string[]
  correctIndex: number
  passage: string
  explanation: string
}

type SubmissionData = { userId: string; choiceIndex: number; submittedAt: number }

type PlayerData = { userId: string; score?: number }

/** Read one record's data, or null if it doesn't exist (other errors are logged). */
async function getData<T extends Record<string, unknown>>(
  tools: ActionTools,
  collection: string,
  recordId: unknown,
): Promise<T | null> {
  if (typeof recordId !== 'string' || !recordId) return null
  const result = await tools.get<T>(collection, recordId)
  if (result.success) return (result.data as GetActionData<T>).record.data
  if (!result.error.startsWith(RECORD_NOT_FOUND)) {
    console.error(`[getData] ${collection}/${recordId}: ${result.error}`)
  }
  return null
}

// Rooms are small, so one page covers every player. The SDK default is 50.
const ROOM_QUERY_LIMIT = 500

/** All rows matching `where`, or null if the query failed. */
async function queryAll<T extends Record<string, unknown>>(
  tools: ActionTools,
  collection: string,
  where: Record<string, unknown>,
) {
  const result = await tools.query<T>(collection, { where, limit: ROOM_QUERY_LIMIT })
  if (!result.success) {
    console.error(`[queryAll] ${collection}: ${result.error}`)
    return null
  }
  return (result.data as QueryActionData<T>).records
}

export const actions: Record<string, ActionHandler<Env>> = {
  /**
   * Create a room with a fresh 6-character code. The caller is the host: a
   * room member and also a player (they get a players row, like anyone who
   * joins). Params, exactly one of:
   *
   *   { url }          Validate the link, claim a room_quota slot (10 per user
   *                    per UTC day; none free → error, no room), create the
   *                    room as 'generating', then queue the 'generate-questions'
   *                    job (src/jobs.ts) and return at once with
   *                    status 'generating'. The job moves the room to 'lobby'
   *                    or 'failed'. A slot stays used even if generation fails.
   *   { topic }        The same, but the job first asks Exa for an article
   *                    about the topic (same quota slot).
   *   { sample: true } "Try it yourself": runs the same pipeline right here with
   *                    the Tide Clock fixture (SAMPLE_PIPELINE_DEPS), no API
   *                    calls, no quota, and returns 'lobby'.
   *
   * If the host's team_members or players write fails, the room is marked
   * 'failed' and the call returns an error (the host may not be able to read
   * the room, so there's no room page to send them to). Any later failure
   * marks the room 'failed' with a user-safe `errorMessage` and still returns
   * success, so the host lands on the room page and sees why.
   */
  createRoom: async ({ userId, params, tools, env }) => {
    // 1. Check the input before spending anything.
    const request = parseCreateRoomParams(params)
    if (!request.ok) return { success: false, error: request.error }

    // 2. A link or topic costs owner credits: claim one of today's slots first.
    if (request.kind !== 'sample' && !(await claimRoomSlot(tools, userId))) {
      return {
        success: false,
        error: `You've reached today's limit of ${ROOM_DAILY_LIMIT} rooms from links or topics. Try again tomorrow, or use Try it yourself.`,
      }
    }

    const roomId = crypto.randomUUID()

    // Codes are unique via `uniqueOn: ['code']`. On a collision the create is
    // refused with a "Duplicate: ..." error and nothing is written, so retry
    // with a new code.
    let code = ''
    for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt++) {
      code = randomRoomCode()
      const created = await tools.create(
        'rooms',
        {
          roomId,
          code,
          hostId: userId,
          status: 'generating',
          sourceTitle: '',
          sourceUrl: '',
          currentIndex: -1,
          answeredCount: 0,
        },
        roomId,
      )
      if (created.success) break
      if (!created.error.startsWith('Duplicate:') || attempt === CODE_ATTEMPTS) {
        console.error(`[createRoom] room create failed (attempt ${attempt}): ${created.error}`)
        return { success: false, error: 'Could not create a room. Please try again.' }
      }
      console.warn(`[createRoom] code collision on attempt ${attempt}, retrying`)
    }

    const setupFailed = 'Could not set up this room. Please try again.'
    const member = await addMember(tools, roomId, userId)
    if (!member.success) {
      console.error(`[createRoom] host membership failed for room ${roomId}: ${member.error}`)
      await failRoom(tools, roomId, setupFailed)
      return { success: false, error: 'Could not create a room. Please try again.' }
    }

    // The host plays too: same players row joinRoom creates.
    const player = await tools.create(
      'players',
      { roomId, userId, displayName: await displayNameFor(tools, userId), score: 0 },
      memberRecordId(roomId, userId),
    )
    if (!player.success) {
      console.error(`[createRoom] host player row failed for room ${roomId}: ${player.error}`)
      await failRoom(tools, roomId, setupFailed)
      return { success: false, error: 'Could not create a room. Please try again.' }
    }

    // 3a. "Try it yourself": the real pipeline with fake scrape/generate, inline.
    if (request.kind === 'sample') {
      const result = await runQuestionPipeline('sample', SAMPLE_PIPELINE_DEPS, 'link')
      const finished = await finishGeneration(tools, roomId, result)
      if (!finished) return { success: false, error: 'Could not create a room. Please try again.' }
      return { success: true, data: { roomId, code, ...finished } }
    }

    // 3b. A link or topic: hand the slow, paid part to a background job on this room's own queue.
    const payload: GenerateJobPayload =
      request.kind === 'url'
        ? { roomId, hostId: userId, url: request.url }
        : { roomId, hostId: userId, topic: request.topic }
    try {
      await enqueueJob(env.JOB_ROOMS, jobQueueId(roomId), GENERATE_JOB_TYPE, payload, {
        maxAttempts: 1,
        enqueuedBy: userId,
      })
    } catch (err) {
      console.error(`[createRoom] room ${roomId}: enqueue failed: ${err instanceof Error ? err.message : String(err)}`)
      await failRoom(tools, roomId, USER_MESSAGES.serviceUnavailable)
      return {
        success: true,
        data: { roomId, code, status: 'failed', errorMessage: USER_MESSAGES.serviceUnavailable },
      }
    }
    return { success: true, data: { roomId, code, status: 'generating' } }
  },

  /**
   * Join a room by code. A user who is already a member (host or player) gets
   * their room back whatever its status, so a rejoin or refresh always works.
   * Only new players are limited to rooms in 'lobby'.
   */
  joinRoom: async ({ userId, params, tools }) => {
    const code = typeof params.code === 'string' ? params.code.trim().toUpperCase() : ''
    if (code.length !== CODE_LENGTH) {
      return { success: false, error: 'Room codes are 6 characters.' }
    }

    const found = await tools.query('rooms', { where: { code }, limit: 1 })
    if (!found.success) {
      console.error(`[joinRoom] room lookup failed: ${found.error}`)
      return { success: false, error: 'Could not look up that room. Please try again.' }
    }
    const room = (found.data as QueryActionData).records[0]
    if (!room) return { success: false, error: 'No room with that code.' }
    const roomId = room.recordId

    // 1. Existing member? Return the room regardless of its status.
    const existing = await tools.get('team_members', memberRecordId(roomId, userId))
    if (existing.success) return { success: true, data: { roomId } }
    if (!existing.error.startsWith(RECORD_NOT_FOUND)) {
      console.error(`[joinRoom] membership lookup failed: ${existing.error}`)
      return { success: false, error: 'Could not join that room. Please try again.' }
    }

    // 2. New player: only while the room is in the lobby.
    if (room.data.status !== 'lobby') {
      return { success: false, error: 'That game has already started.' }
    }

    // Player row first, then membership: membership is what makes this
    // user count as "already joined" on a later call.
    const player = await tools.create(
      'players',
      { roomId, userId, displayName: await displayNameFor(tools, userId), score: 0 },
      memberRecordId(roomId, userId),
    )
    if (!player.success) {
      console.error(`[joinRoom] player create failed for room ${roomId}: ${player.error}`)
      return { success: false, error: 'Could not join that room. Please try again.' }
    }
    const member = await addMember(tools, roomId, userId)
    if (!member.success) {
      console.error(`[joinRoom] membership create failed for room ${roomId}: ${member.error}`)
      return { success: false, error: 'Could not join that room. Please try again.' }
    }

    return { success: true, data: { roomId } }
  },

  /**
   * Host only, from 'lobby' or 'reveal'. Opens the next question: copies its
   * prompt and choices (never the answer) into `questions`, and starts the
   * timer from the server clock. With no questions left, the game finishes.
   */
  openQuestion: async ({ userId, params, tools }) => {
    const roomId = params.roomId
    const room = await getData<RoomData>(tools, 'rooms', roomId)
    if (!room || typeof roomId !== 'string') return { success: false, error: 'No such room.' }
    if (room.hostId !== userId) {
      return { success: false, error: 'Only the host can open the next question.' }
    }
    if (room.status !== 'lobby' && room.status !== 'reveal') {
      return { success: false, error: `Can't open a question while the room is '${room.status}'.` }
    }

    const index = room.currentIndex + 1
    const questionId = questionRecordId(roomId, index)
    const key = await getData<AnswerKeyData>(tools, 'answerKeys', questionId)
    if (!key) {
      // No more questions (a real lookup error is logged inside getData).
      const finished = await tools.update('rooms', roomId, { status: 'finished' })
      if (!finished.success) {
        console.error(`[openQuestion] room ${roomId}: finish failed: ${finished.error}`)
        return { success: false, error: 'Could not continue. Please try again.' }
      }
      return { success: true, data: { status: 'finished' } }
    }

    // Prompt and choices only. The answer stays in answerKeys until reveal.
    const question = await tools.create(
      'questions',
      { roomId, index, prompt: key.prompt, choices: key.choices },
      questionId,
    )
    if (!question.success) {
      console.error(`[openQuestion] room ${roomId}: question create failed: ${question.error}`)
      return { success: false, error: 'Could not open the question. Please try again.' }
    }

    const endsAt = Date.now() + QUESTION_DURATION_MS
    const opened = await tools.update('rooms', roomId, {
      status: 'question',
      currentIndex: index,
      endsAt,
      answeredCount: 0,
    })
    if (!opened.success) {
      console.error(`[openQuestion] room ${roomId}: room update failed: ${opened.error}`)
      return { success: false, error: 'Could not open the question. Please try again.' }
    }
    return { success: true, data: { status: 'question', questionId, endsAt } }
  },

  /**
   * A player (the host included) answers the open question. One answer per player per question:
   * every submissions column is immutable and `attemptId` is new on every
   * call, so a second create for the same id is rejected by the SDK inside a
   * single write, even when two calls race.
   */
  submitAnswer: async ({ userId, params, tools }) => {
    const { questionId, choiceIndex } = params
    if (!Number.isInteger(choiceIndex) || (choiceIndex as number) < 0 || (choiceIndex as number) > 3) {
      return { success: false, error: 'Pick one of the four answers.' }
    }
    const question = await getData<QuestionData>(tools, 'questions', questionId)
    if (!question || typeof questionId !== 'string') return { success: false, error: 'No such question.' }

    const roomId = question.roomId
    const player = await getData(tools, 'players', memberRecordId(roomId, userId))
    if (!player) return { success: false, error: 'Only players in this room can answer.' }

    const room = await getData<RoomData>(tools, 'rooms', roomId)
    // endsAt belongs to the room's current question, so the question being
    // answered must be that one.
    if (!room || room.status !== 'question' || room.currentIndex !== question.index) {
      return { success: false, error: 'This question is closed.' }
    }
    const now = Date.now()
    if (typeof room.endsAt !== 'number' || now >= room.endsAt) {
      return { success: false, error: "Time's up." }
    }

    const created = await tools.create(
      'submissions',
      { questionId, userId, choiceIndex, submittedAt: now, attemptId: crypto.randomUUID() },
      `${questionId}:${userId}`,
    )
    if (!created.success) {
      if (isImmutableRejection(created.error)) {
        return { success: false, error: 'You already answered this question.' }
      }
      console.error(`[submitAnswer] ${questionId}: create failed: ${created.error}`)
      return { success: false, error: 'Could not save your answer. Please try again.' }
    }

    // Display only: recount rather than increment, so a lost update corrects
    // itself on the next answer. revealQuestion never reads this.
    const submissions = await queryAll(tools, 'submissions', { questionId })
    if (submissions) {
      await tools.update('rooms', roomId, { answeredCount: submissions.length })
    }

    return { success: true, data: { choiceIndex, submittedAt: now } }
  },

  /**
   * Any room member. Allowed once time is up (server clock) or every player,
   * the host included, has answered (counted server-side). The first call to create the
   * question's reveal_locks row does the scoring; any other call gets
   * `alreadyRevealed: true` and changes nothing.
   */
  revealQuestion: async ({ userId, params, tools }) => {
    const roomId = params.roomId
    const room = await getData<RoomData>(tools, 'rooms', roomId)
    if (!room || typeof roomId !== 'string') return { success: false, error: 'No such room.' }
    const member = await getData(tools, 'team_members', memberRecordId(roomId, userId))
    if (!member) return { success: false, error: 'You are not in this room.' }

    // `by` says which guard stopped a repeat call; the tests log it.
    if (room.status === 'reveal') return { success: true, data: { alreadyRevealed: true, by: 'status' } }
    if (room.status !== 'question' || typeof room.endsAt !== 'number') {
      return { success: false, error: 'There is no open question to reveal.' }
    }
    const endsAt = room.endsAt
    const questionId = questionRecordId(roomId, room.currentIndex)

    const players = await queryAll<PlayerData>(tools, 'players', { roomId })
    const answered = await queryAll<SubmissionData>(tools, 'submissions', { questionId })
    if (!players || !answered) return { success: false, error: 'Could not reveal. Please try again.' }
    const timeUp = Date.now() >= endsAt
    if (!timeUp && answered.length < players.length) {
      return { success: false, error: 'The round is still open.' }
    }

    // Only one call gets past this line per question.
    const lock = await tools.create('reveal_locks', { questionId, attemptId: crypto.randomUUID() }, questionId)
    if (!lock.success) {
      if (isImmutableRejection(lock.error)) return { success: true, data: { alreadyRevealed: true, by: 'lock' } }
      console.error(`[revealQuestion] ${questionId}: lock failed: ${lock.error}`)
      return { success: false, error: 'Could not reveal. Please try again.' }
    }

    const key = await getData<AnswerKeyData>(tools, 'answerKeys', questionId)
    // Re-read after taking the lock, to include any answer that landed meanwhile.
    const submissions = await queryAll<SubmissionData>(tools, 'submissions', { questionId })
    if (!key || !submissions) {
      console.error(`[revealQuestion] ${questionId}: missing answer key or submissions after lock`)
      return { success: false, error: 'Could not reveal. Please try again.' }
    }

    const byUser = new Map(submissions.map((s) => [s.data.userId, s.data]))
    for (const p of players) {
      const sub = byUser.get(p.data.userId)
      const points = sub ? scoreFor(sub.choiceIndex === key.correctIndex, sub.submittedAt, endsAt) : 0
      if (points === 0) continue
      const scored = await tools.update('players', p.recordId, { score: (p.data.score ?? 0) + points })
      if (!scored.success) console.error(`[revealQuestion] ${questionId}: score for ${p.recordId} failed: ${scored.error}`)
    }

    const revealed = await tools.update('questions', questionId, {
      reveal: { correctIndex: key.correctIndex, passage: key.passage, explanation: key.explanation },
    })
    const status = await tools.update('rooms', roomId, { status: 'reveal' })
    if (!revealed.success || !status.success) {
      console.error(`[revealQuestion] ${questionId}: reveal writes failed: ${revealed.error ?? ''} ${status.error ?? ''}`)
      return { success: false, error: 'Could not reveal. Please try again.' }
    }
    return { success: true, data: { alreadyRevealed: false } }
  },
}
