import {
  findTodayFoodMatches,
  getState,
  getTodayFoods,
  getUserAndState,
  saveFoodLog,
  saveState,
  saveUser,
  softDeleteFoodItemById,
} from '../data/db.js';
import { extractFoodFromInput, GeminiQuotaExhaustedError, GeminiTimeoutError } from '../services/ai.js';
import { buildTotalsMessage, formatPreview, mealTypeLabel } from '../services/format.js';
import { sanitizeInput } from '../services/security.js';
import {
  answerCallbackQuery,
  downloadTelegramImage,
  editMessageReplyMarkup,
  editMessageText,
  escapeMarkdown,
  getFile,
  sendChatAction,
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
} from '../services/telegram.js';
import {
  type ConversationState,
  type Env,
  type MealType,
  type PendingImage,
  type PendingLog,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
  type TodayFoodMatch,
} from '../types/index.js';

const timezoneChoices = [
  { label: 'India', value: 'Asia/Kolkata' },
  { label: 'USA (Eastern)', value: 'America/New_York' },
  { label: 'UK', value: 'Europe/London' },
  { label: 'UAE', value: 'Asia/Dubai' },
] as const;

const HELP_TEXT = [
  '*NutriBot — what I can do:*',
  '',
  '🍽️ Send a text description or a photo of a meal any time to log it.',
  '⚡ *Skip the meal-type tap* by starting with it: `breakfast 2 eggs and toast`,',
  '   `lunch chicken rice`, `dinner`, `snack` all work.',
  '/log <meal> — log a meal in one message, e.g. `/log 2 eggs and toast`',
  '/log — guided logging: pick a meal type first, then describe it',
  '/today — see everything logged today, with totals',
  '/delete <name> — remove a food item you logged today (asks to confirm)',
  '/cancel — cancel whatever you\'re in the middle of',
  '/reset — redo your profile setup (name, timezone, calorie goal)',
  '/help — show this message',
].join('\n');

function isCommand(loweredText: string, command: string): boolean {
  return loweredText === command || loweredText.startsWith(`${command} `);
}

const MEAL_TYPE_PREFIXES: Array<{ pattern: RegExp; mealType: MealType }> = [
  { pattern: /^breakfast\b[:,-]?\s*/i, mealType: 'breakfast' },
  { pattern: /^lunch\b[:,-]?\s*/i, mealType: 'lunch' },
  { pattern: /^dinner\b[:,-]?\s*/i, mealType: 'dinner' },
  { pattern: /^(?:snacks?|others?)\b[:,-]?\s*/i, mealType: 'others' },
];

/**
 * Lets a message like "breakfast 2 eggs and toast" skip the meal-type
 * keyboard entirely — the explicit tap-through flow remains the default for
 * everyone who doesn't use this shorthand.
 */
function extractMealTypePrefix(text: string): { mealType: MealType; rest: string } | null {
  for (const { pattern, mealType } of MEAL_TYPE_PREFIXES) {
    const match = text.match(pattern);
    if (match) {
      const rest = text.slice(match[0].length).trim();
      if (rest) return { mealType, rest };
    }
  }
  return null;
}

/** Maps free-text timezone input to an IANA zone, or null if unrecognized. */
function mapTimezoneInput(input: string): string | null {
  const trimmed = input.trim();
  const normalized = trimmed.toLowerCase();
  if (!normalized) return null;
  const direct = timezoneChoices.find((choice) => normalized === choice.label.toLowerCase());
  if (direct) return direct.value;
  if (normalized === 'usa' || normalized === 'us' || normalized === 'america') return 'America/New_York';
  if (/^[a-z_]+\/[a-z_]+$/i.test(trimmed)) return trimmed;
  return null;
}

function buildInlineKeyboard(sessionId: string): Record<string, unknown> {
  return {
    inline_keyboard: [[
      { text: '✅ Save', callback_data: `save|${sessionId}` },
      { text: '❌ Cancel', callback_data: `cancel|${sessionId}` },
    ]],
  };
}

function buildMealSelectionKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: '🍳 Breakfast', callback_data: 'meal|breakfast' },
        { text: '🍱 Lunch', callback_data: 'meal|lunch' },
      ],
      [
        { text: '🍽️ Dinner', callback_data: 'meal|dinner' },
        { text: '🍿 Snacks / Others', callback_data: 'meal|others' },
      ],
      [{ text: '🚫 Cancel', callback_data: 'meal_cancel' }],
    ],
  };
}

function buildTimezoneKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: '🇮🇳 India', callback_data: 'tz|india' }, { text: '🇺🇸 USA (Eastern)', callback_data: 'tz|usa_eastern' }],
      [{ text: '🇬🇧 UK', callback_data: 'tz|uk' }, { text: '🇦🇪 UAE', callback_data: 'tz|uae' }],
    ],
  };
}

function buildDeleteConfirmKeyboard(matches: TodayFoodMatch[]): Record<string, unknown> {
  return {
    inline_keyboard: [
      ...matches.map((match) => [{
        text: `🗑️ ${match.food_name}${match.quantity && match.unit ? ` (${match.quantity} ${match.unit})` : ''}`,
        callback_data: `delete_confirm|${match.food_item_id}`,
      }]),
      [{ text: '🚫 Cancel', callback_data: 'delete_cancel' }],
    ],
  };
}

function buildResetConfirmKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [[
      { text: '✅ Yes, restart setup', callback_data: 'reset_confirm' },
      { text: '🚫 No, keep my profile', callback_data: 'reset_cancel' },
    ]],
  };
}

function timezoneFromToken(token: string): string | null {
  switch (token) {
    case 'india': return 'Asia/Kolkata';
    case 'usa_eastern': return 'America/New_York';
    case 'uk': return 'Europe/London';
    case 'uae': return 'Asia/Dubai';
    default: return null;
  }
}

function friendlyErrorMessage(error: unknown): string {
  if (error instanceof GeminiQuotaExhaustedError) {
    return "I'm having trouble reaching the AI service right now — please try again in a few minutes.";
  }
  if (error instanceof GeminiTimeoutError) {
    return 'That took too long to process — please try again.';
  }
  return 'Something went wrong while processing that — please try again in a moment.';
}

/**
 * The single choke point for turning text/image input into a saved food log:
 * runs the prompt-injection filter, calls Gemini, and presents exactly one
 * preview+confirm message.
 */
async function handleFoodInput(
  env: Env,
  chatId: number,
  telegramId: string,
  logText: string,
  mealType: MealType,
  image?: PendingImage,
): Promise<void> {
  const sessionId = crypto.randomUUID();
  let placeholderMessageId: number | undefined;

  try {
    await sendChatAction(env, chatId, 'typing');
    const placeholder = await sendTelegramMessage(env, chatId, `⏳ Calculating nutrients for ${mealTypeLabel(mealType)}...`);
    placeholderMessageId = placeholder.ok ? placeholder.messageId : undefined;

    const extracted = await extractFoodFromInput(
      env,
      logText,
      image ? { data: image.data, mimeType: image.mimeType } : undefined,
    );

    const pendingLog: PendingLog = {
      session_id: sessionId,
      source_text: logText || (image ? '(photo)' : ''),
      ai_raw_response: extracted.raw,
      items: extracted.parsed.items,
      meal_type: mealType,
      meal_notes: extracted.parsed.meal_notes,
    };

    // Re-fetch fresh state right before writing so a second message that
    // arrived while the AI call was in flight isn't clobbered by this write.
    const fresh = await getState(env, telegramId);
    await saveState(env, telegramId, 'awaiting_food_input', {
      ...fresh.context,
      pending_log: pendingLog,
      selected_meal_type: undefined,
      pending_source_text: undefined,
      pending_source_image: undefined,
    });

    const previewText = formatPreview(pendingLog.items, pendingLog.meal_notes);
    const keyboard = buildInlineKeyboard(sessionId);

    // Turn the "⏳ Calculating..." placeholder into the final result in
    // place instead of sending a second message — feels faster, and keeps
    // the chat from filling up with throwaway status messages.
    const edited = placeholderMessageId
      ? await editMessageText(env, chatId, placeholderMessageId, previewText, { replyMarkup: keyboard })
      : { ok: false as const };
    if (!edited.ok) {
      await sendTelegramMessageWithKeyboard(env, chatId, previewText, keyboard);
    }
  } catch (error: any) {
    console.error('handleFoodInput failed', { message: error?.message, telegramId });
    const errorMessage = friendlyErrorMessage(error);
    const edited = placeholderMessageId ? await editMessageText(env, chatId, placeholderMessageId, errorMessage) : { ok: false as const };
    if (!edited.ok) {
      await sendTelegramMessage(env, chatId, errorMessage);
    }
  }
}

