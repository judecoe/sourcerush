/**
 * Helpers for driving the game from Playwright without any game UI.
 *
 * - `act()` calls a server action from inside a signed-in page, using the
 *   app's own `callAction` (so the request carries that user's JWT).
 * - `tapRecordsSocket()` is the same tap as in lobby.spec.ts: it records
 *   every server→client frame on the records WebSocket and can inject a raw
 *   `core.subscribe`, i.e. what a hand-modified client could send.
 */
import type { Page } from '@playwright/test'
import { expect } from 'deepspace/testing'

export type ActionResponse<T = Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; error: string }

export function act<T = Record<string, unknown>>(
  page: Page,
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionResponse<T>> {
  return page.evaluate(
    async ([name, params]) => {
      // Served by the Vite dev server the test runner starts.
      const path = '/src/lib/call-action.ts'
      const mod = await import(/* @vite-ignore */ path)
      return mod.callAction(name, params)
    },
    [name, params] as const,
  )
}

export type ProbeRecord = { recordId: string; data: Record<string, unknown> }

type ServerSide = { send: (message: string) => void }

export async function tapRecordsSocket(page: Page) {
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
      // After a navigation the old socket closes; wait for the new one.
      ws.onClose(() => {
        if (server === upstream) server = null
      })
      server = upstream
    },
  )

  /** Raw query on this user's own socket. Returns the rows the server sent. */
  async function probe(query: Record<string, unknown>): Promise<ProbeRecord[]> {
    await expect.poll(() => server !== null, { timeout: 10_000 }).toBe(true)
    if (!server) throw new Error('records socket not connected')
    const subscriptionId = `probe-${Math.random().toString(36).slice(2)}`
    const start = frames.length
    server.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId, query } }))
    await expect
      .poll(() => frames.slice(start).some((f) => f.includes(subscriptionId)), { timeout: 10_000 })
      .toBe(true)
    const reply = JSON.parse(frames.slice(start).find((f) => f.includes(subscriptionId))!) as {
      payload: { records?: ProbeRecord[]; error?: string }
    }
    if (reply.payload.error) throw new Error(`probe error: ${reply.payload.error}`)
    return reply.payload.records ?? []
  }

  return { frames, probe }
}

/** Load an app page so the providers boot and the records socket connects. */
export async function openApp(page: Page, path = '/home') {
  await page.goto(path)
  await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15_000 })
}
