/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { roomsSchema } from './schemas/rooms-schema'
import { playersSchema } from './schemas/players-schema'
import { teamMembersSchema } from './schemas/team-members-schema'
import { questionsSchema } from './schemas/questions-schema'
import { answerKeysSchema } from './schemas/answer-keys-schema'
import { sourcesSchema } from './schemas/sources-schema'
import { submissionsSchema } from './schemas/submissions-schema'
import { revealLocksSchema } from './schemas/reveal-locks-schema'
import { roomQuotaSchema } from './schemas/room-quota-schema'
import { dailyQuizzesSchema } from './schemas/daily-quizzes-schema'
import { dailyStatsSchema } from './schemas/daily-stats-schema'
import { dailyPlaysSchema } from './schemas/daily-plays-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  roomsSchema,
  playersSchema,
  teamMembersSchema,
  questionsSchema,
  answerKeysSchema,
  sourcesSchema,
  submissionsSchema,
  revealLocksSchema,
  roomQuotaSchema,
  dailyQuizzesSchema,
  dailyStatsSchema,
  dailyPlaysSchema,
]
