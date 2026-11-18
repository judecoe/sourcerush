/**
 * Server actions. Each one runs with the verified caller's `userId` (from the
 * JWT) and with RBAC switched off, so every check that matters is done here.
 * Never read a user id from `params`.
 */

import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler, ActionTools, GetActionData, QueryActionData } from 'deepspace/worker'
import type { Env } from '../../worker'
import { BROKEN_FIXTURE_CANDIDATES, FIXTURE_CANDIDATES, FIXTURE_SOURCE } from '../lib/questions/fixtures'
import { prepareQuestions } from '../lib/questions/prepare'
import { QUESTION_DURATION_MS, scoreFor } from '../lib/scoring'

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
 * Mark a room 'failed' so it never sits in 'generating'. Uses the same
 * `tools.update` call as createRoom's pipeline failure path. If this write
 * fails too, the room stays in 'generating' and only the log records it.
 */
async function failRoom(tools: ActionTools, roomId: string, errorMessage: string): Promise<void> {
  const failed = await tools.update('rooms', roomId, { status: 'failed', errorMessage })
  if (!failed.success) {
    console.error(`[createRoom] room ${roomId}: could not mark failed: ${failed.error}`)
  }
}

/** Id of question number `index` in a room. Shared by `questions` and `answerKeys`. */
function questionRecordId(roomId: string, index: number): string {
  return `${roomId}:${index}`
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

/**
 * Run the question pipeline for a new room and store the results.
 * Returns null on success, or an error message that is safe to show players.
 *
 * For now the questions are hardcoded fixtures. The real pipeline will
 * scrape `sourceUrl` and call the model here instead.
 */
async function generateQuestions(
  tools: ActionTools,
  roomId: string,
  candidates: unknown[],
): Promise<string | null> {
  const prepared = prepareQuestions(FIXTURE_SOURCE, candidates)
  for (const r of prepared.rejected) {
    console.warn(`[createRoom] room ${roomId}: rejected question ${r.index}: ${r.reasons.join('; ')}`)
  }
  if (!prepared.ok) {
    console.error(`[createRoom] room ${roomId}: ${prepared.error}`)
    return "Couldn't make enough questions from this article."
  }

  const source = await tools.create(
    'sources',
    { roomId, title: FIXTURE_SOURCE.title, fullText: FIXTURE_SOURCE.text },
    roomId,
  )
  if (!source.success) throw new Error(`sources create failed: ${source.error}`)

  for (const [index, q] of prepared.questions.entries()) {
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
  return null
}

export const actions: Record<string, ActionHandler<Env>> = {
  /**
   * Create a room with a fresh 6-character code, generate its questions, and
   * move it to 'lobby'. The caller is the host: a room member and also a
   * player (they get a players row, like anyone who joins).
   *
   * If the host's team_members or players write fails, the room is marked
   * 'failed' and the call returns an error (the host may not be able to read
   * the room, so there's no room page to send them to).
   *
   * Status goes 'generating' → 'lobby', or 'generating' → 'failed' (with
   * `errorMessage`) if the pipeline can't produce enough questions or throws.
   * A failed room still returns success with `status: 'failed'`, so the host
   * lands on the room page and sees why.
   *
   * `params.fixture === 'broken'` uses a question set that always fails
   * validation. It exists only so tests can force the 'failed' path; it can
   * only fail the caller's own new room.
   * TODO(Friday): remove `fixture: 'broken'` when the real pipeline lands.
   * It is live in production too: DeepSpace documents no way for the worker
   * to tell local dev from production. (`ALLOW_DEBUG_ROUTES` is set by
   * `deepspace dev`/`test run`, but a deployment can opt into it, so it
   * isn't a dev signal.)
   * TODO: take a sourceUrl and run Firecrawl + Anthropic instead of fixtures.
   */
  createRoom: async ({ userId, params, tools }) => {
    const candidates = params.fixture === 'broken' ? BROKEN_FIXTURE_CANDIDATES : FIXTURE_CANDIDATES
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

    // Any failure past this point marks the room 'failed' instead of leaving
    // it stuck in 'generating'.
    let failure: string | null
    try {
      failure = await generateQuestions(tools, roomId, candidates)
    } catch (err) {
      console.error(`[createRoom] room ${roomId}: pipeline error: ${err instanceof Error ? err.message : String(err)}`)
      failure = 'Something went wrong while making questions. Please try again.'
    }

    const next: Record<string, unknown> & { status: string } = failure
      ? { status: 'failed', errorMessage: failure }
      : { status: 'lobby', sourceTitle: FIXTURE_SOURCE.title }
    const updated = await tools.update('rooms', roomId, next)
    if (!updated.success) {
      console.error(`[createRoom] room ${roomId}: status update to '${next.status}' failed: ${updated.error}`)
      return { success: false, error: 'Could not create a room. Please try again.' }
    }

    return { success: true, data: { roomId, code, status: next.status, errorMessage: failure ?? undefined } }
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
