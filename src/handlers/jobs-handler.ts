import {
  hardPurgeDeleted,
  getDailySummary,
  getDueDailyReportTelegramIds,
  getDueWeeklyReportTelegramIds,
  getMealGapTelegramIds,
  getWeeklySummary,
  markReportSent,
  reactivateStaleKeys,
  resetDailyAiCounters,
} from '../data/db.js';
import { sendReport, sendTelegramMessage } from '../services/telegram.js';
import { type Env } from '../types/index.js';

const MEAL_GAP_HOURS = 6;
const MEAL_GAP_REMINDER_COOLDOWN_HOURS = 8;

export async function runDailyReportJob(env: Env): Promise<{ sent: number; failed: number }> {
  const telegramIds = await getDueDailyReportTelegramIds(env);
  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    telegramIds.map(async (telegramId) => {
      const { lines, hasData } = await getDailySummary(env, telegramId);
      if (!hasData) {
        return;
      }

      const result = await sendReport(env, Number(telegramId), lines.join('\n'));
      if (!result.ok) {
        throw new Error(result.error ?? 'Failed to deliver daily report');
      }
      await markReportSent(env, telegramId, 'daily');
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      sent += 1;
    } else {
      failed += 1;
      console.error('Failed to send daily report', { error: result.reason });
    }
  }

  return { sent, failed };
}

export async function runWeeklyReportJob(env: Env): Promise<{ sent: number; failed: number }> {
  const telegramIds = await getDueWeeklyReportTelegramIds(env);
  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    telegramIds.map(async (telegramId) => {
      const { lines, hasData } = await getWeeklySummary(env, telegramId);
      if (!hasData) {
        return;
      }

      const result = await sendReport(env, Number(telegramId), lines.join('\n'));
      if (!result.ok) {
        throw new Error(result.error ?? 'Failed to deliver weekly report');
      }
      await markReportSent(env, telegramId, 'weekly');
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      sent += 1;
    } else {
      failed += 1;
      console.error('Failed to send weekly report', { error: result.reason });
    }
  }

  return { sent, failed };
}

export async function runMealGapJob(env: Env): Promise<{ sent: number; failed: number }> {
  const telegramIds = await getMealGapTelegramIds(env, MEAL_GAP_HOURS, MEAL_GAP_REMINDER_COOLDOWN_HOURS);
  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    telegramIds.map(async (telegramId) => {
      const result = await sendTelegramMessage(
        env,
        Number(telegramId),
        `Meal gap reminder: no food logs detected in the last ${MEAL_GAP_HOURS} hours. Reply with what you ate to stay on track.`,
      );
      if (!result.ok) {
        throw new Error(result.error ?? 'Failed to deliver meal gap reminder');
      }
      await markReportSent(env, telegramId, 'meal_gap');
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      sent += 1;
    } else {
      failed += 1;
      console.error('Failed to send meal gap reminder', { error: result.reason });
    }
  }

  return { sent, failed };
}

export async function runResetDailyAiJob(env: Env): Promise<{ resetUsers: number; reactivatedKeys: number }> {
  const resetUsers = await resetDailyAiCounters(env);
  const reactivatedKeys = await reactivateStaleKeys(env);
  return { resetUsers, reactivatedKeys };
}

export async function runHardPurgeDeletedJob(env: Env): Promise<{ food_logs: number; food_items: number }> {
  return hardPurgeDeleted(env);
}
