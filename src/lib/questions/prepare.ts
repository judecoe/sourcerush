/**
 * The pure middle of the question pipeline: trim the source to the exact
 * `sourceUsed` the model saw, validate candidates against it, shuffle each
 * question's choices (choices only: the questions keep the model's order).
 * No SDK or integration calls, so it is unit tested.
 */

import { QUESTIONS_MIN_USABLE, trimSource, type PromptInput } from './prompt'
import { shuffleChoices, validateQuestions, type Question, type Rejection } from './validate'

export type PrepareResult =
  | { ok: true; questions: Question[]; rejected: Rejection[] }
  | { ok: false; error: string; rejected: Rejection[] }

export function prepareQuestions(
  source: PromptInput,
  candidates: unknown[],
  random: () => number = Math.random,
): PrepareResult {
  const sourceUsed = trimSource(source.text)
  const { valid, rejected } = validateQuestions(candidates, sourceUsed)
  if (valid.length < QUESTIONS_MIN_USABLE) {
    return {
      ok: false,
      error: `Only ${valid.length} of ${candidates.length} questions passed validation (need ${QUESTIONS_MIN_USABLE}).`,
      rejected,
    }
  }
  return { ok: true, questions: valid.map((q) => shuffleChoices(q, random)), rejected }
}
