/**
 * The four answer choices, drawn the same way on the question and reveal
 * screens so they never disappear between "answered" and "revealed".
 *
 * - Open (onChoose given, nothing picked): answer buttons `choice-0..3`.
 * - Locked (picked, no correctIndex yet): a static list, the pick outlined
 *   in primary. Not buttons, so nothing can be clicked twice.
 * - Revealed (correctIndex known): the pick pops and fades to green (right)
 *   or red (wrong); the correct answer, if not picked, fades to green.
 *
 * Every choice keeps the same box (border-2, padding, min height) in all
 * three states, so switching state never moves anything.
 */

import { Button, cn } from '@/components/ui'

type Props = {
  choices: string[]
  /** The caller's own answer, if any. */
  picked?: number
  /** Known only after the reveal. */
  correctIndex?: number
  /** Given only while the question is open. */
  onChoose?: (choiceIndex: number) => void
  disabled?: boolean
}

const BOX = 'min-h-16 w-full rounded-lg border-2 px-4 py-3 text-left font-sans text-base font-medium tracking-normal'

export function ChoiceList({ choices, picked, correctIndex, onChoose, disabled = false }: Props) {
  if (onChoose && picked === undefined) {
    return (
      <div className="grid gap-3">
        {choices.map((choice, i) => (
          <Button
            key={i}
            data-testid={`choice-${i}`}
            variant="outline"
            onClick={() => onChoose(i)}
            disabled={disabled}
            className={cn(BOX, 'h-auto justify-start whitespace-normal')}
          >
            {choice}
          </Button>
        ))}
      </div>
    )
  }

  const revealed = correctIndex !== undefined

  return (
    <ul className="grid gap-3">
      {choices.map((choice, i) => {
        const isPick = i === picked
        const isCorrect = revealed && i === correctIndex
        let tone: string
        if (!revealed) {
          tone = isPick ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground'
        } else if (isPick) {
          // The pick: pop + fade from primary into green or red.
          tone = cn(
            'animate-reveal-pick font-semibold text-foreground',
            isCorrect ? 'border-success bg-success/10' : 'border-destructive bg-destructive/10',
          )
        } else if (isCorrect) {
          // Correct answer the player didn't pick: fade to green, no pop.
          tone = 'animate-reveal-answer border-success bg-success/10 font-semibold text-foreground'
        } else {
          tone = 'border-border text-muted-foreground'
        }
        return (
          <li
            key={i}
            data-testid={isCorrect ? 'correct-choice' : undefined}
            className={cn(BOX, 'flex items-center', tone)}
          >
            <span>
              {/* locked-choice: the pick's text while waiting for the reveal (specs read it). */}
              <span data-testid={isPick && !revealed ? 'locked-choice' : undefined}>{choice}</span>
              {isPick ? ' (your answer)' : ''}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