/** Entry point for any free-text meal description (from /log <text> or plain messages). */
async function beginTextLogging(
  env: Env,
  message: TelegramMessage,
  telegramId: string,
  user: { id: number } | null,
  state: ConversationState,
  text: string,
): Promise<void> {
  if (!user) {
    await sendTelegramMessage(env, message.chat.id, 'Please send /start to set up your profile before logging meals.');
    return;
  }

  const sanitizeResult = sanitizeInput(text);
  if (!sanitizeResult.clean) {
    await sendTelegramMessage(env, message.chat.id, "I can't process that message — please describe your meal in plain language.");
    return;
  }

  if (state.context.selected_meal_type) {
    await handleFoodInput(env, message.chat.id, telegramId, text, state.context.selected_meal_type);
    return;
  }

  // "breakfast 2 eggs and toast" — skip the meal-type keyboard entirely.
  const prefixed = extractMealTypePrefix(text);
  if (prefixed) {
    await handleFoodInput(env, message.chat.id, telegramId, prefixed.rest, prefixed.mealType);
    return;
  }

  await saveState(env, telegramId, 'awaiting_food_input', {
    ...state.context,
    pending_source_text: text,
    pending_source_image: undefined,
  });
  await sendTelegramMessageWithKeyboard(
    env,
    message.chat.id,
    'What type of meal is this?\n_Tip: next time, start with "breakfast", "lunch", "dinner" or "snack" to skip this step._',
    buildMealSelectionKeyboard(),
  );
}

/** Entry point for a photo message: downloads/validates the image, then mirrors the text flow. */
async function handlePhotoMessage(
  env: Env,
  message: TelegramMessage,
  telegramId: string,
  user: { id: number } | null,
  state: ConversationState,
): Promise<void> {
  if (!user) {
    await sendTelegramMessage(env, message.chat.id, 'Please send /start to set up your profile before logging meals.');
    return;
  }

  const photos = message.photo!;
  const bestPhoto = photos[photos.length - 1];
  const fileInfo = await getFile(env, bestPhoto.file_id);
  if (!fileInfo) {
    await sendTelegramMessage(env, message.chat.id, "That photo is too large or couldn't be retrieved — please try a smaller image.");
    return;
  }

  const downloaded = await downloadTelegramImage(env, fileInfo.filePath);
  if (!downloaded) {
    await sendTelegramMessage(env, message.chat.id, 'I can only accept JPEG, PNG, or WEBP photos under 10MB.');
    return;
  }

  const caption = message.caption?.trim();
  if (caption) {
    const sanitizeResult = sanitizeInput(caption);
    if (!sanitizeResult.clean) {
      await sendTelegramMessage(env, message.chat.id, "I can't process that caption — please describe your meal in plain language.");
      return;
    }
  }

  if (state.context.selected_meal_type) {
    const image: PendingImage = { data: downloaded.data, mimeType: downloaded.mimeType, caption };
    await handleFoodInput(env, message.chat.id, telegramId, caption ?? '', state.context.selected_meal_type, image);
    return;
  }

  // A caption like "lunch chicken rice" skips the meal-type keyboard too.
  const prefixed = caption ? extractMealTypePrefix(caption) : null;
  if (prefixed) {
    const image: PendingImage = { data: downloaded.data, mimeType: downloaded.mimeType, caption: prefixed.rest };
    await handleFoodInput(env, message.chat.id, telegramId, prefixed.rest, prefixed.mealType, image);
    return;
  }

  const image: PendingImage = { data: downloaded.data, mimeType: downloaded.mimeType, caption };

  await saveState(env, telegramId, 'awaiting_food_input', {
    ...state.context,
    pending_source_image: image,
    pending_source_text: undefined,
  });
  await sendTelegramMessageWithKeyboard(env, message.chat.id, 'Got the photo! What type of meal is this?', buildMealSelectionKeyboard());
}

