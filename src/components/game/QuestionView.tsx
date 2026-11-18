/**
 * An open question: prompt, countdown, and four answer buttons.
 *
 * Once the player has answered (their own submissions row exists, or the
 * submit just succeeded) the buttons become a static list with the pick
 * outlined, plus an "Answer locked in" line. The choices never disappear.
 * The server enforces one answer and the deadline; this view only reflects it.
 */

import { useState } from 'react'
import { cn } from '@/components/ui'
import { callAction } from '@/lib/call-action'
import { ChoiceList } from './ChoiceList'
import type { Question, Room, Submission } from './types'

type Props = {
  room: Room
  questionId: string
  question: Question
  mySubmission: Submission | undefined
  playerCount: number
  secondsLeft: number
  isHost: boolean
  ready: boolean
}

export function QuestionView({
  room,
  questionId,
  question,
  mySubmission,
  playerCount,
  secondsLeft,
  isHost,
  ready,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  // The choice just clicked. Set before the submit call, so the pick shows as
  // locked at once (no dimmed "waiting" buttons), and kept until our
  // submissions row syncs in. If the server rejects the answer it is cleared
  // and the buttons come back with the error. Display only: the server alone
  // decides whether the answer counts. (The page renders this view with
  // key={questionId}, so this state starts empty for every question.)
  const [justSubmitted, setJustSubmitted] = useState<number | undefined>(undefined)

  const lockedChoice = mySubmission?.choiceIndex ?? justSubmitted
  const timeUp = secondsLeft === 0

  async function handleChoose(choiceIndex: number) {
    setJustSubmitted(choiceIndex)
    setError(null)
    const result = await callAction('submitAnswer', { questionId, choiceIndex })
    if (!result.success) {
      setJustSubmitted(undefined)
      setError(result.error)
    }
  }

  return (
    // animate-enter runs once per mount: the page renders this view with
    // key={questionId}, so it plays when a new question opens, not when
    // answeredCount or the locked-in state re-render it.
    <div className="animate-enter space-y-6">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="font-display text-xs font-bold tracking-widest">Question {question.index + 1}</span>
        <span
          data-testid="countdown"
          className={cn(
            'font-mono text-2xl font-bold transition-tone',
            secondsLeft <= 10 ? 'text-highlight' : 'text-foreground',
          )}
        >
          {secondsLeft}s
        </span>
      </div>

      <h1 data-testid="question-prompt" className="font-sans text-2xl font-bold leading-snug">
        {question.prompt}
      </h1>

      {/* The choices stay on screen after answering: buttons while open, then
          a static list with the pick outlined (ChoiceList). */}
      <ChoiceList
        choices={question.choices}
        picked={lockedChoice}
        onChoose={(i) => void handleChoose(i)}
        disabled={!ready || timeUp}
      />

      {lockedChoice !== undefined && (
        <p data-testid="answer-locked" className="font-display text-xs font-bold tracking-widest text-primary">
          Answer locked in
        </p>
      )}
      {timeUp && <p className="text-sm text-muted-foreground">Time's up. Revealing…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {isHost && (
        <p data-testid="answered-count" className="text-sm text-muted-foreground">
          Answered {room.answeredCount ?? 0} of {playerCount}
        </p>
      )}
    </div>
  )
}
