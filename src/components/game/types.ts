/**
 * Client-side shapes of the records the room page reads. Each one mirrors a
 * schema in src/schemas/. Only fields the UI uses are listed.
 */

export type RoomStatus = 'generating' | 'lobby' | 'question' | 'reveal' | 'finished' | 'failed'

export type Room = {
  roomId: string
  code: string
  hostId: string
  status: RoomStatus
  errorMessage?: string
  sourceTitle?: string
  sourceUrl?: string
  currentIndex: number
  endsAt?: number
  answeredCount?: number
  /** `${kind}:${step}` while generating (src/lib/generation-steps.ts). Display only. */
  generationStep?: string
  /** New York date on Quiz of the Day rooms; empty otherwise. */
  dailyDay?: string
}

/** Public summary of one day's Quiz of the Day (daily_stats). */
export type DailyStats = {
  day: string
  status: 'preparing' | 'ready' | 'unavailable'
  title?: string
  questionCount?: number
  averageScore?: number
  stdDev?: number
}

/** The caller's own attempt (daily_plays). Nobody else's is synced. */
export type DailyPlay = {
  day: string
  userId: string
  roomId: string
  status: 'playing' | 'finished'
  score?: number
  /** The day's average and spread just before this player finished. */
  averageAtFinish?: number
  stdDevAtFinish?: number
  finishedAt?: number
}

export type Player = {
  roomId: string
  userId: string
  displayName: string
  score?: number
}

/** Merged into a question by revealQuestion. Empty until then. */
export type Reveal = {
  correctIndex: number
  passage: string
  explanation: string
}

export type Question = {
  roomId: string
  index: number
  prompt: string
  choices: string[]
  reveal?: Reveal
}

/** The caller's own answer. Nobody else's is ever synced to this client. */
export type Submission = {
  questionId: string
  userId: string
  choiceIndex: number
  submittedAt: number
}