async function handleCallbackQuery(env: Env, callback: TelegramCallbackQuery): Promise<void> {
  const message = callback.message;

  if (message?.chat.type && message.chat.type !== 'private') {
    await answerCallbackQuery(env, callback.id, 'This bot only works in private chats.');
    return;
  }

  if (!message || message.message_id === undefined) {
    await answerCallbackQuery(env, callback.id, 'This action has expired, please try again.');
    return;
  }

  const telegramId = String(callback.from.id);
  const [action, arg1] = (callback.data || '').split('|');
  const { user, state } = await getUserAndState(env, telegramId);
  const chatId = message.chat.id;
  const messageId = message.message_id;

  if (action === 'meal_cancel') {
    await saveState(env, telegramId, 'awaiting_food_input', {});
    await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
    await sendTelegramMessage(env, chatId, '🚫 Meal logging cancelled.');
    await answerCallbackQuery(env, callback.id);
    return;
  }

  if (action === 'tz') {
    if (!state.context.onboarding?.draft) {
      await answerCallbackQuery(env, callback.id, 'This session expired — send /start to begin again.');
      return;
    }
    const timezone = timezoneFromToken(arg1);
    if (!timezone) {
      await answerCallbackQuery(env, callback.id, 'Unrecognized option, please try again.');
      return;
    }
    await saveState(env, telegramId, 'onboarding', {
      onboarding: { step: 'calorie_goal', draft: { ...state.context.onboarding.draft, timezone } },
    });
    await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
    await sendTelegramMessage(env, chatId, '✅ Timezone set. What is your daily calorie goal? (e.g. 2000)');
    await answerCallbackQuery(env, callback.id);
    return;
  }

  if (action === 'meal') {
    if (!user) {
      await answerCallbackQuery(env, callback.id, 'Please send /start first.');
      return;
    }
    const mealType = arg1 as MealType;
    await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
    await answerCallbackQuery(env, callback.id);

    const pendingText = state.context.pending_source_text;
    const pendingImage = state.context.pending_source_image;
    if (pendingText || pendingImage) {
      await handleFoodInput(env, chatId, telegramId, pendingText ?? pendingImage?.caption ?? '', mealType, pendingImage);
      return;
    }

    await saveState(env, telegramId, 'awaiting_food_input', {
      ...state.context,
      selected_meal_type: mealType,
      pending_source_text: undefined,
      pending_source_image: undefined,
    });
    await sendTelegramMessage(env, chatId, `🍽️ Logging ${mealTypeLabel(mealType)}. What did you have? (text or a photo)`);
    return;
  }

  if (action === 'save') {
    if (state.context.pending_log && state.context.pending_log.session_id === arg1) {
      await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
      await saveFoodLog(env, telegramId, state.context.pending_log);
      await saveState(env, telegramId, 'awaiting_food_input', {});
      await sendTelegramMessage(env, chatId, '✅ *Meal saved successfully!*\n\n💡 Use /today to see your logs.');
      await answerCallbackQuery(env, callback.id);
      return;
    }
    await answerCallbackQuery(env, callback.id, 'This log has already been saved or has expired.');
    return;
  }

  if (action === 'cancel') {
    await saveState(env, telegramId, 'awaiting_food_input', {});
    await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
    await sendTelegramMessage(env, chatId, '🚫 Log cancelled.');
    await answerCallbackQuery(env, callback.id);
    return;
  }

  if (action === 'delete_confirm') {
    if (!user) {
      await answerCallbackQuery(env, callback.id, 'Please send /start first.');
      return;
    }
    const foodItemId = Number(arg1);
    await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
    const deletedName = Number.isFinite(foodItemId) ? await softDeleteFoodItemById(env, user.id, foodItemId) : null;
    await sendTelegramMessage(
      env,
      chatId,
      deletedName ? `✅ Deleted: ${escapeMarkdown(deletedName)}` : 'That item is no longer available (already deleted?).',
    );
    await answerCallbackQuery(env, callback.id);
    return;
  }

  if (action === 'delete_cancel') {
    await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
    await sendTelegramMessage(env, chatId, 'Cancelled — nothing deleted.');
    await answerCallbackQuery(env, callback.id);
    return;
  }

  if (action === 'reset_confirm') {
    await saveState(env, telegramId, 'onboarding', { onboarding: { step: 'name', draft: {} } });
    await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
    await sendTelegramMessage(env, chatId, "Let's set up your profile again. What name should I call you?");
    await answerCallbackQuery(env, callback.id);
    return;
  }

  if (action === 'reset_cancel') {
    await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
    await sendTelegramMessage(env, chatId, 'Okay, nothing changed.');
    await answerCallbackQuery(env, callback.id);
    return;
  }

  await answerCallbackQuery(env, callback.id, 'This action is no longer available.');
}

