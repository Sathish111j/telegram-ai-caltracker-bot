import postgres from 'postgres';
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
      return runDailyReportJob(env);
    case '0 15 * * SUN':
      return runWeeklyReportJob(env);
    case '0 * * * *':
      return runMealGapJob(env);
    case '30 18 * * *':
      return runResetDailyAiJob(env);
    case '0 3 * * SUN':
      return runHardPurgeDeletedJob(env);
    default:
      return { skipped: true, cron: event.cron };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: WorkerExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/health') {
      return Response.json({ ok: true });
    }

    if (pathname === '/telegram-webhook') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const incomingSecret = request.headers.get('x-telegram-bot-api-secret-token');
        if (incomingSecret !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
      }

      // Sequential database connection
      const sql = postgres(env.DATABASE_URL!, {
        max: 1,
        prepare: false,
        idle_timeout: 20,
        connect_timeout: 10,
      });

      try {
        const update = (await request.json()) as TelegramUpdate;
        
        // NORMAL SEQUENTIAL PROCESSING
        const response = await handleTelegramUpdate({ ...env, sql }, update);

        await sql.end().catch(() => {});

        if (response) {
          return Response.json(response);
        }
        return Response.json({ ok: true });
        
      } catch (error: any) {
        console.error('Request failed', { error: error.message });
        await sql.end().catch(() => {});
        return Response.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    return Response.json({ message: 'NutriBot is running' });
  },

  async scheduled(event: WorkerScheduledEvent, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    ctx.waitUntil(
      dispatchScheduled(event, env)
        .then((result) => console.log('scheduled job complete', { result }))
        .catch((error) => console.error('scheduled job failed', { error: error.message })),
    );
  },
};
