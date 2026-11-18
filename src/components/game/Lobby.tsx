/**
 * Lobby: the code to share and a live list of who has joined.
 * The host also gets the Start button.
 */

import type { RecordData } from 'deepspace'
import { OpenQuestionButton } from './OpenQuestionButton'
import type { Player, Room } from './types'

type Props = {
  room: Room
  players: RecordData<Player>[]
  userId: string | null
  isHost: boolean
  ready: boolean
}

export function Lobby({ room, players, userId, isHost, ready }: Props) {
  return (
    <div className="animate-enter space-y-8">
      <header>
        <p className="font-display text-xs font-bold tracking-widest text-muted-foreground">Room code</p>
        <p data-testid="room-code" className="font-mono text-4xl font-bold tracking-widest text-highlight">
          {room.code}
        </p>
        {/* Title only, no link: a link here invites opening the article during
            rounds. The link (SourceLink) is on the Game over screen. */}
        {room.sourceTitle && (
          <p className="mt-2 text-sm text-muted-foreground">Article: {room.sourceTitle}</p>
        )}
      </header>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Players <span data-testid="player-count">{players.length}</span>
        </h2>
        <ul data-testid="player-list" className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
          {players.map((p) => (
            <li key={p.recordId} className="px-4 py-3">
              {p.data.displayName}
              {p.data.userId === userId ? ' (you)' : ''}
            </li>
          ))}
        </ul>
      </section>

      {isHost ? (
        <OpenQuestionButton roomId={room.roomId} ready={ready} label="Start" />
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for the host to start…</p>
      )}
    </div>
  )
}
