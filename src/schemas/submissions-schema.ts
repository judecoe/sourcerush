import type { CollectionSchema } from 'deepspace/schema'

/**
 * One answer. Record id is `${questionId}:${userId}`. A player can read only
 * their own rows (`ownerField: 'userId'`); nobody else's, ever.
 *
 * Every column is immutable, and `attemptId` is a fresh random UUID on every
 * submitAnswer call. A second create for the same id therefore always
 * changes an immutable value, and the SDK rejects it inside one write
 * ("Cannot modify immutable field"). That is what enforces one submission
 * per player per question, even for concurrent calls.
 */
export const submissionsSchema: CollectionSchema = {
  name: 'submissions',
  columns: [
    { name: 'questionId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'choiceIndex', storage: 'number', interpretation: 'plain', required: true, immutable: true },
    // Epoch milliseconds, server clock.
    { name: 'submittedAt', storage: 'number', interpretation: 'plain', required: true, immutable: true },
    { name: 'attemptId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
  ],
  ownerField: 'userId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'own', create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
