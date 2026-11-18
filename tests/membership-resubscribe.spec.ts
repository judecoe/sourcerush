/**
 * SDK behaviour check: when a user becomes a room member while a page of
 * theirs is ALREADY subscribed to that room's rows, does that page catch up?
 *
 * The SDK's notifyTeamMembershipChange() reads `record.data.UserId` (capital
 * U), but team_members rows carry `userId`, so the "resubscribe" nudge may
 * never fire. Live writes after the join still arrive (each broadcast checks
 * membership afresh); what's at stake is rows that existed BEFORE the join.
 *
 * Normal app flow is unaffected: /join navigates to the room page after the
 * join succeeds, which opens a fresh subscription.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usable = loadAllTestAccounts().length
test.skip(usable < 3, `Needs 3 usable test accounts, found ${usable}.`)

test('a page subscribed before joining sees pre-existing room rows after join', async ({ users }) => {
  // KNOWN SDK ISSUE (deepspace 0.44.2), confirmed 2026-11-17: the open tab
  // shows only its own new row and never the room row. Marked as expected to
  // fail; when an SDK upgrade fixes it, this turns red, so remove this line.
  test.fail()
  test.setTimeout(90_000)
  const [host, player, latecomer] = await users(3)

  // Host creates; player joins (so a pre-existing player row exists).
  await host.page.goto('/create')
  await host.page.getByRole('button', { name: 'Create room' }).click()
  await host.page.waitForURL(/\/room\/[^/]+$/, { timeout: 15_000 })
  const roomId = host.page.url().split('/room/')[1]
  const code = (await host.page.getByTestId('room-code').textContent())?.trim() ?? ''

  await player.page.goto('/join')
  await player.page.getByLabel('Room code').fill(code)
  await player.page.getByRole('button', { name: 'Join' }).click()
  await expect(host.page.getByTestId('player-count')).toHaveText('1', { timeout: 15_000 })

  // Latecomer opens the room page BEFORE joining: subscribed, sees nothing.
  const watching = latecomer.page
  await watching.goto(`/room/${roomId}`)
  await expect(watching.getByTestId('not-member')).toBeVisible({ timeout: 15_000 })
  await expect(watching.getByTestId('player-count')).toHaveText('0')

  // Latecomer joins from a second tab; the first tab stays subscribed.
  const joinTab = await latecomer.context.newPage()
  await joinTab.goto('/join')
  await joinTab.getByLabel('Room code').fill(code)
  await joinTab.getByRole('button', { name: 'Join' }).click()
  await joinTab.waitForURL(`**/room/${roomId}`, { timeout: 15_000 })
  await expect(joinTab.getByTestId('player-count')).toHaveText('2', { timeout: 15_000 })

  // The already-open tab: does it receive the room row and the player who
  // joined before the latecomer? (Its own new row arrives either way.)
  await expect(watching.getByTestId('player-count')).toHaveText('2', { timeout: 10_000 })
  await expect(watching.getByTestId('room-code')).toHaveText(code)
})
