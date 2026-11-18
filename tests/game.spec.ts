/**
 * Game integrity, run against the real local worker with signed-in users.
 * No game UI exists yet, so actions are called through the app's own
 * `callAction` and reads go through raw `core.subscribe` probes on each
 * user's authenticated records socket.
 *
 * Accounts: host (creates, not a player), p1 and p2 (players).
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { FIXTURE_CANDIDATES } from '../src/lib/questions/fixtures'
import type { Question } from '../src/lib/questions/validate'
import { QUESTION_DURATION_MS, scoreFor } from '../src/lib/scoring'
import { act, openApp, tapRecordsSocket } from './helpers/game'

const usable = loadAllTestAccounts().length
test.skip(usable < 3, `Needs 3 usable test accounts, found ${usable}.`)

const FIXTURES = FIXTURE_CANDIDATES as Question[]
const PASSAGES = FIXTURES.map((q) => q.passage)
const EXPLANATIONS = FIXTURES.map((q) => q.explanation)

/** Index of the correct choice in a (shuffled) question, found via the fixtures. */
function correctChoiceIndex(prompt: string, choices: string[]): number {
  const fixture = FIXTURES.find((q) => q.prompt === prompt)
  if (!fixture) throw new Error(`no fixture for prompt: ${prompt}`)
  return choices.indexOf(fixture.choices[fixture.correctIndex])
}

test('a pipeline failure leaves the room failed, not generating', async ({ users }) => {
  const [host] = await users(1)
  const tap = await tapRecordsSocket(host.page)
  await openApp(host.page)

  const created = await act<{ roomId: string; status: string; errorMessage: string }>(host.page, 'createRoom', {
    fixture: 'broken',
  })
  console.log('[failed room] createRoom ->', JSON.stringify(created))
  expect(created.success).toBe(true)
  if (!created.success) return
  expect(created.data.status).toBe('failed')

  const [room] = await tap.probe({ collection: 'rooms', where: { roomId: created.data.roomId } })
  console.log('[failed room] stored room ->', JSON.stringify(room?.data))
  expect(room.data.status).toBe('failed')
  expect(String(room.data.errorMessage)).toContain("Couldn't make enough questions")

  // A failed room can't be started.
  const open = await act(host.page, 'openQuestion', { roomId: created.data.roomId })
  expect(open.success).toBe(false)
})

