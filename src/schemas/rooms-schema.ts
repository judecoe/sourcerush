import type { CollectionSchema } from 'deepspace/schema'

/**
 * A game room. Only server actions write here; only room members can read.
 *
 * `roomId` holds this record's own id. It exists so the 'team' read rule
 * has a real column to compare against `team_members.teamId`. (The SDK's
 * `teamField: '_rowId'` shortcut works for queries but not for live
 * updates, so we don't use it.)
 */
export const roomsSchema: CollectionSchema = {
  name: 'rooms',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'code', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'hostId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['generating', 'lobby', 'question', 'reveal', 'finished'],
      },
      required: true,
    },
    { name: 'sourceTitle', storage: 'text', interpretation: 'plain' },
    // -1 means no question has been opened yet.
    { name: 'currentIndex', storage: 'number', interpretation: 'plain', default: -1 },
    // Epoch milliseconds, server clock. Empty until a question is open.
    { name: 'endsAt', storage: 'number', interpretation: 'plain' },
    { name: 'answeredCount', storage: 'number', interpretation: 'plain', default: 0 },
  ],
  uniqueOn: ['code'],
  teamField: 'roomId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'team', create: false, update: false, delete: false },
    member: { read: 'team', create: false, update: false, delete: false },
    admin: { read: 'team', create: false, update: false, delete: false },
  },
}
