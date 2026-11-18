/**
 * "Return to your room" link, shown on /home, /create and /join when the
 * signed-in user is in a room that hasn't ended.
 *
 * The rooms query has no `where`: the server's 'team' read rule already
 * limits it to rooms the caller is a member of (or created). It can't
 * express "status not in (finished, failed)", so we filter here.
 *
 * Rooms created more than ACTIVE_ROOM_MAX_AGE_MS ago are ignored, so an
 * abandoned game stops showing the link. That's display only: the room
 * itself keeps its status.
 *
 * Once the query has loaded, a hidden `return-link-ready` marker is
 * rendered so tests can tell "no link" apart from "not loaded yet".
 *
 * Known edge: only the 20 newest rooms are fetched. If a user has 20 or more
 * newer rooms that have all ended, an older active room won't show here; its
 * URL and join code still work.
 */

import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { ACTIVE_ROOM_MAX_AGE_MS } from '@/lib/room-age'
import type { Room } from './types'

export function ReturnToRoomLink() {
  const rooms = useQuery<Room>('rooms', { orderBy: 'createdAt', orderDir: 'desc', limit: 20 })

  // Sort again on the client so live inserts can't change "most recent".
  // createdAt is an ISO timestamp, so string order is time order.
  const newestFirst = [...rooms.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const cutoff = Date.now() - ACTIVE_ROOM_MAX_AGE_MS
  const active = newestFirst.find(
    (r) =>
      r.data.status !== 'finished' &&
      r.data.status !== 'failed' &&
      new Date(r.createdAt).getTime() >= cutoff,
  )
  const readyMarker = rooms.status === 'ready' ? <span data-testid="return-link-ready" hidden /> : null
  if (!active) return readyMarker

  return (
    <>
      {readyMarker}
      <Link
        to={`/room/${active.data.roomId}`}
        data-testid="return-to-room"
        className="mb-8 flex items-center justify-between rounded-lg border-2 border-input bg-card px-4 py-3 text-sm shadow-card transition-tone hover:border-primary hover:bg-accent"
      >
        <span className="font-medium">Return to your room</span>
        <span className="font-mono font-bold tracking-widest text-highlight">{active.data.code}</span>
      </Link>
    </>
  )
}
