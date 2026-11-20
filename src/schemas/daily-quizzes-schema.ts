import type { CollectionSchema } from 'deepspace/schema'

/**
 * Where today's Quiz of the Day comes from. Record id is the New York date
 * ('YYYY-MM-DD', dailyDay() in src/lib/daily.ts). Written by the cron task
 * and the generation job (src/server/daily.ts).
 *
 * `sourceRoomId` is the room whose answerKeys and sources hold the quiz;
 * playDailyQuiz copies them into each player's own room. Server-only, like
 * answerKeys: clients read the public summary in daily_stats instead.
 */
export const dailyQuizzesSchema: CollectionSchema = {
  name: 'daily_quizzes',
  columns: [
    { name: 'day', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['generating', 'ready', 'failed'] },
      required: true,
    },
    // Generation attempts started today (DAILY_MAX_ATTEMPTS at most).
    { name: 'attempts', storage: 'number', interpretation: 'plain', default: 0 },
    // Epoch ms when the current attempt started (server clock).
    { name: 'startedAt', storage: 'number', interpretation: 'plain', required: true },
    { name: 'sourceRoomId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'topic', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
