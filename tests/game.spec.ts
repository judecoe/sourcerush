/**
 * Game integrity, run against the real local worker with signed-in users.
 * No game UI exists yet, so actions are called through the app's own
 * `callAction` and reads go through raw `core.subscribe` probes on each
 * user's authenticated records socket.
 *
 * Accounts: host (creates the room and also plays), p1 and p2 (players). They are
 * this spec's own accounts (label `sourcerush-game`), so other specs running
 * in parallel never act as the same users.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { FIXTURE_CANDIDATES } from '../src/lib/questions/fixtures'
import type { Question } from '../src/lib/questions/validate'
import { QUESTION_DURATION_MS, scoreFor } from '../src/lib/scoring'
import { baselineAverage, dailyAverage, dailyDay, topPercent } from '../src/lib/daily'
import { act, openApp, tapRecordsSocket } from './helpers/game'

const LABEL = 'sourcerush-game'
const usable = loadAllTestAccounts().filter((a) => a.label === LABEL).length
test.skip(
  usable < 3,
  `Needs 3 test accounts labelled ${LABEL}, found ${usable}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --label sourcerush-game --password-stdin`.',
)

const FIXTURES = FIXTURE_CANDIDATES as Question[]
const PASSAGES = FIXTURES.map((q) => q.passage)
const EXPLANATIONS = FIXTURES.map((q) => q.explanation)

/** Index of the correct choice in a (shuffled) question, found via the fixtures. */
function correctChoiceIndex(prompt: string, choices: string[]): number {
  const fixture = FIXTURES.find((q) => q.prompt === prompt)
  if (!fixture) throw new Error(`no fixture for prompt: ${prompt}`)
  return choices.indexOf(fixture.choices[fixture.correctIndex])
}

test('createRoom refuses bad input before creating anything', async ({ users }) => {
  const [host] = await users(1, { label: LABEL })
  const hostTap = await tapRecordsSocket(host.page)
  await openApp(host.page)
  // Rooms this account can read (every room it hosted or joined). Tests in
  // this file run one at a time, so nothing else adds rooms meanwhile.
  // Local data persists and this account gains a room every run, so the
  // count must stay below the limit: at the limit, before === after would
  // pass even if a room had been created. (With no limit the socket query
  // is uncapped today; the explicit one keeps this check honest if that
  // ever changes.) 500 matches ROOM_QUERY_LIMIT in src/actions/index.ts.
  const ROOMS_PROBE_LIMIT = 500
  const roomsBefore = (await hostTap.probe({ collection: 'rooms', limit: ROOMS_PROBE_LIMIT })).length
  console.log(`[refuse] host can read ${roomsBefore} rooms before (limit ${ROOMS_PROBE_LIMIT})`)
  expect(roomsBefore, 'too many local rooms for this check; clear local dev data').toBeLessThan(ROOMS_PROBE_LIMIT)
  // Each of these is refused by parseCreateRoomParams, before the quota slot
  // or the room is created, so no test here can reach a paid integration
  // (no Exa, Firecrawl or Anthropic call).
  for (const params of [
    {},
    { sample: true, url: 'https://example.com' },
    { url: 'ftp://example.com/a' },
    { url: 'not a url' },
    { url: 'https://example.com/a', topic: 'tides' },
    { topic: 'ab' },
    { topic: 'https://example.com/tides' },
  ]) {
    const created = await act(host.page, 'createRoom', params)
    console.log('[refuse] createRoom', JSON.stringify(params), '->', JSON.stringify(created))
    expect(created.success, JSON.stringify(params)).toBe(false)
  }
  expect((await hostTap.probe({ collection: 'rooms', limit: ROOMS_PROBE_LIMIT })).length).toBe(roomsBefore)
})

