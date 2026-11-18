/**
 * The room page while questions are being generated: a step list driven by
 * `rooms.generationStep` (written by the job just before each step, see
 * src/lib/generation-steps.ts) and the time since the room was created.
 *
 * Display only. The list updates live with the room record; the root's entry
 * animation runs once, on mount, not on each step change. An old room with no
 * (or an unknown) step shows a plain "Generating questions…".
 *
 * The writing row (`slow`) is one model request with nothing measurable
 * inside, so while it is current it shows a typical-duration hint and an
 * activity bar, not a percentage. `complete` (from the room page, for a
 * moment after the room reaches the lobby) ticks every row: "Quiz ready".
 */

import { stepRows, type StepRow } from '@/lib/generation-steps'
import { cn } from '@/components/ui'
import { useElapsedSeconds } from './hooks'

type Props = {
  generationStep: string | undefined
  createdAt: string | undefined
  complete?: boolean
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const STATE_TEXT: Record<StepRow['state'], string> = {
  done: 'done',
  current: 'in progress',
  todo: 'to do',
}

function StepIcon({ state }: { state: StepRow['state'] }) {
  if (state === 'done') {
    return (
      <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-success-foreground">
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  if (state === 'current') {
    return <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  }
  return <span aria-hidden className="h-5 w-5 rounded-full border-2 border-border" />
}

export function GeneratingStatus({ generationStep, createdAt, complete = false }: Props) {
  const rows = stepRows(generationStep, complete)
  const elapsed = useElapsedSeconds(createdAt, !complete)
  const current = rows?.find((r) => r.state === 'current')

  return (
    <div data-testid="generating" className="animate-enter space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{complete ? 'Quiz ready' : 'Setting up your quiz'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {complete
            ? 'Opening the lobby…'
            : 'This can take up to about two minutes. The page moves to the lobby by itself.'}
        </p>
      </div>

      {rows ? (
        <ol className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-card">
          {rows.map((row, i) => (
            <li
              key={i}
              data-testid="generating-step"
              data-state={row.state}
              aria-current={row.state === 'current' ? 'step' : undefined}
              className="flex items-start gap-3"
            >
              <StepIcon state={row.state} />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    'transition-tone',
                    row.state === 'current' ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {row.label}
                  {row.state === 'current' ? '…' : ''}
                  <span className="sr-only"> ({STATE_TEXT[row.state]})</span>
                </span>
                {row.slow && row.state === 'current' && (
                  <>
                    <p className="mt-1 text-xs text-muted-foreground">The longest part, usually 20–30 seconds.</p>
                    <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full w-2/5 animate-activity rounded-full bg-primary" />
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-border bg-card p-4 shadow-card">Generating questions…</p>
      )}

      {/* Screen readers hear each new step once, without re-reading the list. */}
      <p aria-live="polite" className="sr-only">
        {complete ? 'Quiz ready.' : current ? `${current.label}…` : ''}
      </p>

      <p className="font-mono text-sm text-muted-foreground">
        <span data-testid="generating-elapsed">{formatElapsed(elapsed)}</span> elapsed
      </p>
    </div>
  )
}
