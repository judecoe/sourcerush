/**
 * The game UI, played entirely through the browser: create, join, start,
 * answer, refresh mid-question, automatic reveal, Next, a round that
 * closes on time with nobody answering, the host leaving mid-question and
 * returning via the "Return to your room" link, then playing to the
 * finished screen (Host a new game / Back to home; the link is gone).
 *
 * Accounts: host (also plays), p1, p2. They are this spec's own accounts
 * (label `sourcerush-ui`), so no other spec acts as the same users.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { FIXTURE_CANDIDATES } from '../src/lib/questions/fixtures'
import type { Question } from '../src/lib/questions/validate'

const LABEL = 'sourcerush-ui'
const usable = loadAllTestAccounts().filter((a) => a.label === LABEL).length
test.skip(
  usable < 3,
  `Needs 3 test accounts labelled ${LABEL}, found ${usable}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --label sourcerush-ui --password-stdin`.',
)

const FIXTURES = FIXTURE_CANDIDATES as Question[]

function fixtureFor(prompt: string): Question {
  const fixture = FIXTURES.find((q) => q.prompt === prompt)
  if (!fixture) throw new Error(`no fixture for prompt: ${prompt}`)
  return fixture
}

/** The four choices as shown on this page, in on-screen order. */
async function readChoices(page: Page): Promise<string[]> {
  const choices: string[] = []
  for (let i = 0; i < 4; i++) {
    choices.push(((await page.getByTestId(`choice-${i}`).textContent()) ?? '').trim())
  }
  return choices
}

