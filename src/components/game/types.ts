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
  currentIndex: number
  endsAt?: number
  answeredCount?: number
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
