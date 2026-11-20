/**
 * Quiz of the Day card on /home: today's title and average, linking to /daily.
 * Must render inside the (app)/ provider boundary, for a signed-in user.
 */

import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { buttonVariants } from '@/components/ui'
import { dailyDay } from '@/lib/daily'
import { DailyStatsSummary } from './DailyStatsSummary'
import type { DailyStats } from './types'

export function DailyCard() {
  const day = dailyDay(Date.now())
  const statsQuery = useQuery<DailyStats>('daily_stats', { where: { day }, limit: 1 })
  const stats = statsQuery.records[0]?.data

  return (
    <section data-testid="daily-card" className="mb-8 space-y-4 rounded-lg border border-border bg-card p-5 shadow-card">
      <div>
        <p className="font-display text-xs font-bold uppercase tracking-widest text-primary">Quiz of the Day</p>
        <p className="mt-1 font-semibold">{stats?.status === 'ready' ? stats.title || "Today's quiz" : "Today's quiz"}</p>
      </div>
      {statsQuery.status === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : stats?.status === 'ready' ? (
        <DailyStatsSummary stats={stats} />
      ) : stats?.status === 'unavailable' ? (
        <p className="text-sm text-muted-foreground">There's no quiz today. Try the sample game below instead.</p>
      ) : (
        <p className="text-sm text-muted-foreground">Today's quiz is being prepared. Check back in a minute.</p>
      )}
      <Link to="/daily" className={buttonVariants({ className: 'w-full' })}>
        Play the quiz of the day
      </Link>
    </section>
  )
}
