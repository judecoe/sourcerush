import type { CollectionSchema } from 'deepspace/schema'

/**
 * Per-user daily cap on rooms made from a link (each one spends owner
 * credits on Firecrawl + Anthropic). Record id is `${userId}:${day}:${slot}`,
 * with `day` a UTC date and `slot` 0 to ROOM_DAILY_LIMIT - 1.
 *
 * createRoom claims a slot by creating its row with a fresh random
 * `attemptId`. Every column is immutable, so creating a slot that already
 * exists changes `attemptId` and is rejected inside one write: two
 * concurrent calls can never claim the same slot (same trick as
 * reveal_locks and submissions).
 *
 * Server-only.
 */
export const roomQuotaSchema: CollectionSchema = {
  name: 'room_quota',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'day', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'slot', storage: 'number', interpretation: 'plain', required: true, immutable: true },
    { name: 'attemptId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
