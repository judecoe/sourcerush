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
  // The room can switch to 'reveal' a moment before the question's reveal syncs.
  if (!reveal) return <p className="text-muted-foreground">Revealing…</p>

  const correct = mySubmission?.choiceIndex === reveal.correctIndex
  const points =
    mySubmission && room.endsAt !== undefined ? scoreFor(correct, mySubmission.submittedAt, room.endsAt) : 0

  let result: string
  if (!mySubmission) result = 'No answer'
  else if (correct) result = `Correct! +${points}`
  else result = 'Not quite. +0'

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Question {question.index + 1}</p>
      <h1 className="text-xl font-bold leading-snug">{question.prompt}</h1>

      <ul className="grid gap-2">
        {question.choices.map((choice, i) => (
          <li
            key={i}
            data-testid={i === reveal.correctIndex ? 'correct-choice' : undefined}
            className={cn(
              'rounded-lg border px-4 py-3',
              i === reveal.correctIndex
                ? 'border-green-600 bg-green-600/10 font-semibold'
                : 'border-border text-muted-foreground',
            )}
          >
            {choice}
            {i === mySubmission?.choiceIndex ? ' (your answer)' : ''}
          </li>
        ))}
      </ul>

      <p data-testid="my-result" className="text-lg font-semibold">
        {result}
      </p>

      <figure className="rounded-lg border-l-4 border-primary bg-card p-4">
        <figcaption className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
