/**
 * Game over: every question in the room, with the caller's answer, whether
 * it was right, and the correct answer.
 *
 * Reads only what this client could already see: the room's questions
 * (each one has `reveal` once the game is finished, because a room only
 * reaches 'finished' from 'reveal') and the caller's own submissions
 * (submissions are owner-read only, so other players' answers never come
 * back). No points per question: the server doesn't keep each question's
 * endsAt, and players.score on the leaderboard is the real total anyway.
 */

import { useQuery } from 'deepspace'
import { cn } from '@/lib/utils'
import type { Question, Submission } from './types'

export function GameSummary({ roomId }: { roomId: string }) {
  const questions = useQuery<Question>('questions', {
    where: { roomId },
    orderBy: 'index',
    orderDir: 'asc',
  })
  const sorted = [...questions.records].sort((a, b) => a.data.index - b.data.index)

  if (questions.status === 'loading') return null

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Your answers</h2>
      <ol data-testid="game-summary" className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
        {sorted.map((q) => (
          <SummaryRow key={q.recordId} questionId={q.recordId} question={q.data} />
        ))}
      </ol>
    </section>
  )
}

/**
 * One question. Queries its own submission: the SDK's `where` only matches
 * exact values, so this is how we get the caller's answer for exactly this
 * question (at most one row, see invariant 3).
 */
function SummaryRow({ questionId, question }: { questionId: string; question: Question }) {
  const submissions = useQuery<Submission>('submissions', { where: { questionId }, limit: 1 })
  const mine = submissions.records[0]?.data
  const reveal = question.reveal
  const loading = submissions.status === 'loading'

  let result: 'correct' | 'wrong' | 'none' = 'none'
  if (mine && reveal) result = mine.choiceIndex === reveal.correctIndex ? 'correct' : 'wrong'

  return (
    <li data-testid="summary-row" data-result={loading ? 'loading' : result} className="space-y-3 px-4 py-4">
      <div className="space-y-1">
        <p className="font-display text-xs font-bold tracking-widest text-muted-foreground">
          Question {question.index + 1}
        </p>
        <p className="font-medium leading-snug">{question.prompt}</p>
      </div>
      {!loading && (
        <ul className="grid gap-2">
          {/* Your pick: green border if right, red if wrong. */}
          {mine && (
            <AnswerBox
              testId="summary-pick"
              caption={result === 'correct' ? 'Your answer · correct' : 'Your answer · wrong'}
              text={question.choices[mine.choiceIndex]}
              border={result === 'correct' ? 'border-success' : 'border-destructive'}
            />
          )}
          {!mine && <AnswerBox testId="summary-pick" caption="Your answer" text="No answer" border="border-border" />}
          {/* The correct answer, unless your pick already shows it. */}
          {reveal && result !== 'correct' && (
            <AnswerBox
              testId="summary-correct"
              caption="Correct answer"
              text={question.choices[reveal.correctIndex]}
              border="border-success"
            />
          )}
        </ul>
      )}
    </li>
  )
}

/**
 * One answer in a box, the same box shape as the choices on the question
 * screen. Only the border is coloured; the text stays the normal colour.
 */
function AnswerBox({ testId, caption, text, border }: { testId: string; caption: string; text: string; border: string }) {
  return (
    <li data-testid={testId} className={cn('rounded-lg border-2 px-4 py-3', border)}>
      <span className="block font-display text-xs font-bold tracking-widest text-muted-foreground">{caption}</span>
      <span className="block font-medium text-foreground">{text}</span>
    </li>
  )
}
