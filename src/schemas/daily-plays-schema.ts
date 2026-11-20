import type { CollectionSchema } from 'deepspace/schema'

/**
 * One person's Quiz of the Day attempt. Record id is `${day}:${userId}`.
 * Created by playDailyQuiz, finished by openQuestion.
 *
 * One attempt per person per day: `roomId` is immutable, so a second
 * playDailyQuiz (even a concurrent one) that made a different room is
 * rejected inside one write ("Cannot modify immutable field"), the same
 * trick submissions use. A user reads only their own rows.
 */
export const dailyPlaysSchema: CollectionSchema = {
  name: 'daily_plays',
  columns: [
    { name: 'day', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['playing', 'finished'] },
      required: true,
    },
    // Set when finished.
    { name: 'score', storage: 'number', interpretation: 'plain', default: 0 },
    // The day's average and spread just before this player finished (their
    // own score not included): what their result is compared with.
    { name: 'averageAtFinish', storage: 'number', interpretation: 'plain' },
    { name: 'stdDevAtFinish', storage: 'number', interpretation: 'plain' },
    { name: 'finishedAt', storage: 'number', interpretation: 'plain' },
  ],
  ownerField: 'userId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'own', create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
