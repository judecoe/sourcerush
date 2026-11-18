import type { CollectionSchema } from 'deepspace/schema'

/**
 * Room membership. The SDK's 'team' permission level looks up this exact
 * collection name and these exact columns (teamId, userId, status), so don't
 * rename them. Here a "team" is a game room: teamId = roomId.
 *
 * Record id is `${roomId}:${userId}`. Server-only: no client role can read
 * or write it. The permission engine reads it internally.
 */
export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    // 'active' (or empty) counts as a member.
    { name: 'status', storage: 'text', interpretation: 'plain', default: 'active' },
  ],
  uniqueOn: ['teamId', 'userId'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
