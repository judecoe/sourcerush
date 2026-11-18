/**
 * An open question: prompt, countdown, and four answer buttons.
 *
 * Once the player has answered (their own submissions row exists, or the
 * submit just succeeded) the buttons are replaced by "Answer locked in".
 * The server enforces one answer and the deadline; this view only reflects it.
 */

import { useState } from 'react'
import { Button } from '@/components/ui'
import { callAction } from '@/lib/call-action'
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The choice the submit returned, kept until our submissions row syncs in,
  // so the buttons can't reappear in between. (The page renders this view
  // with key={questionId}, so this state starts empty for every question.)
  const [justSubmitted, setJustSubmitted] = useState<number | undefined>(undefined)

  const lockedChoice = mySubmission?.choiceIndex ?? justSubmitted
  const timeUp = secondsLeft === 0

  async function handleChoose(choiceIndex: number) {
    setBusy(true)
    setError(null)
    const result = await callAction('submitAnswer', { questionId, choiceIndex })
    if (result.success) {
      setJustSubmitted(choiceIndex)
    } else {
      setError(result.error)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Question {question.index + 1}</span>
        <span data-testid="countdown" className="font-mono text-2xl font-bold text-foreground">
          {secondsLeft}s
        </span>
      </div>

      <h1 data-testid="question-prompt" className="text-2xl font-bold leading-snug">
        {question.prompt}
      </h1>

      {lockedChoice !== undefined ? (
        <div data-testid="answer-locked" className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Answer locked in</p>
          <p data-testid="locked-choice" className="mt-1 text-lg font-semibold">
            {question.choices[lockedChoice]}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {question.choices.map((choice, i) => (
            <Button
              key={i}
              data-testid={`choice-${i}`}
              variant="outline"
              onClick={() => handleChoose(i)}
              disabled={!ready || busy || timeUp}
              className="h-auto min-h-16 w-full justify-start whitespace-normal px-4 py-3 text-left text-base"
            >
              {choice}
            </Button>
          ))}
        </div>
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
