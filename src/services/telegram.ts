import { type Env } from '../types/index.js';

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  parameters?: { retry_after?: number };
  result?: unknown;
}

export interface TelegramApiResult {
  ok: boolean;
  error?: string;
  retryAfter?: number;
  messageId?: number;
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
 * Escapes text for Telegram's legacy `Markdown` parse mode (only `_`, `*`, `` ` ``, `[`
 * need escaping, unlike the much stricter MarkdownV2). Use this around every
 * dynamic/user-controlled substring interpolated into a message; leave literal
 * `*bold*` markers in static template text un-escaped.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, '\\$1');
}

const MAX_RETRIES = 2;

/**
 * Low-level API caller. Returns a typed result instead of swallowing failures,
 * so callers (especially scheduled jobs) can tell whether delivery actually
 * succeeded. Retries once or twice on HTTP 429, honoring Telegram's `retry_after`.
 */
async function telegramRequest(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
  attempt = 0,
): Promise<TelegramApiResult> {
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
    // Ignored — body stays null, handled below.
  }

  if (response.ok && body?.ok) {
    const result = body.result as { message_id?: number } | undefined;
    return { ok: true, messageId: result?.message_id };
  }

  const retryAfter = body?.parameters?.retry_after;
  if (response.status === 429 && retryAfter && attempt < MAX_RETRIES) {
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return telegramRequest(env, method, payload, attempt + 1);
  }

  const details = body?.description || `${response.status} ${response.statusText}`.trim();
  console.error(`Telegram API Error (${method}):`, details);
  return { ok: false, error: details, retryAfter };
}

export async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string,
  options?: { markdown?: boolean },
): Promise<TelegramApiResult> {
  return telegramRequest(env, 'sendMessage', {
    chat_id: chatId,
    text: truncateTelegramText(text),
    ...(options?.markdown !== false ? { parse_mode: 'Markdown' } : {}),
  });
}

export async function sendTelegramMessageWithKeyboard(
  env: Env,
  chatId: number,
  text: string,
  replyMarkup: Record<string, unknown>,
  options?: { markdown?: boolean },
): Promise<TelegramApiResult> {
  return telegramRequest(env, 'sendMessage', {
    chat_id: chatId,
    text: truncateTelegramText(text),
    reply_markup: replyMarkup,
    ...(options?.markdown !== false ? { parse_mode: 'Markdown' } : {}),
  });
}

/**
 * Edits an existing message's text in place (optionally replacing its
 * keyboard) — used to turn a "⏳ working..." placeholder into the final
 * result without sending a second message.
 */
export async function editMessageText(
  env: Env,
  chatId: number,
  messageId: number,
  text: string,
  options?: { markdown?: boolean; replyMarkup?: Record<string, unknown> },
): Promise<TelegramApiResult> {
  return telegramRequest(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: truncateTelegramText(text),
    ...(options?.markdown !== false ? { parse_mode: 'Markdown' } : {}),
    ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function sendChatAction(env: Env, chatId: number, action: string): Promise<TelegramApiResult> {
  return telegramRequest(env, 'sendChatAction', { chat_id: chatId, action });
}

export async function sendReport(env: Env, chatId: number, report: string): Promise<TelegramApiResult> {
  return sendTelegramMessage(env, chatId, report);
}

export async function answerCallbackQuery(env: Env, callbackQueryId: string, text?: string): Promise<TelegramApiResult> {
  return telegramRequest(env, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    show_alert: false,
  });
}

export async function editMessageReplyMarkup(
  env: Env,
  chatId: number,
  messageId: number,
  replyMarkup: Record<string, unknown>,
): Promise<TelegramApiResult> {
  return telegramRequest(env, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Resolves a Telegram file_id to a downloadable file_path, rejecting anything
 * over the size cap before a byte is downloaded.
 */
export async function getFile(env: Env, fileId: string): Promise<{ filePath: string; fileSize?: number } | null> {
  const token = ensureBotToken(env);
  const response = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const body = (await response.json().catch(() => null)) as
    | { ok: boolean; result?: { file_path?: string; file_size?: number } }
    | null;

  if (!response.ok || !body?.ok || !body.result?.file_path) {
    console.error('Telegram getFile failed', { fileId, status: response.status });
    return null;
  }

  if (body.result.file_size && body.result.file_size > MAX_PHOTO_BYTES) {
    return null;
  }

  return { filePath: body.result.file_path, fileSize: body.result.file_size };
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function mimeTypeFromFilePath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}

/**
 * Downloads a Telegram file and returns it base64-encoded along with a
 * validated mime type, or null if the download failed or the file isn't an
 * allowed image type.
 */
export async function downloadTelegramImage(
  env: Env,
  filePath: string,
): Promise<{ data: string; mimeType: string } | null> {
  const mimeType = mimeTypeFromFilePath(filePath);
  if (!mimeType || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return null;
  }

  const token = ensureBotToken(env);
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) {
    console.error('Telegram file download failed', { filePath, status: response.status });
    return null;
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    return null;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const data = btoa(binary);

  return { data, mimeType };
}
