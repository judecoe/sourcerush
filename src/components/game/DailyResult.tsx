/**
 * After finishing the Quiz of the Day: your score compared with the day's
 * average from just before you finished (your own score isn't in it), your
 * estimated "top X%" of players, and where you land on the bell curve. Used on the daily room's Game over
 * screen and on /daily.
 *
 * Reads the caller's own daily_plays row (only theirs is synced), where the
 * server saved that average, so the result never changes later. daily_stats
 * is read only for the question count (the curve's right end).
 */

import { useQuery } from 'deepspace'
import { MAX_POINTS_PER_QUESTION, topPercent } from '@/lib/daily'
import { BellCurve } from './BellCurve'
import type { DailyPlay, DailyStats } from './types'

export function DailyResult({ day }: { day: string }) {
  const playQuery = useQuery<DailyPlay>('daily_plays', { where: { day }, limit: 1 })
  const statsQuery = useQuery<DailyStats>('daily_stats', { where: { day }, limit: 1 })
  const play = playQuery.records[0]?.data
  const stats = statsQuery.records[0]?.data
  // Right after the last question the server is still saving the result.
  if (!play || play.status !== 'finished' || play.averageAtFinish === undefined || !stats) {
    return <p className="text-muted-foreground">Loading your result…</p>
  }

  const myScore = play.score ?? 0
  const average = play.averageAtFinish
  const diff = myScore - average
  const maxScore = (stats.questionCount ?? 0) * MAX_POINTS_PER_QUESTION
  const stdDev = play.stdDevAtFinish ?? 0
  // Estimated from the same average and spread the curve is drawn from, so
  // it matches where the You marker sits.
  const top = topPercent(myScore, average, stdDev, maxScore)

  return (
    <section data-testid="daily-result" className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Your score</p>
          <p data-testid="daily-my-score" className="font-mono text-3xl font-bold text-highlight">
            {myScore.toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Today's average</p>
          <p data-testid="daily-average-at-finish" className="font-mono text-xl font-bold">
            {average.toLocaleString()}
          </p>
        </div>
      </div>
      <p data-testid="daily-top-percent" className="font-display text-lg font-bold">
        Top {top}% of players
      </p>
      <p data-testid="daily-relative" className="text-sm text-muted-foreground">
        {diff === 0
          ? 'Right on the average.'
          : `${Math.abs(diff).toLocaleString()} points ${diff > 0 ? 'above' : 'below'} the average.`}
      </p>
      <BellCurve mean={average} stdDev={stdDev} maxScore={maxScore} myScore={myScore} />
    </section>
  )
}
