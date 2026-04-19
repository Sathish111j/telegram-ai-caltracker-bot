import {
  getState,
  getTodayFoods,
  getUserIdByTelegramId,
  saveFoodLog,
  saveState,
  saveUser,
  softDeleteFoodForToday,
} from '../data/db.js';
import { extractFoodFromInput } from '../services/ai.js';
import {
  answerCallbackQuery,
  editMessageReplyMarkup,
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
} from '../services/telegram.js';
import {
  type Env,
  type FoodItem,
  type MealType,
  type OnboardingContext,
  type PendingLog,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from '../types/index.js';

const timezoneChoices = [
  { label: 'India', value: 'Asia/Kolkata' },
  { label: 'USA (Eastern)', value: 'America/New_York' },
  { label: 'UK', value: 'Europe/London' },
  { label: 'UAE', value: 'Asia/Dubai' },
] as const;

function mapTimezoneInput(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const direct = timezoneChoices.find((choice) => normalized === choice.label.toLowerCase());
  if (direct) {
    return direct.value;
  }

  if (normalized === 'usa' || normalized === 'us' || normalized === 'america') {
    return 'America/New_York';
  }

  return input.trim();
}

function buildInlineKeyboard(sessionId: string): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: 'Save', callback_data: `save|${sessionId}` },
        { text: 'Cancel', callback_data: `cancel|${sessionId}` },
      ],
    ],
  };
}

function buildMealSelectionKeyboard(sessionId: string): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: 'Breakfast', callback_data: `meal|breakfast|${sessionId}` },
        { text: 'Lunch', callback_data: `meal|lunch|${sessionId}` },
      ],
      [
        { text: 'Dinner', callback_data: `meal|dinner|${sessionId}` },
        { text: 'Others', callback_data: `meal|others|${sessionId}` },
      ],
      [{ text: 'Cancel', callback_data: `meal_cancel|${sessionId}` }],
    ],
  };
}

function buildTimezoneKeyboard(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: 'India', callback_data: 'tz|india' },
        { text: 'USA (Eastern)', callback_data: 'tz|usa_eastern' },
      ],
      [
        { text: 'UK', callback_data: 'tz|uk' },
        { text: 'UAE', callback_data: 'tz|uae' },
      ],
    ],
  };
}

function timezoneFromToken(token: string): string | null {
  switch (token) {
    case 'india':
      return 'Asia/Kolkata';
    case 'usa_eastern':
      return 'America/New_York';
    case 'uk':
      return 'Europe/London';
    case 'uae':
      return 'Asia/Dubai';
    default:
      return null;
  }
}

function mealTypeLabel(mealType: MealType | null | undefined): string {
  switch (mealType) {
    case 'breakfast':
      return 'Breakfast';
    case 'lunch':
      return 'Lunch';
    case 'dinner':
      return 'Dinner';
    default:
      return 'Others';
  }
}

