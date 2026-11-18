/**
 * /room/:roomId: the room lobby, with a live player list.
 *
 * Everything shown here comes from synced records, so a refresh rebuilds the
 * page. The server only sends rooms/players rows to members of this room. A
 * non-member's queries come back empty, and the page says so.
 */

import { useParams, Link } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'

type Room = {
  roomId: string
  code: string
  hostId: string
  status: string
}

type Player = {
  roomId: string
  userId: string
  displayName: string
  score: number
}

export default function RoomPage() {
  const { roomId = '' } = useParams()
  const { userId } = useAuth()

  const rooms = useQuery<Room>('rooms', { where: { roomId }, limit: 1 })
  const players = useQuery<Player>('players', {
    where: { roomId },
    orderBy: 'createdAt',
    orderDir: 'asc',
  })

  const room = rooms.records[0]?.data
  const loading = rooms.status === 'loading' || players.status === 'loading'
  const isHost = !!room && !!userId && room.hostId === userId

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-md px-6 py-20">
        {loading ? (
          <p className="text-muted-foreground">Loading room…</p>
        ) : room ? (
          <header className="mb-8">
            <p className="text-sm text-muted-foreground">Room code</p>
            <p data-testid="room-code" className="font-mono text-4xl font-bold tracking-widest">
              {room.code}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {isHost ? 'You are hosting. ' : ''}Status: {room.status}
            </p>
          </header>
        ) : (
          <div data-testid="not-member" className="mb-8 rounded-lg border border-border bg-card p-6">
            <p className="font-semibold">You're not in this room.</p>
            <Link to="/join" className="mt-2 inline-block text-sm underline underline-offset-4">
              Join with a code
            </Link>
          </div>
        )}

        {/* Rendered from whatever player rows arrive, even for a non-member,
            so a permissions leak would be visible here rather than hidden. */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            Players <span data-testid="player-count">{players.records.length}</span>
          </h2>
          {players.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">No players yet.</p>
          ) : (
            <ul data-testid="player-list" className="divide-y divide-border rounded-lg border border-border">
              {players.records.map((p) => (
                <li key={p.recordId} className="px-4 py-3">
                  {p.data.displayName}
                  {userId && p.data.userId === userId ? ' (you)' : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
