import { describe, expect, it } from 'vitest'
import { QUESTION_DURATION_MS, scoreFor } from './scoring'

describe('scoreFor', () => {
  const endsAt = 1_000_000

  it('gives 0 for a wrong answer, however fast', () => {
    expect(scoreFor(false, endsAt - QUESTION_DURATION_MS, endsAt)).toBe(0)
  })

  it('gives 1000 for a correct answer at the very start', () => {
    expect(scoreFor(true, endsAt - QUESTION_DURATION_MS, endsAt)).toBe(1000)
  })

  it('gives 750 with half the time left', () => {
    expect(scoreFor(true, endsAt - QUESTION_DURATION_MS / 2, endsAt)).toBe(750)
  })

  it('gives 500 at the deadline, and clamps out-of-range times', () => {
    expect(scoreFor(true, endsAt, endsAt)).toBe(500)
    expect(scoreFor(true, endsAt + 5_000, endsAt)).toBe(500)
    expect(scoreFor(true, endsAt - 10 * QUESTION_DURATION_MS, endsAt)).toBe(1000)
  })

  it('rounds to a whole number', () => {
    // 500 * 1300 / 60000 = 10.83 -> 11 (rounds up)
    expect(scoreFor(true, endsAt - 1300, endsAt)).toBe(511)
  })
})