function formatPreview(items: FoodItem[], mealNotes?: string | null): string {
  const lines = ['Review your extracted food log:'];
  items.forEach((item, idx) => {
    lines.push(
      `${idx + 1}. ${item.quantity} ${item.unit} ${item.name} - ${item.calories_kcal ?? '?'} kcal | Protein ${item.protein_g ?? '?'}g | Carbs ${item.carbs_g ?? '?'}g | Fat ${item.fat_g ?? '?'}g`,
    );
  });

  if (mealNotes) {
    lines.push('');
    lines.push(`Notes: ${mealNotes}`);
  }

  lines.push('');
  const totals = items.reduce(
    (acc, item) => ({
      calories: acc.calories + (item.calories_kcal ?? 0),
      protein: acc.protein + (item.protein_g ?? 0),
      carbs: acc.carbs + (item.carbs_g ?? 0),
      fat: acc.fat + (item.fat_g ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  lines.push(
    `Meal totals: ${Math.round(totals.calories)} kcal | Protein ${Math.round(totals.protein)}g | Carbs ${Math.round(totals.carbs)}g | Fat ${Math.round(totals.fat)}g`,
  );
  lines.push('Save this log?');

  return lines.join('\n');
}

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

  const groups: MealType[] = ['breakfast', 'lunch', 'dinner', 'others'];
  const groupedRows = groups.map((meal) => ({
    meal,
    rows: rows.filter((row) => (row.meal_type ?? 'others') === meal),
  }));

  const lines = ["Today's food logs:"];
  for (const group of groupedRows) {
    if (group.rows.length === 0) {
      continue;
    }
    lines.push('');
    lines.push(`${mealTypeLabel(group.meal)}:`);
    group.rows.forEach((row, index) => {
      const quantityPrefix = row.quantity && row.unit ? `${row.quantity} ${row.unit} ` : '';
      lines.push(
        `${index + 1}. ${quantityPrefix}${row.food_name} - ${row.calories ?? '?'} kcal | Protein ${row.protein_g ?? '?'}g | Carbs ${row.carbs_g ?? '?'}g | Fat ${row.fat_g ?? '?'}g`,
      );
    });
  }

  lines.push('');
  lines.push(
    `Daily totals: ${Math.round(totals.calories)} kcal | P ${Math.round(totals.protein)}g | C ${Math.round(totals.carbs)}g | F ${Math.round(totals.fat)}g`,
  );

  return lines.join('\n');
}

function buildSavedMealMessage(pending: PendingLog): string {
  const totalCalories = pending.items.reduce((acc, item) => acc + (item.calories_kcal ?? 0), 0);

  const lines = ['Meal saved successfully.', ''];
  pending.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.quantity} ${item.unit} ${item.name}`);
  });

  lines.push('');
  lines.push(`Saved total calories: ${Math.round(totalCalories)} kcal`);

  return lines.join('\n');
}

function clearAwaitingLogText(context: OnboardingContext): OnboardingContext {
  const { awaiting_log_text: _ignored, ...rest } = context;
  return rest;
}

async function processLogTextWithMealSelection(env: Env, message: TelegramMessage, logText: string): Promise<void> {
  const telegramId = String(message.from?.id ?? '');
  const state = await getState(env, telegramId);

  if (state.context.pending_meal_selection) {
    await sendTelegramMessage(
      env,
      message.chat.id,
      'A meal type selection is already pending. Please select one from the existing buttons first.',
    );
    return;
  }
  if (state.context.pending_log) {
    await sendTelegramMessage(
      env,
      message.chat.id,
      'You have a pending food log awaiting confirmation. Please save or cancel it first.',
    );
    return;
  }

  await sendTelegramMessage(env, message.chat.id, 'Processing your food details. Please wait...');
  const extracted = await extractFoodFromInput(env, logText);
  if (extracted.parsed.items.length === 0) {
    await sendTelegramMessage(env, message.chat.id, 'I could not identify any food items. Please try /log again with more detail.');
    return;
  }

  const sessionId = crypto.randomUUID();
  const pendingLog: PendingLog = {
    session_id: sessionId,
    source_text: logText,
    ai_raw_response: extracted.raw,
    items: extracted.parsed.items,
    meal_notes: extracted.parsed.meal_notes,
  };

  await saveState(env, telegramId, 'awaiting_food_input', {
    pending_log: pendingLog,
    pending_meal_selection: {
      session_id: sessionId,
      source_text: logText,
    },
  });
  await sendTelegramMessageWithKeyboard(
    env,
    message.chat.id,
    'Choose meal type to continue:',
    buildMealSelectionKeyboard(sessionId),
  );
}

async function startOnboarding(env: Env, telegramId: string, chatId: number): Promise<void> {
  await saveState(env, telegramId, 'onboarding', {
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

async function handleStart(env: Env, message: TelegramMessage): Promise<void> {
  const telegramId = String(message.from?.id ?? '');
  const chatId = message.chat.id;
  const userId = await getUserIdByTelegramId(env, telegramId);
  const state = await getState(env, telegramId);

  if (userId) {
    if (state.state === 'onboarding' || state.context.onboarding) {
      console.warn('existing user has onboarding state; normalizing to awaiting_food_input', { telegramId });
    }

    const hasPending = Boolean(state.context.pending_log);
    await saveState(env, telegramId, 'awaiting_food_input', state.context);
    await sendTelegramMessage(
      env,
      chatId,
      hasPending
        ? 'You are already set up. Your pending food confirmation is still active.'
        : 'You are already set up. Send food text any time to log your meals.',
    );
    return;
  }

  await startOnboarding(env, telegramId, chatId);
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
    await startOnboarding(env, telegramId, chatId);
    return;
  }

  if (onboarding.step === 'name') {
    const firstName = input || message.from?.first_name || 'User';
    await saveState(env, telegramId, 'onboarding', {
      onboarding: {
        step: 'timezone',
        draft: { ...onboarding.draft, first_name: firstName },
      },
    });
    await sendTelegramMessageWithKeyboard(
      env,
      chatId,
      [
        'Great. Choose your timezone:',
        'Tap one option below, or send a custom value like Asia/Kolkata.',
      ].join('\n'),
      buildTimezoneKeyboard(),
    );
    return;
  }

  if (onboarding.step === 'timezone') {
    const timezone = mapTimezoneInput(input);
    await saveState(env, telegramId, 'onboarding', {
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
      [
        'Setup complete.',
        '',
        'Use /log to add a meal.',
        'After /log, I will ask you to enter your meal text.',
        'Example meal text: 2 eggs scrambled + toast.',
        '',
        'Use /today to see today\'s saved food logs and totals.',
      ].join('\n'),
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

  const state = await getState(env, telegramId);
  if (state.context.pending_meal_selection) {
    await sendTelegramMessage(
      env,
      chatId,
      'Please select meal type from the buttons above before I process this log.',
    );
    return;
  }

  if (state.context.pending_log) {
    await sendTelegramMessage(
      env,
      chatId,
      'You have a pending food log awaiting confirmation. Please save or cancel it first.',
    );
    return;
  }

  const extracted = await extractFoodFromInput(env, text);
  if (extracted.parsed.items.length === 0) {
    await sendTelegramMessage(env, chatId, 'I could not identify any food items. Please try again with more detail.');
    return;
  }

  const sessionId = crypto.randomUUID();
  const pendingLog: PendingLog = {
    session_id: sessionId,
    source_text: text,
    ai_raw_response: extracted.raw,
    items: extracted.parsed.items,
    meal_notes: extracted.parsed.meal_notes,
  };

  await saveState(env, telegramId, 'awaiting_food_input', { pending_log: pendingLog });
  await sendTelegramMessageWithKeyboard(
    env,
    chatId,
    formatPreview(extracted.parsed.items, extracted.parsed.meal_notes),
    buildInlineKeyboard(sessionId),
  );
}

async function handleLogCommand(env: Env, message: TelegramMessage): Promise<void> {
  const text = (message.text || '').trim();
  const logText = text.replace(/^\/log\s*/i, '').trim();
  const telegramId = String(message.from?.id ?? '');
  const state = await getState(env, telegramId);

  if (state.context.pending_meal_selection) {
    await sendTelegramMessage(
      env,
      message.chat.id,
      'A meal type selection is already pending. Please select one from the existing buttons first.',
    );
    return;
  }
  if (state.context.pending_log) {
    await sendTelegramMessage(
      env,
      message.chat.id,
      'You have a pending food log awaiting confirmation. Please save or cancel it first.',
    );
    return;
  }

  if (!logText) {
    await saveState(env, telegramId, 'awaiting_food_input', {
      ...clearAwaitingLogText(state.context),
      awaiting_log_text: true,
    });
    await sendTelegramMessage(
      env,
      message.chat.id,
      [
        'Please enter your meal text now.',
        'Example: 2 eggs and toast',
      ].join('\n'),
    );
    return;
  }

  await processLogTextWithMealSelection(env, message, logText);
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

async function clearInlineKeyboard(env: Env, callback: TelegramCallbackQuery): Promise<void> {
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;
  if (!chatId || !messageId) {
    return;
  }

  try {
    await editMessageReplyMarkup(env, chatId, messageId, { inline_keyboard: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('message is not modified')) {
      console.error('failed to clear reply markup', error);
    }
  }
}

async function handleCallbackQuery(env: Env, callback: TelegramCallbackQuery): Promise<void> {
  const chatId = callback.message?.chat.id;
  const telegramId = String(callback.from.id);
  const data = callback.data || '';
  const [action, arg1, arg2] = data.split('|');

  if (!chatId || !action) {
    await answerCallbackQuery(env, callback.id, 'Invalid action.');
    return;
  }

  if (action === 'meal_cancel') {
    const sessionId = arg1;
    const state = await getState(env, telegramId);
    const pendingSelection = state.context.pending_meal_selection;
    if (!sessionId || !pendingSelection || pendingSelection.session_id !== sessionId) {
      await answerCallbackQuery(env, callback.id, 'This button is stale.');
      await clearInlineKeyboard(env, callback);
      return;
    }
    await answerCallbackQuery(env, callback.id, 'Cancelled.');
    await clearInlineKeyboard(env, callback);
    await saveState(env, telegramId, 'awaiting_food_input', {});
    await sendTelegramMessage(env, chatId, 'Log cancelled. Send /log again when ready.');
    return;
  }

  if (action === 'tz') {
    const timezone = arg1 ? timezoneFromToken(arg1) : null;
    if (!timezone) {
      await answerCallbackQuery(env, callback.id, 'Invalid timezone selection.');
      return;
    }

    const state = await getState(env, telegramId);
    const onboarding = state.context.onboarding;
    if (!onboarding || onboarding.step !== 'timezone') {
      await answerCallbackQuery(env, callback.id, 'This selection is no longer active.');
      await clearInlineKeyboard(env, callback);
      return;
    }

    await answerCallbackQuery(env, callback.id, 'Timezone selected.');
    await clearInlineKeyboard(env, callback);
    await saveState(env, telegramId, 'onboarding', {
      onboarding: {
        step: 'calorie_goal',
        draft: { ...onboarding.draft, timezone },
      },
    });
    await sendTelegramMessage(env, chatId, 'What is your daily calorie goal? (example: 2000)');
    return;
  }

  if (action === 'meal') {
    const mealType = arg1 as MealType | undefined;
    const sessionId = arg2;
    if (!mealType || !sessionId || !['breakfast', 'lunch', 'dinner', 'others'].includes(mealType)) {
      await answerCallbackQuery(env, callback.id, 'Invalid meal selection.');
      return;
    }

    const state = await getState(env, telegramId);
    const pendingSelection = state.context.pending_meal_selection;
    const pending = state.context.pending_log;
    if (!pendingSelection || pendingSelection.session_id !== sessionId) {
      await answerCallbackQuery(env, callback.id, 'This button is stale.');
      await clearInlineKeyboard(env, callback);
      return;
    }

    if (!pending || pending.session_id !== sessionId) {
      await answerCallbackQuery(env, callback.id, 'This log expired. Please send /log again.');
      await clearInlineKeyboard(env, callback);
      await saveState(env, telegramId, 'awaiting_food_input', {});
      return;
    }

    await answerCallbackQuery(env, callback.id, 'Done.');
    await clearInlineKeyboard(env, callback);
    const pendingLog: PendingLog = {
      ...pending,
      meal_type: mealType,
    };

    await saveState(env, telegramId, 'awaiting_food_input', { pending_log: pendingLog });
    await sendTelegramMessageWithKeyboard(
      env,
      chatId,
      formatPreview(pendingLog.items, pendingLog.meal_notes),
      buildInlineKeyboard(pendingLog.session_id),
    );
    return;
  }

  const sessionId = arg1;
  if (!sessionId) {
    await answerCallbackQuery(env, callback.id, 'Invalid action.');
    return;
  }

  const state = await getState(env, telegramId);
  const pending = state.context.pending_log;

  if (!pending || pending.session_id !== sessionId) {
    await answerCallbackQuery(env, callback.id, 'This button is stale.');
    await clearInlineKeyboard(env, callback);
    await sendTelegramMessage(env, chatId, 'That action has expired. Please send your food text again.');
    return;
  }

  if (action === 'cancel') {
    await answerCallbackQuery(env, callback.id, 'Cancelled.');
    await clearInlineKeyboard(env, callback);
    await saveState(env, telegramId, 'awaiting_food_input', {});
    await sendTelegramMessage(env, chatId, 'Cancelled. Send a new food text when ready.');
    return;
  }

  if (action === 'save') {
    await answerCallbackQuery(env, callback.id, 'Saving...');
    await clearInlineKeyboard(env, callback);
    await sendTelegramMessage(env, chatId, 'Saving your meal. Please wait...');
    await saveFoodLog(env, telegramId, pending);
    await saveState(env, telegramId, 'awaiting_food_input', {});
    await sendTelegramMessage(env, chatId, buildSavedMealMessage(pending));
    await sendTelegramMessage(env, chatId, 'Use /today to check today\'s full logs and totals.');
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

  if (text.toLowerCase() === '/log' || text.toLowerCase().startsWith('/log ')) {
    await handleLogCommand(env, message);
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
  const userId = await getUserIdByTelegramId(env, telegramId);
  const state = await getState(env, telegramId);

  if (state.state === 'onboarding' || state.context.onboarding) {
    await handleOnboarding(env, message, state);
    return;
  }

  if (!userId) {
    await startOnboarding(env, telegramId, message.chat.id);
    return;
  }

  if (state.context.awaiting_log_text) {
    await saveState(env, telegramId, 'awaiting_food_input', clearAwaitingLogText(state.context));
    await processLogTextWithMealSelection(env, message, text);
    return;
  }

  await handleFoodInput(env, message);
}
