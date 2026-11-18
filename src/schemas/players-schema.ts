import type { CollectionSchema } from 'deepspace/schema'

/**
 * One row per player in a room. Record id is `${roomId}:${userId}`.
 * Only server actions write here; only members of the same room can read.
 */
export const playersSchema: CollectionSchema = {
  name: 'players',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'displayName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'score', storage: 'number', interpretation: 'plain', default: 0 },
  ],
  uniqueOn: ['roomId', 'userId'],
  teamField: 'roomId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'team', create: false, update: false, delete: false },
    member: { read: 'team', create: false, update: false, delete: false },
    admin: { read: 'team', create: false, update: false, delete: false },
  },
}
