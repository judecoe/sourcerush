/**
 * How long question generation may take. Shared by the job (server) and the
 * room page (client), so the relationship below lives in one place.
 *
 * Worst case for one room: one scrape + GENERATE_ATTEMPTS (2) generations
 *   = 30 s + 60 s + 60 s = 150 s,
 * which finishes before the room page calls it "taking longer than expected"
 * at 180 s. The 30 s margin covers record writes and the job starting.
 * pipeline.test.ts checks the inequality.
 *
 * A timeout stops the job waiting; the integration call itself can't be
 * cancelled, so it may still finish (and bill) in the background.
 */

export const SCRAPE_TIMEOUT_MS = 30_000
export const GENERATE_TIMEOUT_MS = 60_000
export const STALE_GENERATING_MS = 180_000
