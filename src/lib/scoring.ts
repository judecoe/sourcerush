/**
 * Scoring rules. Pure, so they're unit tested and explainable on their own.
 * All times are server epoch milliseconds.
 */

/** How long a question stays open. */
export const QUESTION_DURATION_MS = 20_000

/**
 * Correct: 500 + round(500 * timeLeft / QUESTION_DURATION_MS).
 * Wrong or no answer: 0. timeLeft is clamped to [0, QUESTION_DURATION_MS].
 */
export function scoreFor(correct: boolean, submittedAt: number, endsAt: number): number {
  if (!correct) return 0
  const timeLeft = Math.min(QUESTION_DURATION_MS, Math.max(0, endsAt - submittedAt))
  return 500 + Math.round((500 * timeLeft) / QUESTION_DURATION_MS)
}
