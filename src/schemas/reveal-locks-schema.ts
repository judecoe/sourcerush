import type { CollectionSchema } from 'deepspace/schema'

/**
 * One row per revealed question; record id is the questionId. revealQuestion
 * creates it with a fresh random `attemptId` before scoring. Only the first
 * create succeeds (a second one changes the immutable `attemptId` and is
 * rejected), so only one call ever scores a question.
 *
 * Server-only.
 */
export const revealLocksSchema: CollectionSchema = {
  name: 'reveal_locks',
  columns: [
    { name: 'questionId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'attemptId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
