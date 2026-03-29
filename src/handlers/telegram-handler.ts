import {
  getState,
  getTodayFoods,
  getUserIdByTelegramId,
  saveFoodLog,
  saveState,
  saveUser,
  softDeleteFoodForToday,
} from '../data/db.js';
import { buildInlineKeyboard, extractNutrition, formatPreview } from '../services/nutrition.js';
import { answerCallbackQuery, sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../services/telegram.js';
import {
  type Env,
  type OnboardingContext,
  type PendingLog,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from '../types/index.js';

function buildTotalsMessage(rows: Awaited<ReturnType<typeof getTodayFoods>>): string {
  const totals = rows.reduce(
    (acc, row) => ({
      calories: acc.calories + (row.calories ?? 0),
      protein: acc.protein + (row.protein_g ?? 0),
      carbs: acc.carbs + (row.carbs_g ?? 0),
      fat: acc.fat + (row.fat_g ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const lines = ["Today's logs:"];
  rows.forEach((row, i) => {
    lines.push(
      `${i + 1}. ${row.food_name} - ${row.calories ?? '?'} kcal | P ${row.protein_g ?? '?'}g | C ${row.carbs_g ?? '?'}g | F ${row.fat_g ?? '?'}g`,
    );
  });

  lines.push('');
  lines.push(
    `Daily totals: ${Math.round(totals.calories)} kcal | P ${Math.round(totals.protein)}g | C ${Math.round(totals.carbs)}g | F ${Math.round(totals.fat)}g`,
  );

  return lines.join('\n');
}

async function handleStart(env: Env, message: TelegramMessage): Promise<void> {
  const telegramId = String(message.from?.id ?? '');
  const chatId = message.chat.id;

  await saveState(env, telegramId, 'idle', {
    onboarding: {
      step: 'name',
      draft: {},
    },
  });

  await sendTelegramMessage(
    env,
    chatId,
    "Welcome to NutriBot! Let's set up your profile.\nWhat name should I call you?",
  );
}

async function handleOnboarding(
  env: Env,
  message: TelegramMessage,
  state: { state: string; context: OnboardingContext },
): Promise<void> {
  const telegramId = String(message.from?.id ?? '');
  const chatId = message.chat.id;
  const input = (message.text || '').trim();

  const onboarding = state.context.onboarding;
  if (!onboarding) {
    await saveState(env, telegramId, 'idle', {
      onboarding: { step: 'name', draft: {} },
    });
    await sendTelegramMessage(env, chatId, "Let's begin. What name should I call you?");
    return;
  }

  if (onboarding.step === 'name') {
    const firstName = input || message.from?.first_name || 'User';
    await saveState(env, telegramId, 'idle', {
      onboarding: {
        step: 'timezone',
        draft: { ...onboarding.draft, first_name: firstName },
      },
    });
    await sendTelegramMessage(env, chatId, 'Great. What is your timezone? (example: Asia/Kolkata)');
    return;
  }

  if (onboarding.step === 'timezone') {
    const timezone = input;
    await saveState(env, telegramId, 'idle', {
      onboarding: {
        step: 'calorie_goal',
        draft: { ...onboarding.draft, timezone },
      },
    });
    await sendTelegramMessage(env, chatId, 'What is your daily calorie goal? (example: 2000)');
    return;
  }

  if (onboarding.step === 'calorie_goal') {
    const calorieGoal = Number.parseInt(input, 10);
    if (!Number.isFinite(calorieGoal) || calorieGoal < 500 || calorieGoal > 10000) {
      await sendTelegramMessage(env, chatId, 'Please enter a valid calorie goal between 500 and 10000.');
      return;
    }

    const firstName = onboarding.draft.first_name || message.from?.first_name || 'User';
    const timezone = onboarding.draft.timezone || 'UTC';
    await saveUser(env, telegramId, firstName, timezone, calorieGoal);
    await saveState(env, telegramId, 'awaiting_food_input', {});

    await sendTelegramMessage(
      env,
      chatId,
      'Setup complete. Send food text like: 2 eggs scrambled + toast, and I will return nutrition breakdown.',
    );
  }
}

async function handleFoodInput(env: Env, message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const telegramId = String(message.from?.id ?? '');
  const text = (message.text || '').trim();

  if (!text) {
    await sendTelegramMessage(env, chatId, 'Please send a text food description.');
    return;
  }

  const extracted = await extractNutrition(env, text);
  const sessionId = crypto.randomUUID();
  const pendingLog: PendingLog = {
    session_id: sessionId,
    source_text: text,
    ai_raw_response: extracted.raw,
    items: extracted.items,
  };

  await saveState(env, telegramId, 'awaiting_food_input', { pending_log: pendingLog });
  await sendTelegramMessageWithKeyboard(env, chatId, formatPreview(extracted.items), buildInlineKeyboard(sessionId));
}

async function handleToday(env: Env, message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const telegramId = String(message.from?.id ?? '');
  const userId = await getUserIdByTelegramId(env, telegramId);

  if (!userId) {
    await sendTelegramMessage(env, chatId, 'Please complete /start first.');
    return;
  }

  const rows = await getTodayFoods(env, userId);

  if (rows.length === 0) {
    await sendTelegramMessage(env, chatId, 'No saved food logs for today yet.');
    return;
  }

  await sendTelegramMessage(env, chatId, buildTotalsMessage(rows));
}

async function handleDelete(env: Env, message: TelegramMessage, fullText: string): Promise<void> {
  const chatId = message.chat.id;
  const telegramId = String(message.from?.id ?? '');
  const nameToDelete = fullText.replace(/^\/delete\s*/i, '').trim();

  if (!nameToDelete) {
    await sendTelegramMessage(env, chatId, 'Usage: /delete <food_name>');
    return;
  }

  const userId = await getUserIdByTelegramId(env, telegramId);
  if (!userId) {
    await sendTelegramMessage(env, chatId, 'Please complete /start first.');
    return;
  }

  const deleted = await softDeleteFoodForToday(env, userId, nameToDelete);
  if (!deleted) {
    await sendTelegramMessage(env, chatId, `No matching food found for "${nameToDelete}" today.`);
    return;
  }

  await sendTelegramMessage(env, chatId, `Deleted (soft): ${deleted}`);
}

async function handleCallbackQuery(env: Env, callback: TelegramCallbackQuery): Promise<void> {
  const chatId = callback.message?.chat.id;
  const telegramId = String(callback.from.id);
  const data = callback.data || '';
  const [action, sessionId] = data.split('|');

  if (!chatId || !action || !sessionId) {
    await answerCallbackQuery(env, callback.id, 'Invalid action.');
    return;
  }

  const state = await getState(env, telegramId);
  const pending = state.context.pending_log;

  if (!pending || pending.session_id !== sessionId) {
    await answerCallbackQuery(env, callback.id, 'This button is stale.');
    await sendTelegramMessage(env, chatId, 'That action has expired. Please send your food text again.');
    return;
  }

  if (action === 'cancel') {
    await saveState(env, telegramId, 'awaiting_food_input', {});
    await answerCallbackQuery(env, callback.id, 'Cancelled.');
    await sendTelegramMessage(env, chatId, 'Cancelled. Send a new food text when ready.');
    return;
  }

  if (action === 'save') {
    await saveFoodLog(env, telegramId, pending);
    await saveState(env, telegramId, 'awaiting_food_input', {});
    await answerCallbackQuery(env, callback.id, 'Saved.');
    await sendTelegramMessage(env, chatId, 'Saved. Use /today to view totals.');
    return;
  }

  await answerCallbackQuery(env, callback.id, 'Unknown action.');
}

export async function handleTelegramUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
    return;
  }

  const message = update.message;
  if (!message?.from) {
    return;
  }

  const text = (message.text || '').trim();
  if (!text) {
    await sendTelegramMessage(env, message.chat.id, 'Send a text message to continue.');
    return;
  }

  if (text === '/start') {
    await handleStart(env, message);
    return;
  }

  if (text === '/today') {
    await handleToday(env, message);
    return;
  }

  if (text.toLowerCase().startsWith('/delete')) {
    await handleDelete(env, message, text);
    return;
  }

  const telegramId = String(message.from.id);
  const state = await getState(env, telegramId);
  if (state.state !== 'awaiting_food_input') {
    await handleOnboarding(env, message, state);
    return;
  }

  await handleFoodInput(env, message);
}