test('a full game through the UI', async ({ users }) => {
  test.setTimeout(240_000)
  const [host, p1, p2] = await users(3, { label: LABEL })
  const everyone = [host, p1, p2]

  // --- Create and join through the pages ---
  await host.page.goto('/create')
  await host.page.getByRole('button', { name: 'Try it yourself' }).click()
  await host.page.waitForURL(/\/room\/[^/]+$/, { timeout: 15_000 })
  const roomId = host.page.url().split('/room/')[1]
  // Name prompt before the lobby: prefilled, no code shown yet. A refresh
  // keeps it. The host picks a new name, which is used and saved.
  const tag = Math.random().toString(36).slice(2, 7)
  const hostName = `Host ${tag}`
  await expect(host.page.getByTestId('host-name')).not.toHaveValue('', { timeout: 15_000 })
  await expect(host.page.getByTestId('room-code')).toHaveCount(0)
  await host.page.reload()
  await expect(host.page.getByTestId('host-name-prompt')).toBeVisible({ timeout: 15_000 })
  await host.page.getByTestId('host-name').fill(hostName)
  await host.page.getByRole('button', { name: 'Continue' }).click()
  await expect(host.page.getByTestId('player-list')).toContainText(`${hostName} (you)`, { timeout: 15_000 })
  const code = ((await host.page.getByTestId('room-code').textContent()) ?? '').trim()
  expect(code).toMatch(/^[A-Z2-9]{6}$/)

  // p1 picks a new name on the join screen; p2 keeps the prefilled one.
  const p1Name = `P1 ${tag}`
  for (const p of [p1, p2]) {
    await p.page.goto('/join')
    await expect(p.page.getByTestId('join-name')).not.toHaveValue('', { timeout: 15_000 })
    if (p === p1) await p.page.getByTestId('join-name').fill(p1Name)
    await p.page.getByLabel('Room code').fill(code)
    await p.page.getByRole('button', { name: 'Join' }).click()
    await p.page.waitForURL(`**/room/${roomId}`, { timeout: 15_000 })
  }
  for (const u of everyone) {
    await expect(u.page.getByTestId('player-count')).toHaveText('3', { timeout: 15_000 })
  }
  await expect(host.page.getByTestId('player-list')).toContainText(p1Name)
  await expect(p1.page.getByTestId('player-list')).toContainText(`${p1Name} (you)`)
  await expect(p1.page.getByTestId('player-list')).toContainText(hostName)
  // Only the host can start.
  await expect(p1.page.getByRole('button', { name: 'Start' })).toHaveCount(0)

  // --- Question 1 ---
  await host.page.getByRole('button', { name: 'Start' }).click()
  for (const u of everyone) {
    await expect(u.page.getByTestId('question-prompt')).toBeVisible({ timeout: 15_000 })
  }
  const prompt = ((await host.page.getByTestId('question-prompt').textContent()) ?? '').trim()
  const fixture = fixtureFor(prompt)
  // Choice order is the same for everyone (shuffled once on the server).
  const choices = await readChoices(host.page)
  const correct = choices.indexOf(fixture.choices[fixture.correctIndex])
  expect(correct).toBeGreaterThanOrEqual(0)
  const wrong = (correct + 1) % 4
  // Kept for the Game over summary check.
  const p1WrongChoice = choices[wrong]
  const correctChoice = choices[correct]

  // p1 answers wrong and is locked in. The host sees the count.
  await p1.page.getByTestId(`choice-${wrong}`).click()
  await expect(p1.page.getByTestId('locked-choice')).toHaveText(choices[wrong])
  await expect(host.page.getByTestId('answered-count')).toHaveText('Answered 1 of 3', { timeout: 10_000 })
  await expect(p1.page.getByTestId('answered-count')).toHaveCount(0)

  // A mid-question refresh restores p1's locked-in answer, with no buttons.
  await p1.page.reload()
  await expect(p1.page.getByTestId('locked-choice')).toHaveText(choices[wrong], { timeout: 15_000 })
  await expect(p1.page.getByTestId('choice-0')).toHaveCount(0)

  // p2 and the host answer correctly. Everyone has answered, so the clients
  // reveal without waiting for the timer.
  await p2.page.getByTestId(`choice-${correct}`).click()
  await host.page.getByTestId(`choice-${correct}`).click()

  for (const u of everyone) {
    await expect(u.page.getByTestId('reveal-passage')).toContainText(fixture.passage, { timeout: 15_000 })
    await expect(u.page.getByTestId('reveal-explanation')).toHaveText(fixture.explanation)
    await expect(u.page.getByTestId('correct-choice')).toContainText(choices[correct])
    await expect(u.page.getByTestId('leaderboard-row')).toHaveCount(3)
  }
  await expect(p1.page.getByTestId('my-result')).toHaveText('Not quite. +0')
  for (const u of [p2, host]) {
    await expect(u.page.getByTestId('my-result')).toHaveText(/^Correct! \+\d+$/)
    // The displayed points match the authoritative score on the leaderboard
    // (it's the first question, so the total is just these points).
    const points = ((await u.page.getByTestId('my-result').textContent()) ?? '').split('+')[1]
    const myRow = u.page.getByTestId('leaderboard-row').filter({ hasText: '(you)' })
    await expect(myRow.getByTestId('leaderboard-score')).toHaveText(points)
  }
  // Leaderboard is sorted by score: p1 (0 points) is last.
  const lastRow = p1.page.getByTestId('leaderboard-row').last()
  await expect(lastRow).toContainText('(you)')
  await expect(lastRow.getByTestId('leaderboard-score')).toHaveText('0')
  // Only the host gets Next.
  await expect(p1.page.getByRole('button', { name: 'Next' })).toHaveCount(0)

  // --- Question 2: nobody answers; the round closes on time ---
  await host.page.getByRole('button', { name: 'Next' }).click()
  for (const u of everyone) {
    await expect(u.page.getByText('Question 2')).toBeVisible({ timeout: 15_000 })
    await expect(u.page.getByTestId('question-prompt')).not.toHaveText(prompt)
  }
  const prompt2 = ((await host.page.getByTestId('question-prompt').textContent()) ?? '').trim()
  const fixture2 = fixtureFor(prompt2)

  // 60 s timer plus a margin for the reveal call (and its retries).
  for (const u of everyone) {
    await expect(u.page.getByTestId('reveal-passage')).toContainText(fixture2.passage, { timeout: 75_000 })
    await expect(u.page.getByTestId('my-result')).toHaveText('No answer')
  }

  // --- Question 3: the host leaves mid-question and comes back via the link ---
  await host.page.getByRole('button', { name: 'Next' }).click()
  for (const u of everyone) {
    await expect(u.page.getByText('Question 3')).toBeVisible({ timeout: 15_000 })
  }
  const prompt3 = ((await host.page.getByTestId('question-prompt').textContent()) ?? '').trim()
  await host.page.goto('/create')
  const link = host.page.getByTestId('return-to-room')
  await expect(link).toContainText('Return to your room', { timeout: 15_000 })
  await expect(link).toContainText(code)
  await link.click()
  await host.page.waitForURL(`**/room/${roomId}`)
  // Back in the same open question, still able to answer.
  await expect(host.page.getByTestId('question-prompt')).toHaveText(prompt3, { timeout: 15_000 })
  await expect(host.page.getByText('Question 3')).toBeVisible()
  await expect(host.page.getByTestId('choice-0')).toBeEnabled()

  // --- Questions 3 to the last: everyone answers, so each round closes early ---
  for (let n = 3; ; n++) {
    for (const u of everyone) {
      await expect(u.page.getByText(`Question ${n}`)).toBeVisible({ timeout: 15_000 })
      await u.page.getByTestId('choice-0').click()
      await expect(u.page.getByTestId('locked-choice')).toBeVisible()
    }
    for (const u of everyone) {
      await expect(u.page.getByTestId('reveal-passage')).toBeVisible({ timeout: 15_000 })
    }
    await host.page.getByRole('button', { name: 'Next' }).click()
    // Next either opens question n + 1 or, after the last one, ends the game.
    const next = host.page.getByText(`Question ${n + 1}`).or(host.page.getByTestId('finished'))
    await expect(next).toBeVisible({ timeout: 15_000 })
    if (await host.page.getByTestId('finished').isVisible()) break
  }

  // --- Finished: both buttons, and the link is gone ---
  for (const u of everyone) {
    await expect(u.page.getByTestId('finished')).toBeVisible({ timeout: 15_000 })
    await expect(u.page.getByRole('link', { name: 'Host a new game' })).toHaveAttribute('href', '/create')
    await expect(u.page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/home')
  }

  // --- Your answers: one row per question, each player's own results ---
  // Q1: p1 wrong, p2 and the host right. Q2: nobody answered. Q3 on:
  // everyone picked choice-0 (right or wrong depends on the shuffle).
  const expectedFirstTwo = new Map([
    [host, ['correct', 'none']],
    [p1, ['wrong', 'none']],
    [p2, ['correct', 'none']],
  ])
  let questionCount = 0
  for (const u of everyone) {
    const rows = u.page.getByTestId('summary-row')
    await expect(rows.first()).toBeVisible({ timeout: 15_000 })
    // Wait until no row is still loading its submission.
    await expect(u.page.locator('[data-testid="summary-row"][data-result="loading"]')).toHaveCount(0, {
      timeout: 15_000,
    })
    const results = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-result')))
    console.log('[summary]', JSON.stringify(results))
    if (questionCount === 0) questionCount = results.length
    expect(results.length).toBe(questionCount)
    expect(results.slice(0, 2)).toEqual(expectedFirstTwo.get(u))
    for (const r of results.slice(2)) expect(['correct', 'wrong']).toContain(r)
    await expect(rows.first()).toContainText('Question 1')
  }
  expect(questionCount).toBeGreaterThanOrEqual(3)
  // p1's wrong first answer: their pick in a red-bordered box, the right one
  // in a green-bordered box; both in the normal text colour.
  const firstRow = p1.page.getByTestId('summary-row').first()
  const pick = firstRow.getByTestId('summary-pick')
  const right = firstRow.getByTestId('summary-correct')
  await expect(pick).toContainText(p1WrongChoice)
  await expect(right).toContainText(correctChoice)
  const css = (el: Element) => {
    const s = getComputedStyle(el)
    const text = getComputedStyle(el.querySelector('span:last-child')!).color
    return { border: s.borderTopColor, text }
  }
  const pickCss = await pick.evaluate(css)
  const rightCss = await right.evaluate(css)
  console.log('[summary] p1 Q1 pick', JSON.stringify(pickCss), 'correct', JSON.stringify(rightCss))
  expect(pickCss.border).toBe('rgb(255, 123, 123)') // destructive
  expect(rightCss.border).toBe('rgb(94, 229, 154)') // success
  expect(pickCss.text).toBe(rightCss.text)
  // A right answer shows only the pick, green-bordered; no separate box.
  const hostFirst = host.page.getByTestId('summary-row').first()
  expect(await hostFirst.getByTestId('summary-pick').evaluate(css)).toEqual({ ...rightCss })
  await expect(hostFirst.getByTestId('summary-correct')).toHaveCount(0)
  await host.page.getByRole('link', { name: 'Host a new game' }).click()
  await host.page.waitForURL('**/create')
  // Wait until the rooms query has loaded before checking for absence.
  await expect(host.page.getByTestId('return-link-ready')).toBeAttached({ timeout: 15_000 })
  // This room is the host's newest, so if finished rooms weren't skipped the
  // link would show this code. We don't assert the link is absent: earlier
  // runs that stopped mid-game leave the host in active rooms in the
  // persisted local dev state, and the link rightly points to those.
  await expect(host.page.getByTestId('return-to-room').filter({ hasText: code })).toHaveCount(0)
})
