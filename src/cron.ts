/**
 * Cron task definitions — registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here.
 *
 * 'daily-quiz' runs every 15 minutes on New York time, starting at midnight.
 * Each run makes sure today's Quiz of the Day exists (src/server/daily.ts):
 * starts a generation if there is none, retries a failed or stuck one (up to
 * DAILY_MAX_ATTEMPTS), and otherwise does nothing. A day is its New York
 * date, so the quiz resets at 12:00 AM Eastern (EST or EDT).
 *
 * Local dev and test runs (ALLOW_DEBUG_ROUTES = "true", written to
 * .dev.vars by `deepspace dev`/`test`) skip generation, so they never call
 * the paid integrations; use the devSeedDailyQuiz action there instead.
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { dailyDay, nextDailyStep } from './lib/daily'
import { createActionTools } from './server/action-routes'
import { giveUpDaily, readData, startDailyAttempt, type DailyQuizData } from './server/daily'

export const tasks: CronTask[] = [{ name: 'daily-quiz', schedule: '*/15 * * * *', timezone: 'America/New_York' }]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name !== 'daily-quiz') return
  if (env.ALLOW_DEBUG_ROUTES === 'true') {
    console.info('[daily] local dev: skipping generation (use devSeedDailyQuiz)')
    return
  }
  // Acts as the app owner, like the job acts as the host.
  const tools = createActionTools(env, env.OWNER_USER_ID, '')
  const day = dailyDay(Date.now())
  const quiz = await readData<DailyQuizData>(tools, 'daily_quizzes', day)
  const step = nextDailyStep(quiz, Date.now())
  if (step === 'start') await startDailyAttempt(tools, env, day, (quiz?.attempts ?? 0) + 1)
  else if (step === 'giveUp') await giveUpDaily(tools, day)
}
