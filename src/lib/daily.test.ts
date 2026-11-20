import { describe, expect, it } from 'vitest'
import {
  BASELINE_MAX,
  BASELINE_MIN,
  BASELINE_WEIGHT,
  baselineAverage,
  bellCurvePoints,
  DAILY_MAX_ATTEMPTS,
  DAILY_ROTATION_START,
  DAILY_STALE_MS,
  DAILY_TOPICS,
  dailyDay,
  dailyAverage,
  nextDailyStep,
  topicForDay,
} from './daily'

describe('dailyDay', () => {
  it('rolls over at New York midnight in winter (EST, UTC-5)', () => {
    expect(dailyDay(Date.parse('2026-11-19T04:59:59Z'))).toBe('2026-11-18')
    expect(dailyDay(Date.parse('2026-11-19T05:00:00Z'))).toBe('2026-11-19')
  })
  it('rolls over at New York midnight in summer (EDT, UTC-4)', () => {
    expect(dailyDay(Date.parse('2026-07-04T03:59:59Z'))).toBe('2026-07-03')
    expect(dailyDay(Date.parse('2026-07-04T04:00:00Z'))).toBe('2026-07-04')
  })
})

describe('DAILY_TOPICS', () => {
  it('has 180 distinct, non-empty topics', () => {
    expect(DAILY_TOPICS).toHaveLength(180)
    expect(new Set(DAILY_TOPICS.map((t) => t.toLowerCase())).size).toBe(180)
    for (const t of DAILY_TOPICS) expect(t.trim().length).toBeGreaterThan(3)
  })
})

describe('topicForDay', () => {
  const plus = (days: number) => new Date(Date.parse(`${DAILY_ROTATION_START}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  it('starts at the first topic and goes in order', () => {
    expect(topicForDay(DAILY_ROTATION_START, 1)).toBe(DAILY_TOPICS[0])
    expect(topicForDay(plus(1), 1)).toBe(DAILY_TOPICS[1])
    expect(topicForDay(plus(179), 1)).toBe(DAILY_TOPICS[179])
  })
  it('goes back to the first topic after the last, and keeps rotating', () => {
    expect(topicForDay(plus(180), 1)).toBe(DAILY_TOPICS[0])
    expect(topicForDay(plus(361), 1)).toBe(DAILY_TOPICS[1])
  })
  it('a retry uses the next topic', () => {
    expect(topicForDay(DAILY_ROTATION_START, 2)).toBe(DAILY_TOPICS[1])
    expect(topicForDay(plus(179), 2)).toBe(DAILY_TOPICS[0])
  })
  it('stays in range across DST changes and before the start date', () => {
    expect(topicForDay('2027-03-15', 1)).toBe(DAILY_TOPICS[116])
    expect(DAILY_TOPICS).toContain(topicForDay('2026-01-01', 1))
  })
})

describe('nextDailyStep', () => {
  const now = 1_000_000_000
  it('starts when there is no quiz yet', () => {
    expect(nextDailyStep(null, now)).toBe('start')
  })
  it('is done once ready', () => {
    expect(nextDailyStep({ status: 'ready', attempts: 1, startedAt: now }, now)).toBe('done')
  })
  it('waits on a fresh generation and retries a stale one', () => {
    expect(nextDailyStep({ status: 'generating', attempts: 1, startedAt: now - 1000 }, now)).toBe('wait')
    expect(nextDailyStep({ status: 'generating', attempts: 1, startedAt: now - DAILY_STALE_MS - 1 }, now)).toBe('start')
  })
  it('retries a failure until out of attempts, then gives up', () => {
    expect(nextDailyStep({ status: 'failed', attempts: DAILY_MAX_ATTEMPTS - 1, startedAt: now }, now)).toBe('start')
    expect(nextDailyStep({ status: 'failed', attempts: DAILY_MAX_ATTEMPTS, startedAt: now }, now)).toBe('giveUp')
    expect(
      nextDailyStep({ status: 'generating', attempts: DAILY_MAX_ATTEMPTS, startedAt: now - DAILY_STALE_MS - 1 }, now),
    ).toBe('giveUp')
  })
})

describe('baselineAverage', () => {
  it('stays within 2000–3000 and is fixed for a day', () => {
    for (let d = 1; d <= 31; d++) {
      const day = `2026-12-${String(d).padStart(2, '0')}`
      const b = baselineAverage(day)
      expect(Number.isInteger(b)).toBe(true)
      expect(b).toBeGreaterThanOrEqual(BASELINE_MIN)
      expect(b).toBeLessThanOrEqual(BASELINE_MAX)
      expect(baselineAverage(day)).toBe(b)
    }
  })
  it('changes from day to day', () => {
    const values = new Set(Array.from({ length: 30 }, (_, d) => baselineAverage(`2026-11-${String(d + 1).padStart(2, '0')}`)))
    expect(values.size).toBeGreaterThan(20)
  })
})

describe('dailyAverage', () => {
  it('is the baseline alone with no scores', () => {
    expect(dailyAverage(2437, [])).toEqual({ averageScore: 2437, stdDev: 0 })
  })
  it('weighs the baseline as 5 scores: 2000 then a 4000 gives 2333', () => {
    expect(BASELINE_WEIGHT).toBe(5)
    expect(dailyAverage(2000, [4000]).averageScore).toBe(2333)
  })
  it('moves toward real scores as more people play', () => {
    expect(dailyAverage(2000, [4000, 4000, 4000, 4000, 4000]).averageScore).toBe(3000)
    expect(dailyAverage(2000, [4000, 4000, 4000, 4000, 4000]).stdDev).toBe(1000)
  })
})

describe('bellCurvePoints', () => {
  it('peaks at 1 at the mean and spans 0..max', () => {
    const pts = bellCurvePoints(5000, 1000, 10000, 10)
    expect(pts).toHaveLength(11)
    expect(pts[0].x).toBe(0)
    expect(pts[10].x).toBe(10000)
    expect(pts[5].y).toBeCloseTo(1)
    expect(pts[4].y).toBeCloseTo(pts[6].y)
  })
  it('keeps a visible curve when everyone has the same score', () => {
    const pts = bellCurvePoints(5000, 0, 10000, 10)
    expect(pts[4].y).toBeGreaterThan(0.01)
  })
})