test('full round: host check, secrecy, one submission, one scoring, late rejection, refresh', async ({
  users,
}) => {
  test.setTimeout(120_000)
  const [host, p1, p2] = await users(3)
  const hostTap = await tapRecordsSocket(host.page)
  const p1Tap = await tapRecordsSocket(p1.page)
  const p2Tap = await tapRecordsSocket(p2.page)
  await Promise.all([openApp(host.page), openApp(p1.page), openApp(p2.page)])

  // --- Setup: create, join ---
  const created = await act<{ roomId: string; code: string; status: string }>(host.page, 'createRoom')
  expect(created.success).toBe(true)
  if (!created.success) return
  const { roomId, code } = created.data
  expect(created.data.status).toBe('lobby')
  for (const p of [p1, p2]) {
    const joined = await act(p.page, 'joinRoom', { code })
    expect(joined.success).toBe(true)
  }
  // Fresh pages after joining (see the resubscribe gotcha in CLAUDE.md).
  await Promise.all([openApp(p1.page), openApp(p2.page)])

  // --- 1. A non-host calling openQuestion is rejected ---
  const notHost = await act(p1.page, 'openQuestion', { roomId })
  console.log('[1] p1 openQuestion ->', JSON.stringify(notHost))
  expect(notHost).toEqual({ success: false, error: 'Only the host can open the next question.' })

  const opened = await act<{ questionId: string; endsAt: number }>(host.page, 'openQuestion', { roomId })
  expect(opened.success).toBe(true)
  if (!opened.success) return
  const q0 = opened.data.questionId
  expect(q0).toBe(`${roomId}:0`)

  // The host is not a player and can't answer.
  const hostAnswer = await act(host.page, 'submitAnswer', { questionId: q0, choiceIndex: 0 })
  expect(hostAnswer).toEqual({ success: false, error: 'Only players in this room can answer.' })

  // --- 2. Before reveal: no answer anywhere a member can read ---
  // (a) Nothing on the wire so far carries a passage or explanation. Checked
  // before any questions probe, which could return old rooms' revealed rows.
  for (const [who, tap] of [['host', hostTap], ['p1', p1Tap], ['p2', p2Tap]] as const) {
    const leaked = tap.frames.filter((f) => [...PASSAGES, ...EXPLANATIONS].some((s) => f.includes(s)))
    expect(leaked, `${who}: no frame contains answer text`).toHaveLength(0)
  }
  // (b) Server-only collections return zero rows to every member, from any
  // room. The host case matters most: the host's createRoom call created the
  // answerKeys/sources rows (createdBy = host), so this proves read:false
  // beats ownership.
  for (const [who, tap] of [['host', hostTap], ['p1', p1Tap], ['p2', p2Tap]] as const) {
    for (const collection of ['answerKeys', 'sources', 'reveal_locks']) {
      const rows = await tap.probe({ collection })
      console.log(`[2] ${who} probes ${collection} -> ${rows.length} rows`)
      expect(rows, `${who} reads no ${collection} rows`).toHaveLength(0)
    }
  }
  const hostKeys = await hostTap.probe({ collection: 'answerKeys', where: { roomId } })
  expect(hostKeys, 'host gets 0 answerKeys rows for their own room').toHaveLength(0)
  // (c) The question row itself carries only prompt + choices.
  const [question] = await p1Tap.probe({ collection: 'questions', where: { roomId } })
  console.log('[2] p1 sees question ->', JSON.stringify(question))
  expect(question.recordId).toBe(q0)
  expect(Object.keys(question.data).sort()).toEqual(['choices', 'index', 'prompt', 'roomId'])
  const choices = question.data.choices as string[]
  const prompt = question.data.prompt as string
  const correct = correctChoiceIndex(prompt, choices)
  expect(correct).toBeGreaterThanOrEqual(0)

  // --- 3. Two concurrent submits from the same user: exactly one wins ---
  const [a, b] = await p1.page.evaluate(
    async ([questionId]) => {
      const path = '/src/lib/call-action.ts'
      const { callAction } = await import(/* @vite-ignore */ path)
      return Promise.all([
        callAction('submitAnswer', { questionId, choiceIndex: 0 }),
        callAction('submitAnswer', { questionId, choiceIndex: 1 }),
      ])
    },
    [q0] as const,
  )
  console.log('[3] concurrent submits ->', JSON.stringify([a, b]))
  const wins = [a, b].filter((r) => r.success)
  expect(wins).toHaveLength(1)
  const loser = [a, b].find((r) => !r.success)
  expect(loser.error).toBe('You already answered this question.')
  const p1Choice = wins[0].data.choiceIndex as number
  const p1SubmittedAt = wins[0].data.submittedAt as number
  const p1Rows = await p1Tap.probe({ collection: 'submissions', where: { questionId: q0 } })
  console.log('[3] stored submission ->', JSON.stringify(p1Rows))
  expect(p1Rows).toHaveLength(1)
  expect(p1Rows[0].data.choiceIndex).toBe(p1Choice)
  // Nobody else can read p1's submission.
  expect(await p2Tap.probe({ collection: 'submissions', where: { questionId: q0 } })).toHaveLength(0)
  expect(await hostTap.probe({ collection: 'submissions', where: { questionId: q0 } })).toHaveLength(0)

  // --- 4. Refresh mid-question restores everything from records ---
  await p1.page.goto(`/room/${roomId}`)
  await expect(p1.page.getByTestId('room-code')).toHaveText(code, { timeout: 15_000 })
  await p1.page.reload()
  await expect(p1.page.getByTestId('room-code')).toHaveText(code, { timeout: 15_000 })
  await expect(p1.page.getByText('Status: question')).toBeVisible()
  await expect(p1.page.getByTestId('player-count')).toHaveText('2')
  const [roomAfter] = await p1Tap.probe({ collection: 'rooms', where: { roomId } })
  const [questionAfter] = await p1Tap.probe({ collection: 'questions', where: { roomId } })
  const subsAfter = await p1Tap.probe({ collection: 'submissions', where: { questionId: q0 } })
  console.log('[4] after refresh ->', JSON.stringify({ room: roomAfter.data, subs: subsAfter.length }))
  expect(roomAfter.data).toMatchObject({ status: 'question', currentIndex: 0, endsAt: opened.data.endsAt, answeredCount: 1 })
  expect(questionAfter.data).toMatchObject({ prompt, choices })
  expect(subsAfter.map((s) => s.data.choiceIndex)).toEqual([p1Choice])

  // --- 5. p2 answers correctly; then concurrent reveals score exactly once ---
  const p2Submit = await act<{ submittedAt: number }>(p2.page, 'submitAnswer', { questionId: q0, choiceIndex: correct })
  expect(p2Submit.success).toBe(true)
  if (!p2Submit.success) return
  // Everyone has answered, so reveal is allowed before endsAt. Six calls at
  // once from two different users.
  const reveals = await Promise.all(
    [p1, p2, p1, p2, p1, p2].map((p) =>
      act<{ alreadyRevealed: boolean; by?: string }>(p.page, 'revealQuestion', { roomId }),
    ),
  )
  console.log('[5] concurrent reveals ->', JSON.stringify(reveals))
  expect(reveals.every((r) => r.success)).toBe(true)
  const scorers = reveals.filter((r) => r.success && !r.data.alreadyRevealed)
  expect(scorers).toHaveLength(1)

  const endsAt = opened.data.endsAt
  const expectedP1 = scoreFor(p1Choice === correct, p1SubmittedAt, endsAt)
  const expectedP2 = scoreFor(true, p2Submit.data.submittedAt, endsAt)
  expect(expectedP2).toBeGreaterThan(500) // so a double score would be visible
  const scores = Object.fromEntries(
    (await hostTap.probe({ collection: 'players', where: { roomId } })).map((r) => [r.data.userId, r.data.score]),
  )
  console.log('[5] scores ->', JSON.stringify({ scores, expectedP1, expectedP2 }))
  // Each player's user id, read from their own submission row.
  const p1Id = p1Rows[0].data.userId as string
  const [p2Row] = await p2Tap.probe({ collection: 'submissions', where: { questionId: q0 } })
  const p2Id = p2Row.data.userId as string
  expect(scores[p1Id]).toBe(expectedP1)
  expect(scores[p2Id]).toBe(expectedP2)

  // The reveal is merged into the question and matches the answer key.
  const [revealed] = await p2Tap.probe({ collection: 'questions', where: { roomId } })
  expect(revealed.data.reveal).toMatchObject({ correctIndex: correct, passage: FIXTURES.find((q) => q.prompt === prompt)!.passage })

  // --- 6. A submission after endsAt is rejected ---
  const opened1 = await act<{ questionId: string; endsAt: number }>(host.page, 'openQuestion', { roomId })
  expect(opened1.success).toBe(true)
  if (!opened1.success) return
  // Same machine, so the test clock and the worker clock agree.
  await p1.page.waitForTimeout(Math.max(0, opened1.data.endsAt - Date.now()) + 500)
  const late = await act(p1.page, 'submitAnswer', { questionId: opened1.data.questionId, choiceIndex: 0 })
  console.log('[6] late submit ->', JSON.stringify(late))
  expect(late).toEqual({ success: false, error: "Time's up." })
  expect(await p1Tap.probe({ collection: 'submissions', where: { questionId: opened1.data.questionId } })).toHaveLength(0)
  // Time is up, so a reveal with zero answers is allowed and scores nothing.
  const reveal1 = await act<{ alreadyRevealed: boolean }>(p2.page, 'revealQuestion', { roomId })
  expect(reveal1).toEqual({ success: true, data: { alreadyRevealed: false } })
  const scoresAfter = Object.fromEntries(
    (await hostTap.probe({ collection: 'players', where: { roomId } })).map((r) => [r.data.userId, r.data.score]),
  )
  expect(scoresAfter).toEqual(scores)
  expect(QUESTION_DURATION_MS).toBe(20_000)
})
