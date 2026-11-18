import { describe, expect, it } from 'vitest'
import { GENERATION_STEP_VALUES, stepRows, stepValue } from './generation-steps'

const states = (value: unknown) => stepRows(value)?.map((r) => r.state)

describe('stepValue', () => {
  it('joins kind and step', () => {
    expect(stepValue('topic', 'searching')).toBe('topic:searching')
    expect(stepValue('link', 'rewriting')).toBe('link:rewriting')
  })
  it('never produces link:searching', () => {
    expect(stepValue('link', 'searching')).toBe('link:reading')
  })
  it('only produces values the schema allows', () => {
    for (const kind of ['topic', 'link'] as const) {
      for (const step of ['searching', 'reading', 'writing', 'rewriting', 'checking', 'saving'] as const) {
        expect(GENERATION_STEP_VALUES).toContain(stepValue(kind, step))
      }
    }
  })
})

describe('stepRows', () => {
  it('topic rooms list five steps and advance through them', () => {
    expect(stepRows('topic:searching')?.map((r) => r.label)).toEqual([
      'Finding an article',
      'Reading the article',
      'Writing questions',
      'Checking answers against the article',
      'Saving the quiz',
    ])
    expect(states('topic:searching')).toEqual(['current', 'todo', 'todo', 'todo', 'todo'])
    expect(states('topic:reading')).toEqual(['done', 'current', 'todo', 'todo', 'todo'])
    expect(states('topic:writing')).toEqual(['done', 'done', 'current', 'todo', 'todo'])
    expect(states('topic:checking')).toEqual(['done', 'done', 'done', 'current', 'todo'])
    expect(states('topic:saving')).toEqual(['done', 'done', 'done', 'done', 'current'])
  })

  it('link rooms have no search step', () => {
    expect(stepRows('link:reading')?.map((r) => r.label)).toEqual([
      'Reading the article',
      'Writing questions',
      'Checking answers against the article',
      'Saving the quiz',
    ])
    expect(states('link:checking')).toEqual(['done', 'done', 'current', 'todo'])
  })

  it('a second generation attempt makes writing current again, relabelled', () => {
    const rows = stepRows('topic:rewriting')!
    expect(rows.map((r) => r.state)).toEqual(['done', 'done', 'current', 'todo', 'todo'])
    expect(rows[2].label).toBe('Writing questions again (a second try)')
  })

  it('only the writing row is marked slow', () => {
    expect(stepRows('link:reading')!.map((r) => r.slow)).toEqual([false, true, false, false])
  })

  it('complete marks every row done', () => {
    expect(states(undefined)).toBeUndefined()
    expect(stepRows('topic:saving', true)!.map((r) => r.state)).toEqual(['done', 'done', 'done', 'done', 'done'])
  })

  it('returns null for missing or unknown values', () => {
    expect(stepRows(undefined)).toBeNull()
    expect(stepRows('')).toBeNull()
    expect(stepRows('link:searching')).toBeNull()
    expect(stepRows('topic:nonsense')).toBeNull()
  })
})
