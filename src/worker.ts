import { handleTelegramUpdate } from './handlers/telegram-handler.js';
import { type Env, type TelegramUpdate } from './types/index.js';

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
        return Response.json({ ok: false, error: message }, { status: 500 });
      }
    }

    return Response.json({
      message: 'NutriBot worker is running',
      endpoints: ['/health', '/telegram-webhook'],
    });
  },
};
