/**
 * Players sorted by score, highest first. players.score is the
 * authoritative total, written only by revealQuestion on the server.
 */

import type { RecordData } from 'deepspace'
import type { Player } from './types'

type Props = {
  players: RecordData<Player>[]
  userId: string | null
}

export function Leaderboard({ players, userId }: Props) {
  const sorted = [...players].sort((a, b) => (b.data.score ?? 0) - (a.data.score ?? 0))

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Leaderboard</h2>
      <ol data-testid="leaderboard" className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
        {sorted.map((p, i) => (
          <li key={p.recordId} data-testid="leaderboard-row" className="flex items-center gap-3 px-4 py-3">
            <span className="w-6 font-mono text-sm text-muted-foreground">{i + 1}</span>
            <span className="flex-1 truncate">
              {p.data.displayName}
              {p.data.userId === userId ? ' (you)' : ''}
            </span>
            <span data-testid="leaderboard-score" className="font-mono font-bold text-highlight">
              {p.data.score ?? 0}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
