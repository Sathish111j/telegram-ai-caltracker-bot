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



export async function runDailyReportJob(env: Env): Promise<{ sent: number; failed: number }> {
  const telegramIds = await getDueDailyReportTelegramIds(env);
  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    telegramIds.map(async (telegramId) => {
      try {
        const { lines, hasData } = await getDailySummary(env, telegramId);
        if (!hasData) {
          return;
        }

        await sendReport(env, Number(telegramId), lines.join('\n'));
        await markReportSent(env, telegramId, 'daily');
      } catch (error) {
        console.error('Failed to send daily report', { telegramId, error });
        throw error;
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      sent += 1;
    } else {
      failed += 1;
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
      try {
        const { lines, hasData } = await getWeeklySummary(env, telegramId);
        if (!hasData) {
          return;
        }

        await sendReport(env, Number(telegramId), lines.join('\n'));
        await markReportSent(env, telegramId, 'weekly');
      } catch (error) {
        console.error('Failed to send weekly report', { telegramId, error });
        throw error;
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return { sent, failed };
}

export async function runMealGapJob(env: Env): Promise<{ sent: number; failed: number }> {
  const telegramIds = await getMealGapTelegramIds(env, 6);
  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    telegramIds.map(async (telegramId) => {
      try {
        await sendTelegramMessage(
          env,
          Number(telegramId),
          'Meal gap reminder: no food logs detected in the last 6 hours. Reply with what you ate to stay on track.',
        );
        await markReportSent(env, telegramId, 'meal_gap');
      } catch (error) {
        console.error('Failed to send meal gap reminder', { telegramId, error });
        throw error;
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return { sent, failed };
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
