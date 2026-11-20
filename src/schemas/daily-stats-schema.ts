import type { CollectionSchema } from 'deepspace/schema'

/**
 * The public face of one day's Quiz of the Day: shown on /home and /daily.
 * Record id is the New York date. Written only by the server: when
 * generation starts/ends (src/server/daily.ts) and, recomputed from every
 * finished play, each time someone finishes (openQuestion).
 *
 * Readable by every signed-in user. Only the day's average and spread: no
 * question, no answer, no individual score, no names, no player count. The
 * average starts at the day's baseline (2000–3000, weighted as 5 scores,
 * src/lib/daily.ts) and moves as players finish.
 */
export const dailyStatsSchema: CollectionSchema = {
  name: 'daily_stats',
  columns: [
    { name: 'day', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    // 'preparing' while generating, 'ready' to play, 'unavailable' once
    // every attempt failed ("no quiz today").
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['preparing', 'ready', 'unavailable'] },
      required: true,
    },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'questionCount', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'averageScore', storage: 'number', interpretation: 'plain', default: 0 },
    // Spread of the scores (baseline included), for the bell curve.
    { name: 'stdDev', storage: 'number', interpretation: 'plain', default: 0 },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
