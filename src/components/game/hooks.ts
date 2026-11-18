/**
 * Timing hooks for the room page.
 *
 * The countdown is display only: the server decides when time is up
 * (submitAnswer rejects after endsAt; revealQuestion refuses before it).
 */

import { useEffect, useState } from 'react'
import { callAction } from '@/lib/call-action'
import { STALE_GENERATING_MS } from '@/lib/generation-timing'

/** Milliseconds until `endsAt` by this device's clock, never below 0. Ticks 4x a second. */
export function useMsLeft(endsAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (endsAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [endsAt])

  return endsAt === undefined ? 0 : Math.max(0, endsAt - now)
}

/**
 * True once a room has been 'generating' for longer than
 * STALE_GENERATING_MS since its `createdAt` (server time, compared with this
 * device's clock). Display only: one timer re-renders at the threshold.
 */
export function useGeneratingTooLong(createdAt: string | undefined, generating: boolean): boolean {
  const [now, setNow] = useState(() => Date.now())
  const deadline = createdAt ? new Date(createdAt).getTime() + STALE_GENERATING_MS : undefined

  useEffect(() => {
    if (!generating || deadline === undefined) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      setNow(Date.now())
      return
    }
    const timer = setTimeout(() => setNow(Date.now()), remaining + 100)
    return () => clearTimeout(timer)
  }, [generating, deadline])

  return generating && deadline !== undefined && now >= deadline
}

const REVEAL_ATTEMPTS = 5
const REVEAL_RETRY_MS = 1_000

/**
 * Ask the server to reveal the open question once `shouldReveal` is true.
 *
 * Every client does this, so whoever gets there first reveals and the rest
 * get `alreadyRevealed: true` (a success). A failure is usually this
 * device's clock running ahead of the server's ("The round is still open."),
 * so it retries quietly every second, up to 5 calls in total.
 *
 * Only acts while the room is in 'question'. When the status or question
 * changes, or the page unmounts, the cleanup cancels any pending retry.
 */
export function useAutoReveal(
  roomId: string,
  status: string | undefined,
  questionId: string | null,
  shouldReveal: boolean,
) {
  useEffect(() => {
    if (status !== 'question' || !questionId || !shouldReveal) return

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    async function tryReveal() {
      attempts += 1
      const result = await callAction('revealQuestion', { roomId })
      // A call already in flight can't be stopped, but its result is ignored.
      if (cancelled || result.success) return
      if (attempts >= REVEAL_ATTEMPTS) {
        console.warn(`[reveal] ${questionId}: gave up after ${attempts} tries: ${result.error}`)
        return
      }
      retryTimer = setTimeout(tryReveal, REVEAL_RETRY_MS)
    }

    void tryReveal()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
  }, [roomId, status, questionId, shouldReveal])
}
