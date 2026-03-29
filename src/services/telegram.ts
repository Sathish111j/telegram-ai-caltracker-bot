import { type Env } from '../types/index.js';

function ensureBotToken(env: Env): string {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN secret.');
  }

  return env.TELEGRAM_BOT_TOKEN;
}

export async function sendTelegramMessage(env: Env, chatId: number, text: string): Promise<void> {
  const token = ensureBotToken(env);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 3900),
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to send Telegram message: ${details}`);
  }
}

export async function sendTelegramMessageWithKeyboard(
  env: Env,
  chatId: number,
  text: string,
  replyMarkup: Record<string, unknown>,
): Promise<void> {
  const token = ensureBotToken(env);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 3900),
      reply_markup: replyMarkup,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to send Telegram message: ${details}`);
  }
}

export async function answerCallbackQuery(env: Env, callbackQueryId: string, text?: string): Promise<void> {
  const token = ensureBotToken(env);
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    }),
  });
}
