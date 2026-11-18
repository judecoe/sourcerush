/**
 * After a question: the correct answer, the source passage it comes from,
 * the explanation, how this player did, and the leaderboard.
 *
 * Everything about the answer comes from question.reveal, which the server
 * writes only at reveal time. The points shown here are recomputed for
 * display; players.score (in the leaderboard) is the real total.
 */

import type { RecordData } from 'deepspace'
import { scoreFor } from '@/lib/scoring'
import { cn } from '@/lib/utils'
import { Leaderboard } from './Leaderboard'
import { ChoiceList } from './ChoiceList'
import { OpenQuestionButton } from './OpenQuestionButton'
import type { Player, Question, Room, Submission } from './types'

type Props = {
  room: Room
  question: Question
  mySubmission: Submission | undefined
  players: RecordData<Player>[]
  userId: string | null
  isHost: boolean
  ready: boolean
}

export function RevealView({ room, question, mySubmission, players, userId, isHost, ready }: Props) {
  const reveal = question.reveal

  // The top of this screen (header, prompt, choices) is drawn exactly like the
  // question screen, and the root has no entry animation, so going from
  // "answered" to "revealed" changes only the colours of the choices. The
  // room can switch to 'reveal' a moment before question.reveal syncs; until
  // then the choices stay as they were, with "Revealing…" below.
  const top = (
    <>
      <div className="flex min-h-8 items-center">
        <span className="font-display text-xs font-bold tracking-widest text-muted-foreground">
          Question {question.index + 1}
        </span>
      </div>
      <h1 className="font-sans text-2xl font-bold leading-snug">{question.prompt}</h1>
      <ChoiceList choices={question.choices} picked={mySubmission?.choiceIndex} correctIndex={reveal?.correctIndex} />
    </>
  )

  if (!reveal) {
    return (
      <div className="space-y-6">
        {top}
        <p className="text-sm text-muted-foreground">Revealing…</p>
      </div>
    )
  }

  const correct = mySubmission?.choiceIndex === reveal.correctIndex
  const points =
    mySubmission && room.endsAt !== undefined ? scoreFor(correct, mySubmission.submittedAt, room.endsAt) : 0

  let result: string
  if (!mySubmission) result = 'No answer'
  else if (correct) result = `Correct! +${points}`
  else result = 'Not quite. +0'

  return (
    <div className="space-y-6">
      {top}

      <p
        data-testid="my-result"
        className={cn(
          'text-lg font-semibold',
          !mySubmission ? 'text-muted-foreground' : correct ? 'text-success' : 'text-destructive',
        )}
      >
        {result}
      </p>

      <figure className="rounded-lg border-l-4 border-primary bg-card p-4 shadow-card">
        <figcaption className="mb-2 font-display text-xs font-bold uppercase tracking-widest text-muted-foreground">
          From the article{room.sourceTitle ? `: ${room.sourceTitle}` : ''}
        </figcaption>
        <blockquote data-testid="reveal-passage" className="text-lg leading-relaxed">
          “{reveal.passage}”
        </blockquote>
      </figure>

      <p data-testid="reveal-explanation" className="text-sm text-muted-foreground">
        {reveal.explanation}
      </p>

      <Leaderboard players={players} userId={userId} />

      {isHost && <OpenQuestionButton roomId={room.roomId} ready={ready} label="Next" />}
    </div>
  )
}
