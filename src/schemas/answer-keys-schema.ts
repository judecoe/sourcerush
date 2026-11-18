import type { CollectionSchema } from 'deepspace/schema'

/**
 * The answer to each question. Record id is `${roomId}:${index}`, the same
 * id as the matching `questions` row once it is opened.
 *
 * Server-only: `read: false` for every role, so no client can read it.
 * `false` is checked before ownership (server.js checkPermissionLevel), so
 * even the host, who is the row's creator, gets nothing.
 */
export const answerKeysSchema: CollectionSchema = {
  name: 'answerKeys',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'index', storage: 'number', interpretation: 'plain', required: true, immutable: true },
    { name: 'prompt', storage: 'text', interpretation: 'plain', required: true },
    // Array of 4 strings, already shuffled.
    { name: 'choices', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'correctIndex', storage: 'number', interpretation: 'plain', required: true },
    { name: 'passage', storage: 'text', interpretation: 'plain', required: true },
    { name: 'explanation', storage: 'text', interpretation: 'plain', required: true },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
