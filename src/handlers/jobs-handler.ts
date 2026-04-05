import {
  hardPurgeDeleted,
  getDailySummary,
  getDueDailyReportTelegramIds,
  getDueWeeklyReportTelegramIds,
  getMealGapTelegramIds,
  getWeeklySummary,
  markReportSent,
  resetDailyAiCounters,
} from '../data/db.js';
import { sendReport, sendTelegramMessage } from '../services/telegram.js';
import { type Env } from '../types/index.js';

export async function runDailyReportJob(env: Env): Promise<{ sent: number }> {
  const telegramIds = await getDueDailyReportTelegramIds(env);
  let sent = 0;

  for (const telegramId of telegramIds) {
    const { lines, hasData } = await getDailySummary(env, telegramId);
    if (!hasData) {
      continue;
    }

    await sendReport(env, Number(telegramId), lines.join('\n'));
    await markReportSent(env, telegramId, 'daily');
    sent += 1;
  }

  return { sent };
}

export async function runWeeklyReportJob(env: Env): Promise<{ sent: number }> {
  const telegramIds = await getDueWeeklyReportTelegramIds(env);
  let sent = 0;

  for (const telegramId of telegramIds) {
    const { lines, hasData } = await getWeeklySummary(env, telegramId);
    if (!hasData) {
      continue;
    }

    await sendReport(env, Number(telegramId), lines.join('\n'));
    await markReportSent(env, telegramId, 'weekly');
    sent += 1;
  }

  return { sent };
}

export async function runMealGapJob(env: Env): Promise<{ sent: number }> {
  const telegramIds = await getMealGapTelegramIds(env, 6);
  let sent = 0;

  for (const telegramId of telegramIds) {
    await sendTelegramMessage(
      env,
      Number(telegramId),
      'Meal gap reminder: no food logs detected in the last 6 hours. Reply with what you ate to stay on track.',
    );
    await markReportSent(env, telegramId, 'meal_gap');
    sent += 1;
  }

  return { sent };
}

export async function runResetDailyAiJob(env: Env): Promise<{ resetUsers: number }> {
  const resetUsers = await resetDailyAiCounters(env);
  return { resetUsers };
}

export async function runHardPurgeDeletedJob(
  env: Env,
): Promise<{ users: number; food_logs: number; food_items: number; supplements: number }> {
  return hardPurgeDeleted(env);
}
