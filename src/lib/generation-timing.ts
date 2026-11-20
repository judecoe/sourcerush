/**
 * How long question generation may take. Shared by the job (server) and the
 * room page (client), so the relationship below lives in one place.
 *
 * Worst case for one room: one article search (topic rooms only) + the
 * scrape budget (however many pages it covers) + GENERATE_ATTEMPTS (2) generations
 *   = 10 s + 30 s + 60 s + 60 s = 160 s,
 * which finishes before the room page calls it "taking longer than expected"
 * at 180 s. The 20 s margin covers record writes and the job starting.
 * pipeline.test.ts checks the inequality.
 *
 * A timeout stops the job waiting; the integration call itself can't be
 * cancelled, so it may still finish (and bill) in the background.
 */

/** Exa search for a topic room. */
export const SEARCH_TIMEOUT_MS = 10_000
/**
 * The total time for ALL scrapes in one room, not per page: a topic room
 * that moves on to the next search result (shouldTryNextArticle) gives each
 * scrape only what's left, so the worst case above doesn't grow.
 */
export const SCRAPE_TIMEOUT_MS = 30_000
/** Don't start another page with less than this left of SCRAPE_TIMEOUT_MS. */
export const MIN_SCRAPE_MS = 10_000
export const GENERATE_TIMEOUT_MS = 60_000
export const STALE_GENERATING_MS = 180_000
