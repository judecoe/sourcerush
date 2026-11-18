import { describe, expect, it } from 'vitest'
import { BROKEN_FIXTURE_CANDIDATES, FIXTURE_CANDIDATES, FIXTURE_SOURCE } from './fixtures'
import { prepareQuestions } from './prepare'
import { buildQuestionPrompt } from './prompt'
import { validateQuestions, type Question } from './validate'

describe('fixtures', () => {
  it('all 8 candidates validate against sourceUsed', () => {
    const { sourceUsed } = buildQuestionPrompt(FIXTURE_SOURCE)
    const { valid, rejected } = validateQuestions(FIXTURE_CANDIDATES, sourceUsed)
    expect(rejected).toEqual([])
    expect(valid).toHaveLength(8)
  })

  it('prepareQuestions keeps the correct answer text after shuffling', () => {
    const result = prepareQuestions(FIXTURE_SOURCE, FIXTURE_CANDIDATES)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions).toHaveLength(8)
    result.questions.forEach((q, i) => {
      const original = FIXTURE_CANDIDATES[i] as Question
      expect(q.choices[q.correctIndex]).toBe(original.choices[original.correctIndex])
    })
  })

  it('the broken set fails with a reason for every question', () => {
    const result = prepareQuestions(FIXTURE_SOURCE, BROKEN_FIXTURE_CANDIDATES)
    expect(result.ok).toBe(false)
    expect(result.rejected).toHaveLength(8)
    expect(result.rejected[0].reasons).toContain('passage not found in source')
  })
})
