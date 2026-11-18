import type { CollectionSchema } from 'deepspace/schema'

/**
 * The article a room's questions were generated from. Record id is the
 * roomId. Server-only: the full text contains every answer passage.
 */
export const sourcesSchema: CollectionSchema = {
  name: 'sources',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'fullText', storage: 'text', interpretation: 'plain', required: true },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
