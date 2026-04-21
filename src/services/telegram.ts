import { type Env } from '../types/index.js';

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
}

function ensureBotToken(env: Env): string {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN secret.');
  }
  return env.TELEGRAM_BOT_TOKEN;
}

function truncateTelegramText(text: string): string {
  if (text.length <= 3900) return text;
  return `${text.slice(0, 3883)}... [truncated]`;
}

/**
 * Low-level API caller. 
 */
async function telegramRequest(env: Env, method: string, payload: Record<string, unknown>): Promise<void> {
  const token = ensureBotToken(env);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let body: TelegramApiResponse | null = null;
  try {
    body = (await response.json()) as TelegramApiResponse;
  } catch {
    // Ignored
  }

  if (!response.ok || !body?.ok) {
    const details = body?.description || `${response.status} ${response.statusText}`.trim();
    console.error(`Telegram API Error (${method}):`, details);
  }
}

/**
 * HIGH-SPEED HELPER:
 * If we are still in the primary request context, we can return the JSON.
 */
export async function sendReply(env: Env, method: string, payload: Record<string, any>): Promise<any> {
  if ((env as any)._responseSent) {
    return telegramRequest(env, method, payload);
  }
  return { method, ...payload };
}

export async function sendTelegramMessage(env: Env, chatId: number, text: string, entities?: any[]): Promise<void> {
  return telegramRequest(env, 'sendMessage', {
    chat_id: chatId,
    text: truncateTelegramText(text),
    ...(entities && { entities }),
  });
}

export async function sendTelegramMessageWithKeyboard(env: Env, chatId: number, text: string, replyMarkup: Record<string, unknown>, entities?: any[]): Promise<void> {
  return telegramRequest(env, 'sendMessage', {
    chat_id: chatId,
    text: truncateTelegramText(text),
    reply_markup: replyMarkup,
    ...(entities && { entities }),
  });
}

export async function sendMessageDraft(env: Env, chatId: number, text: string): Promise<void> {
  return telegramRequest(env, 'sendMessageDraft', {
    chat_id: chatId,
    draft_id: 1, // REQUIRED: Must be non-zero
    text: truncateTelegramText(text),
  });
}

export async function sendChatAction(env: Env, chatId: number, action: string): Promise<void> {
  return telegramRequest(env, 'sendChatAction', { chat_id: chatId, action });
}

export async function sendReport(env: Env, chatId: number, report: string): Promise<void> {
  return sendTelegramMessage(env, chatId, report);
}

export async function answerCallbackQuery(env: Env, callbackQueryId: string, text?: string): Promise<void> {
  return telegramRequest(env, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

export async function editMessageReplyMarkup(env: Env, chatId: number, messageId: number, replyMarkup: Record<string, unknown>): Promise<void> {
  return telegramRequest(env, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}
