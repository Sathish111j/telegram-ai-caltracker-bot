import {
  runDailyReportJob,
  runHardPurgeDeletedJob,
  runMealGapJob,
  runResetDailyAiJob,
  runWeeklyReportJob,
} from './handlers/jobs-handler.js';
import { handleTelegramUpdate } from './handlers/telegram-handler.js';
import { type Env, type TelegramUpdate } from './types/index.js';

interface WorkerScheduledEvent {
  cron: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

async function dispatchScheduled(event: WorkerScheduledEvent, env: Env): Promise<unknown> {
  switch (event.cron) {
    case '0 15 * * *':
      // 15:00 UTC / 20:30 IST
      return runDailyReportJob(env);
    case '0 15 * * SUN':
      // Sunday 15:00 UTC / 20:30 IST
      return runWeeklyReportJob(env);
    case '0 * * * *':
      return runMealGapJob(env);
    case '30 18 * * *':
      // 18:30 UTC / 00:00 IST (next day)
      return runResetDailyAiJob(env);
    case '0 3 * * SUN':
      // Sunday 03:00 UTC / 08:30 IST
      return runHardPurgeDeletedJob(env);
    default:
      return { skipped: true, cron: event.cron };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/health') {
      return Response.json({ ok: true, service: 'nutribot-worker' });
    }

    if (pathname === '/telegram-webhook') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const incomingSecret = request.headers.get('x-telegram-bot-api-secret-token');
        if (incomingSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
          return new Response('Unauthorized', { status: 401 });
        }
      }

      try {
        const update = (await request.json()) as TelegramUpdate;
        await handleTelegramUpdate(env, update);
        return Response.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown webhook error';
        const stack = error instanceof Error ? error.stack : undefined;
        console.error('telegram webhook failed', {
          path: pathname,
          method: request.method,
          error: message,
          stack,
        });
        return Response.json({ ok: false, error: message }, { status: 500 });
      }
    }

    return Response.json({
      message: 'NutriBot worker is running',
      endpoints: ['/health', '/telegram-webhook'],
    });
  },

  async scheduled(event: WorkerScheduledEvent, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    ctx.waitUntil(
      dispatchScheduled(event, env)
        .then((result) => {
          console.log('scheduled job complete', { cron: event.cron, result });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error('scheduled job failed', { cron: event.cron, error: message });
        }),
    );
  },
};
