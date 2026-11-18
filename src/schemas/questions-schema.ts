import type { CollectionSchema } from 'deepspace/schema'

/**
 * A question as players see it. Record id is `${roomId}:${index}`. Created
 * only when the host opens it, so future questions don't exist yet.
 *
 * Holds NO answer data until reveal. `reveal` is empty until
 * revealQuestion merges in `{ correctIndex, passage, explanation }`.
 */
export const questionsSchema: CollectionSchema = {
  name: 'questions',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'index', storage: 'number', interpretation: 'plain', required: true, immutable: true },
    { name: 'prompt', storage: 'text', interpretation: 'plain', required: true },
    // Array of 4 strings.
    { name: 'choices', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'reveal', storage: 'text', interpretation: { kind: 'json' } },
  ],
  teamField: 'roomId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'team', create: false, update: false, delete: false },
    member: { read: 'team', create: false, update: false, delete: false },
    admin: { read: 'team', create: false, update: false, delete: false },
  },
}
