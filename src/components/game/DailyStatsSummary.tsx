/**
 * Today's average score, shown on the home card and on /daily before you
 * play. It starts at the day's baseline (2000–3000) and moves as players
 * finish (src/lib/daily.ts). Reads nothing itself.
 */

import type { DailyStats } from './types'

export function DailyStatsSummary({ stats }: { stats: DailyStats }) {
  return (
    <div data-testid="daily-stats">
      <p className="text-xs text-muted-foreground">Today's average score</p>
      <p data-testid="daily-average" className="font-mono text-2xl font-bold">
        {(stats.averageScore ?? 0).toLocaleString()}
      </p>
    </div>
  )
}