test('no client can read or write a job queue', async ({ users }) => {
  const [user] = await users(1, { label: LABEL })
  await openApp(user.page)
  // The user's own JWT, taken from the Authorization header of a refused (free) action call.
  const request = user.page.waitForRequest((r) => r.url().includes('/api/actions/createRoom'))
  await act(user.page, 'createRoom', {})
  const token = ((await request).headers()['authorization'] ?? '').replace(/^Bearer /, '')
  expect(token).not.toBe('')
  // Raw socket to a job queue, as a hand-modified client could open. The job
  // type is made up, so even a successful enqueue could never spend credits.
  const frames = await user.page.evaluate(async (token) => {
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/jobs/room%3Aprobe?token=${token}`)
    const seen: string[] = []
    ws.onmessage = (e) => seen.push(String(e.data))
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true)
      ws.onclose = (e) => {
        seen.push(`closed ${e.code} ${e.reason}`)
        resolve(false)
      }
    })
    if (opened) {
      ws.send(JSON.stringify({ type: 'job.enqueue', payload: { requestId: 'probe', type: 'probe-not-a-real-job', payload: {} } }))
      await new Promise((resolve) => setTimeout(resolve, 1500))
      ws.close()
    }
    return { opened, seen }
  }, token)
  console.log('[jobs] socket ->', JSON.stringify(frames))
  expect(frames.opened).toBe(true)
  expect(frames.seen.some((f) => f.includes('"canWrite":false'))).toBe(true)
  expect(frames.seen.some((f) => f.includes('Write access denied'))).toBe(true)
  expect(frames.seen.some((f) => f.includes('probe-not-a-real-job'))).toBe(false)
})

test('setDisplayName / joinRoom name: validates, used in the room, saved, lobbies only', async ({ users }) => {
  test.setTimeout(90_000)
  const [host, p1] = await users(2, { label: LABEL })
  const hostTap = await tapRecordsSocket(host.page)
  const p1Tap = await tapRecordsSocket(p1.page)
  await Promise.all([openApp(host.page), openApp(p1.page)])
  const tag = Math.random().toString(36).slice(2, 7)

  for (const name of ['', '   ', 'x'.repeat(25), 'two\nlines', 42]) {
    const refused = await act(p1.page, 'setDisplayName', { name })
    console.log('[name] refuse', JSON.stringify(name), '->', JSON.stringify(refused))
    expect(refused.success, JSON.stringify(name)).toBe(false)
  }

  // A name saved before creating a room is the host's players name.
  const hostName = `Host ${tag}`
  expect((await act(host.page, 'setDisplayName', { name: `  Host   ${tag} ` })).success).toBe(true)
  const created = await act<{ roomId: string; code: string }>(host.page, 'createRoom', { sample: true })
  expect(created.success).toBe(true)
  if (!created.success) return
  const { roomId, code } = created.data
  const [roomRow] = await hostTap.probe({ collection: 'rooms', where: { roomId } })
  const hostId = roomRow.data.hostId as string
  /** Display names in this room's players rows: [host's, the other player's]. */
  const names = async () => {
    const rows = await hostTap.probe({ collection: 'players', where: { roomId } })
    return [
      rows.find((r) => r.data.userId === hostId)?.data.displayName,
      rows.find((r) => r.data.userId !== hostId)?.data.displayName,
    ]
  }
  expect((await names())[0]).toBe(hostName)

  // joinRoom: a bad name is refused before anything is written; a good one
  // is used in the room and saved for next time.
  const refusedJoin = await act(p1.page, 'joinRoom', { code, name: 'two\nlines' })
  expect(refusedJoin.success).toBe(false)
  expect((await names())[1]).toBeUndefined()
  const joinName = `Join ${tag}`
  expect((await act(p1.page, 'joinRoom', { code, name: joinName })).success).toBe(true)
  expect((await names())[1]).toBe(joinName)
  expect((await p1Tap.probe({ collection: 'users', limit: 1 }))[0]?.data.displayName).toBe(joinName)

  // The host's prompt: rename in this room only (setDisplayName with roomId).
  const promptName = `Prompt ${tag}`
  const prompted = await act(host.page, 'setDisplayName', { name: promptName, roomId })
  expect(prompted.success).toBe(true)
  expect((await names())[0]).toBe(promptName)

  // Renaming in the lobby updates the players row everyone reads.
  const lobbyName = `Lobby ${tag}`
  const renamed = await act<{ displayName: string; renamedRooms: number }>(p1.page, 'setDisplayName', {
    name: lobbyName,
  })
  console.log('[name] lobby rename ->', JSON.stringify(renamed))
  expect(renamed.success).toBe(true)
  if (renamed.success) expect(renamed.data.renamedRooms).toBeGreaterThanOrEqual(1)
  expect((await names())[1]).toBe(lobbyName)

  // Once the game has started, a rename doesn't touch this room.
  expect((await act(host.page, 'openQuestion', { roomId })).success).toBe(true)
  // The per-room rename is refused once the game has started.
  const lateRoomRename = await act(host.page, 'setDisplayName', { name: `Late ${tag}`, roomId })
  console.log('[name] room rename after start ->', JSON.stringify(lateRoomRename))
  expect(lateRoomRename.success).toBe(false)
  expect((await names())[0]).toBe(promptName)
  const laterName = `Later ${tag}`
  expect((await act(p1.page, 'setDisplayName', { name: laterName })).success).toBe(true)
  expect((await names())[1]).toBe(lobbyName)
  // But it is saved on p1's own users row.
  // (users is read: 'own', so this returns only p1's row.)
  const me = await p1Tap.probe({ collection: 'users', limit: 1 })
  expect(me[0]?.data.displayName).toBe(laterName)
})

test('full round: host check, secrecy, one submission, one scoring, late rejection, refresh', async ({
  users,
}) => {
  test.setTimeout(180_000)
  const [host, p1, p2] = await users(3, { label: LABEL })
  const hostTap = await tapRecordsSocket(host.page)
  const p1Tap = await tapRecordsSocket(p1.page)
  const p2Tap = await tapRecordsSocket(p2.page)
  await Promise.all([openApp(host.page), openApp(p1.page), openApp(p2.page)])

  // --- Setup: create, join ---
  const created = await act<{ roomId: string; code: string; status: string }>(host.page, 'createRoom', {
    sample: true,
  })
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

  // The host is a player too: createRoom gave them a players row at score 0.
  // (They answer in step 5, after the answeredCount check in step 4.)
  const [roomRow] = await hostTap.probe({ collection: 'rooms', where: { roomId } })
  const hostId = roomRow.data.hostId as string
  const playersAtStart = await hostTap.probe({ collection: 'players', where: { roomId } })
  expect(playersAtStart).toHaveLength(3)
  const hostRow = playersAtStart.find((r) => r.data.userId === hostId)
  expect(hostRow?.recordId).toBe(`${roomId}:${hostId}`)
  expect(hostRow?.data.score).toBe(0)
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
    for (const collection of ['answerKeys', 'sources', 'reveal_locks', 'room_quota']) {
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
  // (The room code is shown only in the lobby; mid-question the page shows
  // p1's locked-in answer.)
  await p1.page.goto(`/room/${roomId}`)
  await expect(p1.page.getByTestId('answer-locked')).toBeVisible({ timeout: 15_000 })
  await p1.page.reload()
  await expect(p1.page.getByTestId('answer-locked')).toBeVisible({ timeout: 15_000 })
  await expect(p1.page.getByTestId('question-prompt')).toHaveText(prompt)
  const [roomAfter] = await p1Tap.probe({ collection: 'rooms', where: { roomId } })
  const [questionAfter] = await p1Tap.probe({ collection: 'questions', where: { roomId } })
  const subsAfter = await p1Tap.probe({ collection: 'submissions', where: { questionId: q0 } })
  console.log('[4] after refresh ->', JSON.stringify({ room: roomAfter.data, subs: subsAfter.length }))
  expect(roomAfter.data).toMatchObject({ status: 'question', currentIndex: 0, endsAt: opened.data.endsAt, answeredCount: 1 })
  expect(questionAfter.data).toMatchObject({ prompt, choices })
  expect(subsAfter.map((s) => s.data.choiceIndex)).toEqual([p1Choice])
  // Leave the room page: its auto-reveal would otherwise call revealQuestion
  // itself and race the reveal checks below. Probes still work from /home.
  await openApp(p1.page)

  // --- 5. p2 and the host answer correctly; then concurrent reveals score exactly once ---
  const p2Submit = await act<{ submittedAt: number }>(p2.page, 'submitAnswer', { questionId: q0, choiceIndex: correct })
  expect(p2Submit.success).toBe(true)
  if (!p2Submit.success) return
  // The host counts as a player, so the round can't close early without them.
  const tooEarly = await act(p1.page, 'revealQuestion', { roomId })
  expect(tooEarly).toEqual({ success: false, error: 'The round is still open.' })
  const hostSubmit = await act<{ submittedAt: number }>(host.page, 'submitAnswer', { questionId: q0, choiceIndex: correct })
  console.log('[5] host submit ->', JSON.stringify(hostSubmit))
  expect(hostSubmit.success).toBe(true)
  if (!hostSubmit.success) return
  // Players can't read the host's submission either.
  for (const tap of [p1Tap, p2Tap]) {
    const rows = await tap.probe({ collection: 'submissions', where: { questionId: q0 } })
    expect(rows.filter((r) => r.data.userId === hostId)).toHaveLength(0)
  }
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
  // The host is scored by the same rule, exactly once.
  const expectedHost = scoreFor(true, hostSubmit.data.submittedAt, endsAt)
  expect(expectedHost).toBeGreaterThan(500)
  expect(scores[hostId]).toBe(expectedHost)

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
  expect(QUESTION_DURATION_MS).toBe(60_000)
})

test('quiz of the day: one attempt each, solo room, private plays, compared with the average before you', async ({
  users,
}) => {
  test.setTimeout(180_000)
  // outsider reads, tries to join, and at the end plays as the second finisher.
  const [player, outsider] = await users(2, { label: LABEL })
  const playerTap = await tapRecordsSocket(player.page)
  const outsiderTap = await tapRecordsSocket(outsider.page)
  await Promise.all([openApp(player.page), openApp(outsider.page)])
  const day = dailyDay(Date.now())

  // Local dev has no cron generation: clear today and seed it from the free sample.
  const seeded = await act<{ day: string; seeded: boolean }>(player.page, 'devSeedDailyQuiz', { reset: true })
  console.log('[daily] seed ->', JSON.stringify(seeded))
  expect(seeded).toMatchObject({ success: true, data: { seeded: true } })

  // The public summary: readable by anyone signed in, only the day's average.
  // With nobody finished yet, it is the day's baseline (2000–3000).
  const [stats0] = await outsiderTap.probe({ collection: 'daily_stats', where: { day } })
  console.log('[daily] stats before ->', JSON.stringify(stats0.data))
  expect(FIXTURES.length).toBe(8) // the daily quiz is always 8 questions
  expect(stats0.data).toMatchObject({ status: 'ready', questionCount: 8, averageScore: baselineAverage(day), stdDev: 0 })
  const allowed = ['averageScore', 'day', 'questionCount', 'status', 'stdDev', 'title']
  for (const key of Object.keys(stats0.data)) expect(allowed, `daily_stats field ${key}`).toContain(key)
  for (const tap of [playerTap, outsiderTap]) {
    for (const collection of ['daily_quizzes', 'answerKeys', 'sources']) {
      expect(await tap.probe({ collection }), `no ${collection} rows`).toHaveLength(0)
    }
  }

  // Two Play calls at once: both get the same room (one attempt per day).
  const [a, b] = await Promise.all([
    act<{ roomId: string; alreadyPlayed: boolean }>(player.page, 'playDailyQuiz'),
    act<{ roomId: string; alreadyPlayed: boolean }>(player.page, 'playDailyQuiz'),
  ])
  console.log('[daily] concurrent plays ->', JSON.stringify([a, b]))
  expect(a.success && b.success).toBe(true)
  if (!a.success || !b.success) return
  expect(a.data.roomId).toBe(b.data.roomId)
  expect([a.data.alreadyPlayed, b.data.alreadyPlayed].filter((x) => !x)).toHaveLength(1)
  const roomId = a.data.roomId

  await openApp(player.page) // fresh page after becoming a member
  const [room] = await playerTap.probe({ collection: 'rooms', where: { roomId } })
  expect(room.data.dailyDay).toBe(day)

  // Nobody can join a daily room by its code.
  expect(await act(outsider.page, 'joinRoom', { code: room.data.code })).toEqual({
    success: false,
    error: 'No room with that code.',
  })

  // Play every question; the player is the only player, so each round
  // closes as soon as they answer. `correctOnly` picks the right answer,
  // else always the first choice.
  async function playThrough(
    page: typeof player.page,
    tap: typeof playerTap,
    id: string,
    correctOnly: boolean,
  ) {
    let rounds = 0
    for (;;) {
      const opened = await act<{ status: string; questionId?: string }>(page, 'openQuestion', { roomId: id })
      expect(opened.success).toBe(true)
      if (!opened.success || opened.data.status === 'finished') break
      const [q] = await tap.probe({ collection: 'questions', where: { roomId: id, index: rounds } })
      const choice = correctOnly ? correctChoiceIndex(q.data.prompt as string, q.data.choices as string[]) : 0
      expect((await act(page, 'submitAnswer', { questionId: opened.data.questionId, choiceIndex: choice })).success).toBe(true)
      expect((await act(page, 'revealQuestion', { roomId: id })).success).toBe(true)
      rounds++
    }
    expect(rounds).toBe(FIXTURES.length)
  }
  await playThrough(player.page, playerTap, roomId, true)

  // The player's own play row: finished, with their score, compared with the
  // average from BEFORE they finished. Nobody else reads it.
  const [myPlay] = await playerTap.probe({ collection: 'daily_plays', where: { day } })
  console.log('[daily] my play ->', JSON.stringify(myPlay?.data))
  const [me] = await playerTap.probe({ collection: 'players', where: { roomId } })
  const myScore = me.data.score as number
  expect(myPlay.data).toMatchObject({ roomId, status: 'finished', score: myScore, averageAtFinish: stats0.data.averageScore, stdDevAtFinish: 0 })
  expect(myPlay.data).not.toHaveProperty('displayName')
  // The outsider may see their own rows from other days, never the player's.
  const outsiderSees = await outsiderTap.probe({ collection: 'daily_plays' })
  expect(outsiderSees.filter((r) => r.data.userId === myPlay.data.userId)).toHaveLength(0)

  // Only after finishing does their score move the public average (baseline weighted 5).
  const [stats] = await outsiderTap.probe({ collection: 'daily_stats', where: { day } })
  console.log('[daily] stats after ->', JSON.stringify(stats.data))
  expect(stats.data).toMatchObject(dailyAverage(baselineAverage(day), [myScore]))

  // Playing again just returns the same room.
  const again = await act<{ roomId: string; alreadyPlayed: boolean }>(player.page, 'playDailyQuiz')
  expect(again).toMatchObject({ success: true, data: { roomId, alreadyPlayed: true } })

  // UI: /daily shows the result against the earlier average, with the curve
  // and the player's marker; home shows today's (new) average and no top player.
  await player.page.goto('/daily')
  await expect(player.page.getByTestId('daily-result')).toBeVisible({ timeout: 15_000 })
  await expect(player.page.getByTestId('daily-my-score')).toHaveText(myScore.toLocaleString('en-US'))
  await expect(player.page.getByTestId('daily-average-at-finish')).toHaveText(
    (stats0.data.averageScore as number).toLocaleString('en-US'),
  )
  await expect(player.page.getByTestId('daily-relative')).toContainText('points above the average')
  await expect(player.page.getByTestId('daily-top-percent')).toHaveText(
    `Top ${topPercent(myScore, stats0.data.averageScore as number, 0, FIXTURES.length * 1000)}% of players`,
  )
  await expect(player.page.getByTestId('bell-curve-you')).toHaveCount(1)
  await outsider.page.goto('/home')
  await expect(outsider.page.getByTestId('daily-card')).toBeVisible({ timeout: 15_000 })
  await expect(outsider.page.getByTestId('daily-average')).toHaveText(
    (stats.data.averageScore as number).toLocaleString('en-US'),
  )
  await expect(outsider.page.getByText(/top score/i)).toHaveCount(0)

  // A second player is compared with the average that includes the first
  // player but not themselves; then their score joins the average too.
  const second = await act<{ roomId: string }>(outsider.page, 'playDailyQuiz')
  expect(second.success).toBe(true)
  if (!second.success) return
  await openApp(outsider.page)
  await playThrough(outsider.page, outsiderTap, second.data.roomId, false)
  const [theirPlay] = await outsiderTap.probe({ collection: 'daily_plays', where: { day } })
  const [them] = await outsiderTap.probe({ collection: 'players', where: { roomId: second.data.roomId } })
  console.log('[daily] second play ->', JSON.stringify(theirPlay?.data))
  expect(theirPlay.data).toMatchObject({
    status: 'finished',
    score: them.data.score,
    averageAtFinish: stats.data.averageScore,
    stdDevAtFinish: stats.data.stdDev,
  })
  const [statsAfter2] = await playerTap.probe({ collection: 'daily_stats', where: { day } })
  console.log('[daily] stats after 2 ->', JSON.stringify(statsAfter2.data))
  expect(statsAfter2.data).toMatchObject(dailyAverage(baselineAverage(day), [myScore, them.data.score as number]))
  // The first player's saved result didn't move.
  const [myPlayLater] = await playerTap.probe({ collection: 'daily_plays', where: { day } })
  expect(myPlayLater.data.averageAtFinish).toBe(stats0.data.averageScore)
})
