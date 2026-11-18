/**
 * How long a room counts as "current" for its members. Pure, shared by the
 * client (ReturnToRoomLink) and the server (createRoom / joinRoom).
 *
 * Why memberships are retired: the SDK's 'team' read rule binds one SQL
 * parameter per active team_members row of the caller
 * (`"roomId" IN (?, ?, …)` in executeTableQuery), and Durable Object SQLite
 * allows 100 per statement. A user with ~97 active memberships can no longer
 * load the room page ("too many SQL variables"). So createRoom and joinRoom
 * set status 'left' on the caller's memberships older than
 * ACTIVE_ROOM_MAX_AGE_MS, which keeps the list to the rooms of the last
 * couple of hours. A game lasts minutes, so those rooms are over.
 */

/** Rooms (and memberships) older than this are treated as over. */
export const ACTIVE_ROOM_MAX_AGE_MS = 2 * 60 * 60 * 1000

/**
 * Most memberships retired per call: bounds the server writes (each is a
 * subrequest). A user with a long backlog is drained over a few calls.
 */
export const RETIRE_BATCH = 40

type Membership = { recordId: string; createdAt: string }

/**
 * The memberships to retire now: created before `now - ACTIVE_ROOM_MAX_AGE_MS`,
 * oldest first, at most RETIRE_BATCH. Rows with an unreadable createdAt are
 * kept (never retire on bad data).
 */
export function membershipsToRetire<T extends Membership>(memberships: T[], now: number): T[] {
  const cutoff = now - ACTIVE_ROOM_MAX_AGE_MS
  return memberships
    .map((m) => ({ m, at: Date.parse(m.createdAt) }))
    .filter(({ at }) => Number.isFinite(at) && at < cutoff)
    .sort((a, b) => a.at - b.at)
    .slice(0, RETIRE_BATCH)
    .map(({ m }) => m)
}
