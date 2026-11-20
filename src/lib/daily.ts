import { DAILY_TOPICS } from './daily-topics'

export { DAILY_TOPICS }

/**
 * Pure helpers for the Quiz of the Day. No SDK calls here, so the unit
 * tests stay fast. Used by the server (cron, actions) and the client
 * (/daily, the home card, the result graph).
 */

/**
 * The quiz resets at midnight New York time: EST in winter, EDT in summer
 * (Intl handles the switch).
 */
export const DAILY_TIME_ZONE = 'America/New_York'

/** Generation attempts per day before giving up ("no quiz today"). */
export const DAILY_MAX_ATTEMPTS = 3

/**
 * A generation still 'generating' after this long is treated as failed (the
 * job's worst case is ~160 s, see generation-timing.ts).
 */
export const DAILY_STALE_MS = 10 * 60 * 1000

/** Highest score one question can give (scoring.ts: 500 + up to 500). */
export const MAX_POINTS_PER_QUESTION = 1000

/**
 * The first day of the topic rotation: on this New York date the quiz uses
 * DAILY_TOPICS[0], the next day [1], and so on; after the last topic it
 * starts again from the first.
 */
export const DAILY_ROTATION_START = '2026-11-19'


/** Today's date in New York as 'YYYY-MM-DD'. This is the quiz's id. */
export function dailyDay(nowMs: number): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs))
}

/**
 * The topic for a day's nth attempt (1-based): days walk through
 * DAILY_TOPICS in order from DAILY_ROTATION_START and wrap around at the end.
 * A retry moves on to the next topic, since the last one failed (it is the
 * same topic the next day will use).
 */
export function topicForDay(day: string, attempt: number): string {
  const daysSinceStart = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${DAILY_ROTATION_START}T00:00:00Z`)) / 86_400_000)
  const n = DAILY_TOPICS.length
  // ((x % n) + n) % n keeps the index in range for days before the start too.
  const index = (((daysSinceStart + attempt - 1) % n) + n) % n
  return DAILY_TOPICS[index]
}

export type DailyQuizState = { status: 'generating' | 'ready' | 'failed'; attempts: number; startedAt: number }

/**
 * What the cron should do about today's quiz:
 * - 'start': begin a (new) generation attempt,
 * - 'wait': one is running,
 * - 'done': the quiz is ready,
 * - 'giveUp': out of attempts; show "no quiz today".
 */
export function nextDailyStep(quiz: DailyQuizState | null, nowMs: number): 'start' | 'wait' | 'done' | 'giveUp' {
  if (!quiz) return 'start'
  if (quiz.status === 'ready') return 'done'
  const stale = quiz.status === 'generating' && nowMs - quiz.startedAt > DAILY_STALE_MS
  if (quiz.status === 'generating' && !stale) return 'wait'
  return quiz.attempts < DAILY_MAX_ATTEMPTS ? 'start' : 'giveUp'
}

/** The range of each day's starting (baseline) average. */
export const BASELINE_MIN = 2000
export const BASELINE_MAX = 3000

/**
 * The day's baseline average: a number from BASELINE_MIN to BASELINE_MAX
 * that looks random from day to day but is fixed for a given day (a hash of
 * the date), so every server call and retry agrees on it without storing it.
 * It counts as BASELINE_WEIGHT scores in the day's average.
 */
export function baselineAverage(day: string): number {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5
  for (let i = 0; i < day.length; i++) {
    hash ^= day.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return BASELINE_MIN + (hash % (BASELINE_MAX - BASELINE_MIN + 1))
}

/**
 * How many scores the baseline counts as in the day's average. At 5, a day
 * starting at 2000 moves to about 2333 after one player scores 4000.
 */
export const BASELINE_WEIGHT = 5

export type DailyAverage = {
  /** Average of the baseline and every score, rounded. */
  averageScore: number
  /** Population standard deviation of the same numbers, rounded (for the curve). */
  stdDev: number
}

/**
 * The day's average: the baseline counts as BASELINE_WEIGHT scores, plus
 * every real score. E.g. baseline 2000 and one player on 4000 →
 * (5 × 2000 + 4000) / 6 ≈ 2333. With no scores it's just the baseline
 * (spread 0).
 */
export function dailyAverage(baseline: number, scores: number[]): DailyAverage {
  const all = [...Array<number>(BASELINE_WEIGHT).fill(baseline), ...scores]
  const mean = all.reduce((a, b) => a + b, 0) / all.length
  const variance = all.reduce((a, s) => a + (s - mean) ** 2, 0) / all.length
  return { averageScore: Math.round(mean), stdDev: Math.round(Math.sqrt(variance)) }
}

/** The Quiz of the Day always has exactly this many questions. */
export const DAILY_QUESTION_COUNT = 8

/**
 * `count` items spread evenly from first to last, keeping their order.
 * Questions arrive easiest first, so this keeps the difficulty ramp (always
 * the first and the last). Fewer items than `count` come back unchanged.
 */
export function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items]
  if (count <= 1) return items.slice(0, count)
  const picked: T[] = []
  for (let i = 0; i < count; i++) picked.push(items[Math.round((i * (items.length - 1)) / (count - 1))])
  return picked
}

/**
 * The narrowest the bell curve gets, as a share of the score range. Early in
 * the day (few players) the real spread is small or 0; this keeps the curve
 * wide and gradual. The same spread is used for "top X%", so the number
 * matches where the You marker sits on the curve.
 */
export const CURVE_MIN_SPREAD = 0.18

/** The spread the curve (and "top X%") uses: the real one, or the minimum. */
function curveSpread(stdDev: number, maxScore: number): number {
  return Math.max(stdDev, maxScore * CURVE_MIN_SPREAD, 1)
}

/**
 * Points of a bell (normal) curve with this mean and spread, from 0 to
 * `maxScore`, with y scaled so the peak is 1.
 */
export function bellCurvePoints(
  mean: number,
  stdDev: number,
  maxScore: number,
  steps = 120,
): { x: number; y: number }[] {
  const sd = curveSpread(stdDev, maxScore)
  const points: { x: number; y: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const x = (maxScore * i) / steps
    points.push({ x, y: Math.exp(-((x - mean) ** 2) / (2 * sd * sd)) })
  }
  return points
}

/**
 * "Top X% of players": the share of the curve at or above this score, from
 * 1 to 99 (never "top 0%" or "top 100%"). An estimate from the average and
 * spread the player was compared with, since clients never see other
 * players' scores.
 */
export function topPercent(score: number, mean: number, stdDev: number, maxScore: number): number {
  const below = normalCdf((score - mean) / curveSpread(stdDev, maxScore))
  return Math.min(99, Math.max(1, Math.round((1 - below) * 100)))
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation, error < 1.5e-7). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2))
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}
