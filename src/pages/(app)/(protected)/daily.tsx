/**
 * /daily: today's Quiz of the Day (resets at midnight New York time).
 *
 * Shows today's average (daily_stats, readable by every signed-in user)
 * and, depending on the caller's own daily_plays row (only theirs is
 * synced): a Play button, a Resume link to their room, or their result
 * against the average with the bell curve. One attempt per person per day (playDailyQuiz).
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutations, useQuery } from 'deepspace'
import { Button, buttonVariants } from '@/components/ui'
import { callAction } from '@/lib/call-action'
import { dailyDay } from '@/lib/daily'
import { DailyResult } from '@/components/game/DailyResult'
import { DailyStatsSummary } from '@/components/game/DailyStatsSummary'
import type { DailyPlay, DailyStats } from '@/components/game/types'

export default function DailyQuizPage() {
  const navigate = useNavigate()
  const { ready } = useMutations('rooms')
  const day = dailyDay(Date.now())
  const statsQuery = useQuery<DailyStats>('daily_stats', { where: { day }, limit: 1 })
  const playQuery = useQuery<DailyPlay>('daily_plays', { where: { day }, limit: 1 })
  const stats = statsQuery.records[0]?.data
  const play = playQuery.records[0]?.data
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePlay() {
    setBusy(true)
    setError(null)
    const result = await callAction<{ roomId: string }>('playDailyQuiz')
    if (result.success) {
      navigate(`/room/${result.data.roomId}`)
    } else {
      setError(result.error)
      setBusy(false)
    }
  }

  let body
  if (statsQuery.status === 'loading' || playQuery.status === 'loading') {
    body = <p className="text-muted-foreground">Loading…</p>
  } else if (play?.status === 'finished') {
    body = <DailyResult day={day} />
  } else if (play) {
    body = (
      <Link data-testid="daily-resume" to={`/room/${play.roomId}`} className={buttonVariants({ className: 'w-full' })}>
        Resume today's quiz
      </Link>
    )
  } else if (stats?.status === 'ready') {
    body = (
      <div className="space-y-6">
        <DailyStatsSummary stats={stats} />
        <div>
          <Button data-testid="daily-play" onClick={() => void handlePlay()} disabled={!ready || busy} className="w-full">
            {busy ? 'Starting…' : 'Play'}
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            {stats.questionCount ?? 0} questions, 60 seconds each. One attempt per day.
          </p>
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    )
  } else if (stats?.status === 'unavailable') {
    body = (
      <p data-testid="daily-unavailable" className="text-muted-foreground">
        There's no quiz today. Come back tomorrow, or try the sample game from Home.
      </p>
    )
  } else {
    body = (
      <p data-testid="daily-preparing" className="text-muted-foreground">
        Today's quiz is being prepared. This page updates by itself when it's ready.
      </p>
    )
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-md px-4 py-12">
        <p className="font-display text-xs font-bold uppercase tracking-widest text-primary">Quiz of the Day</p>
        <h1 className="mb-2 mt-1 text-3xl font-bold tracking-tight">
          {stats?.status === 'ready' ? stats.title || "Today's quiz" : "Today's quiz"}
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">A new quiz every day at midnight Eastern.</p>
        {body}
      </div>
    </div>
  )
}
