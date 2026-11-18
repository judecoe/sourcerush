/**
 * Lobby integrity: createRoom, joinRoom, live player list, and read access.
 *
 * Three signed-in accounts:
 *   host     creates the room (member and player, so counts start at 1)
 *   player   joins by code
 *   outsider is signed in but never joins
 *
 * Checks:
 *   - the host sees the player appear live; a refresh restores the lobby
 *   - joining twice is counted once, and returns the same room
 *   - (a) the outsider, already subscribed to `players` for this room,
 *     receives NO live update when the player joins (checked on screen and
 *     on the raw WebSocket frames, with the host's frames as the control)
 *   - (b) a signed-in client querying `team_members` gets nothing back
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usable = loadAllTestAccounts().length
test.skip(
  usable < 3,
  `Needs 3 usable test accounts, found ${usable}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin`.',
)

type ServerSide = { send: (message: string) => void }

/**
 * Sit in the middle of this page's records WebSocket (/ws/<scope>), the
 * signed-in connection useQuery uses. Every server→client frame is recorded,
 * and `probe()` injects a raw `core.subscribe` on that same authenticated
 * socket, i.e. exactly what a hand-modified client could send.
 */
async function tapRecordsSocket(page: Page) {
  const frames: string[] = []
  let server: ServerSide | null = null

  await page.routeWebSocket(
    (url) => /^\/ws\/[^/]+$/.test(url.pathname),
    (ws) => {
      const upstream = ws.connectToServer()
      ws.onMessage((message) => upstream.send(message))
      upstream.onMessage((message) => {
        frames.push(String(message))
        ws.send(message)
      })
      server = upstream
    },
  )

  async function probe(query: Record<string, unknown>) {
    if (!server) throw new Error('records socket not connected yet')
    const subscriptionId = `probe-${Math.random().toString(36).slice(2)}`
    const start = frames.length
    server.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId, query } }))
    await expect
      .poll(() => frames.slice(start).some((f) => f.includes(subscriptionId)), { timeout: 10_000 })
      .toBe(true)
    const reply = frames.slice(start).find((f) => f.includes(subscriptionId))!
    return JSON.parse(reply) as {
      type: string
      payload: { records?: { recordId: string }[]; error?: string }
    }
  }

  return { frames, probe }
}

test('create, join, live list, refresh, rejoin, and read isolation', async ({ users }) => {
  test.setTimeout(90_000)
  const [host, player, outsider] = await users(3)

  const hostTap = await tapRecordsSocket(host.page)
  const playerTap = await tapRecordsSocket(player.page)
  const outsiderTap = await tapRecordsSocket(outsider.page)

  // Host creates a room.
  await host.page.goto('/create')
  await host.page.getByRole('button', { name: 'Try it yourself' }).click()
  await host.page.waitForURL(/\/room\/[^/]+$/, { timeout: 15_000 })
  const roomId = host.page.url().split('/room/')[1]
  const code = (await host.page.getByTestId('room-code').textContent())?.trim() ?? ''
  expect(code).toMatch(/^[A-Z2-9]{6}$/)
  await expect(host.page.getByTestId('player-count')).toHaveText('1')

  // Outsider tries a wrong code, then opens the room
  // page directly, which subscribes them to rooms + players for this room.
  await outsider.page.goto('/join')
  await outsider.page.getByLabel('Room code').fill('ZZZZZZ')
  await outsider.page.getByRole('button', { name: 'Join' }).click()
  await expect(outsider.page.getByRole('alert')).toHaveText('No room with that code.')
  await outsider.page.goto(`/room/${roomId}`)
  await expect(outsider.page.getByTestId('not-member')).toBeVisible({ timeout: 15_000 })
  // Non-members get no player list at all. Leaks are checked on the wire below.
  await expect(outsider.page.getByTestId('player-count')).toHaveCount(0)

  // Player joins by code (lower case, to check normalisation).
  await player.page.goto('/join')
  await player.page.getByLabel('Room code').fill(code.toLowerCase())
  await player.page.getByRole('button', { name: 'Join' }).click()
  await player.page.waitForURL(`**/room/${roomId}`, { timeout: 15_000 })
  await expect(player.page.getByTestId('room-code')).toHaveText(code, { timeout: 15_000 })
  await expect(player.page.getByTestId('player-count')).toHaveText('2')

  // Host sees the new player live, without reloading.
  await expect(host.page.getByTestId('player-count')).toHaveText('2', { timeout: 10_000 })

  // Refresh restores the lobby from records.
  await player.page.reload()
  await expect(player.page.getByTestId('room-code')).toHaveText(code, { timeout: 15_000 })
  await expect(player.page.getByTestId('player-count')).toHaveText('2')

  // Joining again returns the same room and doesn't add a second row.
  await player.page.goto('/join')
  await player.page.getByLabel('Room code').fill(code)
  await player.page.getByRole('button', { name: 'Join' }).click()
  await player.page.waitForURL(`**/room/${roomId}`, { timeout: 15_000 })
  await expect(player.page.getByTestId('player-count')).toHaveText('2', { timeout: 15_000 })
  await expect(host.page.getByTestId('player-count')).toHaveText('2')

  // (a) Outsider got nothing: not on screen, not on the wire.
  await outsider.page.waitForTimeout(2_000)
  await expect(outsider.page.getByTestId('player-count')).toHaveCount(0)
  await expect(outsider.page.getByTestId('not-member')).toBeVisible()
  const marker = `${roomId}:` // prefix of every player / membership record id
  expect(hostTap.frames.some((f) => f.includes(marker)), 'control: host frames carry the player row').toBe(true)
  expect(outsiderTap.frames.some((f) => f.includes(marker)), 'outsider frames carry no player row').toBe(false)

  // Positive control for the probe: a raw, unfiltered players query from the
  // player returns their own row, and from the outsider returns nothing.
  const playerSeesPlayers = await playerTap.probe({ collection: 'players' })
  console.log('[probe players as player]', JSON.stringify(playerSeesPlayers))
  // (Local data persists between runs, so rooms the player joined earlier
  // legitimately show up too. This room's row must be among them.)
  const playerRows = playerSeesPlayers.payload.records ?? []
  expect(playerRows.some((r) => r.recordId.startsWith(marker))).toBe(true)
  const outsiderSeesPlayers = await outsiderTap.probe({ collection: 'players' })
  console.log('[probe players as outsider]', JSON.stringify(outsiderSeesPlayers))
  // The same accounts are reused by other specs, so the outsider may be a
  // real member of other rooms. What matters: nothing from THIS room.
  const outsiderRows = outsiderSeesPlayers.payload.records ?? []
  expect(outsiderRows.filter((r) => r.recordId.startsWith(marker))).toHaveLength(0)

  // (b) team_members is unreadable from a client: host, player, or outsider.
  for (const [who, tap] of [
    ['host', hostTap],
    ['player', playerTap],
    ['outsider', outsiderTap],
  ] as const) {
    const result = await tap.probe({ collection: 'team_members' })
    console.log(`[probe team_members as ${who}]`, JSON.stringify(result))
    expect(result.payload.records ?? [], `${who} gets no team_members rows`).toHaveLength(0)
  }
})