export async function handleTelegramUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
    return;
  }

  // Edited messages carry no new actionable intent for this bot.
  if (update.edited_message) {
    return;
  }

  const message = update.message;
  if (!message?.from) return;

  if (message.chat.type && message.chat.type !== 'private') {
    await sendTelegramMessage(env, message.chat.id, 'I only work in private chats — please message me directly.');
    return;
  }

  const telegramId = String(message.from.id);
  const { user, state } = await getUserAndState(env, telegramId);

  if (message.photo && message.photo.length > 0) {
    await handlePhotoMessage(env, message, telegramId, user, state);
    return;
  }

  if (!message.text) {
    await sendTelegramMessage(env, message.chat.id, 'I can only understand text or a photo of your meal.');
    return;
  }

  const text = message.text.trim();
  const loweredText = text.toLowerCase();

  // HELP
  if (isCommand(loweredText, '/help')) {
    await sendTelegramMessage(env, message.chat.id, HELP_TEXT);
    return;
  }

  // CANCEL — works from any state.
  if (isCommand(loweredText, '/cancel')) {
    await saveState(env, telegramId, user ? 'awaiting_food_input' : 'idle', {});
    await sendTelegramMessage(
      env,
      message.chat.id,
      user ? '✅ Cancelled.' : "✅ Cancelled. Send /start when you're ready to begin.",
    );
    return;
  }

  // RESET — restart onboarding for an existing user, with confirmation.
  if (isCommand(loweredText, '/reset')) {
    if (!user) {
      await sendTelegramMessage(env, message.chat.id, "You don't have a profile yet — send /start to set one up.");
      return;
    }
    await sendTelegramMessageWithKeyboard(
      env,
      message.chat.id,
      "This will restart your profile setup (name, timezone, calorie goal). Your food logs will *not* be deleted. Continue?",
      buildResetConfirmKeyboard(),
    );
    return;
  }

  // START
  if (isCommand(loweredText, '/start')) {
    if (user) {
      await sendTelegramMessage(
        env,
        message.chat.id,
        "👋 You're already set up! Send me a food description or photo any time to log a meal.\n\nUse /help to see everything I can do, or /reset to redo your profile.",
      );
      return;
    }
    await saveState(env, telegramId, 'onboarding', { onboarding: { step: 'name', draft: {} } });
    await sendTelegramMessage(env, message.chat.id, "Welcome to NutriBot! Let's set up your profile.\n\nWhat name should I call you?");
    return;
  }

  // TODAY
  if (isCommand(loweredText, '/today')) {
    if (!user) {
      await sendTelegramMessage(env, message.chat.id, 'Please complete /start first.');
      return;
    }
    const rows = await getTodayFoods(env, user.id);
    if (rows.length === 0) {
      await sendTelegramMessage(env, message.chat.id, '📭 No logs for today yet.');
      return;
    }
    await sendTelegramMessage(env, message.chat.id, buildTotalsMessage(rows, user.calorie_goal));
    return;
  }

  // LOG
  if (isCommand(loweredText, '/log')) {
    if (!user) {
      await sendTelegramMessage(env, message.chat.id, 'Please complete /start first.');
      return;
    }
    const logText = text.replace(/^\/log\s*/i, '').trim();
    if (!logText) {
      await saveState(env, telegramId, 'awaiting_food_input', {
        ...state.context,
        selected_meal_type: undefined,
        pending_source_text: undefined,
        pending_source_image: undefined,
      });
      await sendTelegramMessageWithKeyboard(env, message.chat.id, 'What type of meal would you like to log?', buildMealSelectionKeyboard());
      return;
    }
    await beginTextLogging(env, message, telegramId, user, state, logText);
    return;
  }

  // DELETE
  if (isCommand(loweredText, '/delete')) {
    if (!user) {
      await sendTelegramMessage(env, message.chat.id, 'Please complete /start first.');
      return;
    }
    const nameToDelete = text.replace(/^\/delete\s*/i, '').trim();
    if (!nameToDelete) {
      await sendTelegramMessage(env, message.chat.id, 'Usage: /delete <part of the food name>, e.g. /delete rice');
      return;
    }
    const matches = await findTodayFoodMatches(env, user.id, nameToDelete);
    if (matches.length === 0) {
      await sendTelegramMessage(env, message.chat.id, `No matching food logged today for "${escapeMarkdown(nameToDelete)}".`);
      return;
    }
    await sendTelegramMessageWithKeyboard(
      env,
      message.chat.id,
      `Found ${matches.length} match${matches.length > 1 ? 'es' : ''} for today. Which should I delete?`,
      buildDeleteConfirmKeyboard(matches),
    );
    return;
  }

  // Onboarding
  if (state.state === 'onboarding') {
    const onboarding = state.context.onboarding;
    if (!onboarding) {
      // Corrupted/stale onboarding state — restart cleanly instead of throwing.
      await saveState(env, telegramId, 'onboarding', { onboarding: { step: 'name', draft: {} } });
      await sendTelegramMessage(env, message.chat.id, "Let's start over. What name should I call you?");
      return;
    }

    if (onboarding.step === 'name') {
      const firstName = text.slice(0, 60).trim();
      if (!firstName) {
        await sendTelegramMessage(env, message.chat.id, 'Please tell me your name.');
        return;
      }
      await saveState(env, telegramId, 'onboarding', { onboarding: { step: 'timezone', draft: { ...onboarding.draft, first_name: firstName } } });
      await sendTelegramMessageWithKeyboard(env, message.chat.id, 'Great. Choose your timezone:', buildTimezoneKeyboard());
      return;
    }

    if (onboarding.step === 'timezone') {
      const timezone = mapTimezoneInput(text);
      if (!timezone) {
        await sendTelegramMessageWithKeyboard(
          env,
          message.chat.id,
          "I didn't recognize that timezone — please tap one of the options below, or type a valid one like \"Europe/Paris\".",
          buildTimezoneKeyboard(),
        );
        return;
      }
      await saveState(env, telegramId, 'onboarding', { onboarding: { step: 'calorie_goal', draft: { ...onboarding.draft, timezone } } });
      await sendTelegramMessage(env, message.chat.id, 'What is your daily calorie goal? (e.g. 2000)');
      return;
    }

    if (onboarding.step === 'calorie_goal') {
      const calorieGoal = Number.parseInt(text, 10);
      if (!Number.isFinite(calorieGoal) || calorieGoal < 800 || calorieGoal > 10000) {
        await sendTelegramMessage(env, message.chat.id, 'Please enter a whole number between 800 and 10000.');
        return;
      }
      try {
        await saveUser(env, telegramId, onboarding.draft.first_name!, onboarding.draft.timezone!, calorieGoal);
      } catch (error: any) {
        console.error('saveUser failed during onboarding', { telegramId, message: error?.message });
        await sendTelegramMessage(env, message.chat.id, 'Something went wrong saving your profile — please try again.');
        return;
      }
      await saveState(env, telegramId, 'awaiting_food_input', {});
      await sendTelegramMessage(env, message.chat.id, '✅ Setup complete! Send a food description or photo any time to log a meal — or check /help for everything I can do.');
      return;
    }
  }

  if (text.startsWith('/')) {
    await sendTelegramMessage(env, message.chat.id, "I don't recognize that command. Use /help to see what I can do.");
    return;
  }

  await beginTextLogging(env, message, telegramId, user, state, text);
}
