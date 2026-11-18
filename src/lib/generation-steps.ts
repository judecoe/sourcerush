/**
 * Progress of question generation, shown on the room page while a room is
 * 'generating'. Pure: shared by the job (which writes `rooms.generationStep`)
 * and the room page (which turns it into a step list).
 *
 * The stored value is `${kind}:${step}`, so the page knows both where the
 * job is and whether a search step happened at all (topic rooms search;
 * link rooms start at reading). Values are this enum only: never the topic,
 * a URL or article text (rooms is readable by every room member).
 */

export type GenerationKind = 'topic' | 'link'
export type GenerationStep = 'searching' | 'reading' | 'writing' | 'rewriting' | 'checking' | 'saving'

/** Every value `rooms.generationStep` may hold (the schema's select options). */
export const GENERATION_STEP_VALUES = [
  'topic:searching',
  'topic:reading',
  'topic:writing',
  'topic:rewriting',
  'topic:checking',
  'topic:saving',
  'link:reading',
  'link:writing',
  'link:rewriting',
  'link:checking',
  'link:saving',
] as const

export type GenerationStepValue = (typeof GENERATION_STEP_VALUES)[number]

export function stepValue(kind: GenerationKind, step: GenerationStep): GenerationStepValue {
  // 'link:searching' never happens: a link room has nothing to search for.
  if (kind === 'link' && step === 'searching') return 'link:reading'
  return `${kind}:${step}` as GenerationStepValue
}

type RowStep = Exclude<GenerationStep, 'rewriting'>

const SHARED_ROWS: { step: RowStep; label: string }[] = [
  { step: 'reading', label: 'Reading the article' },
  { step: 'writing', label: 'Writing questions' },
  { step: 'checking', label: 'Checking answers against the article' },
  { step: 'saving', label: 'Saving the quiz' },
]

/** The rows the page lists, in order, for each kind. Rewriting is a variant of 'writing'. */
const ROWS: Record<GenerationKind, { step: RowStep; label: string }[]> = {
  topic: [{ step: 'searching', label: 'Finding an article' }, ...SHARED_ROWS],
  link: SHARED_ROWS,
}

/**
 * `slow` marks the writing row: one model request, most of the wait (real
 * runs: 19.6 s and 28.1 s, AGENT_LOG 2026-11-18), with nothing measurable
 * inside it, so the page shows a hint and an activity bar there instead of
 * made-up sub-steps.
 */
export type StepRow = { label: string; state: 'done' | 'current' | 'todo'; slow: boolean }

/**
 * The step list for a stored value, or null if the value is missing or not
 * one we know (the page then shows a plain "Generating questions…").
 * `complete` marks every row done (the brief "Quiz ready" moment).
 * 'rewriting' marks the writing row current with a "second try" label.
 */
export function stepRows(value: unknown, complete = false): StepRow[] | null {
  if (typeof value !== 'string' || !(GENERATION_STEP_VALUES as readonly string[]).includes(value)) return null
  const [kind, step] = value.split(':') as [GenerationKind, GenerationStep]
  const rows = ROWS[kind]
  const currentStep = step === 'rewriting' ? 'writing' : step
  const currentAt = rows.findIndex((r) => r.step === currentStep)
  return rows.map((row, i) => ({
    label: step === 'rewriting' && i === currentAt ? 'Writing questions again (a second try)' : row.label,
    state: complete || i < currentAt ? 'done' : i === currentAt ? 'current' : 'todo',
    slow: row.step === 'writing',
  }))
}
