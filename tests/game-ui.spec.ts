/**
 * The game UI, played entirely through the browser: create, join, start,
 * answer, refresh mid-question, automatic reveal, Next, and a round that
 * closes on time with nobody answering.
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

test('one round through the UI, then a round that closes on time', async ({ users }) => {
  test.setTimeout(150_000)
  const [host, p1, p2] = await users(3, { label: LABEL })
  const everyone = [host, p1, p2]

  // --- Create and join through the pages ---
  await host.page.goto('/create')
  await host.page.getByRole('button', { name: 'Create room' }).click()
  await host.page.waitForURL(/\/room\/[^/]+$/, { timeout: 15_000 })
  const roomId = host.page.url().split('/room/')[1]
  const code = ((await host.page.getByTestId('room-code').textContent()) ?? '').trim()
  expect(code).toMatch(/^[A-Z2-9]{6}$/)

  for (const p of [p1, p2]) {
    await p.page.goto('/join')
    await p.page.getByLabel('Room code').fill(code)
    await p.page.getByRole('button', { name: 'Join' }).click()
    await p.page.waitForURL(`**/room/${roomId}`, { timeout: 15_000 })
  }
  for (const u of everyone) {
    await expect(u.page.getByTestId('player-count')).toHaveText('3', { timeout: 15_000 })
  }
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

  // 20 s timer plus a margin for the reveal call (and its retries).
  for (const u of everyone) {
    await expect(u.page.getByTestId('reveal-passage')).toContainText(fixture2.passage, { timeout: 35_000 })
    await expect(u.page.getByTestId('my-result')).toHaveText('No answer')
  }
})
