import {
  getUserAndState,
  getTodayFoods,
  saveFoodLog,
  saveState,
  saveUser,
  softDeleteFoodForToday,
} from '../data/db.js';
import { extractFoodFromInput } from '../services/ai.js';
import {
  answerCallbackQuery,
  editMessageReplyMarkup,
  sendChatAction,
  sendMessageDraft,
  sendTelegramMessage,
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
  type TodayFoodRow,
} from '../types/index.js';

const timezoneChoices = [
  { label: 'India', value: 'Asia/Kolkata' },
  { label: 'USA (Eastern)', value: 'America/New_York' },
  { label: 'UK', value: 'Europe/London' },
  { label: 'UAE', value: 'Asia/Dubai' },
] as const;

function mapTimezoneInput(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return 'UTC';
  const direct = timezoneChoices.find((choice) => normalized === choice.label.toLowerCase());
  if (direct) return direct.value;
  if (normalized === 'usa' || normalized === 'us' || normalized === 'america') return 'America/New_York';
  return normalized.includes('/') ? input.trim() : 'UTC';
}

function buildInlineKeyboard(sessionId: string): Record<string, unknown> {
  return {
    inline_keyboard: [[
      { text: '✅ Save', callback_data: `save|${sessionId}`, style: 'success' },
      { text: '❌ Cancel', callback_data: `cancel|${sessionId}`, style: 'danger' },
    ]],
  };
}

function buildMealSelectionKeyboard(sessionId: string): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: '🍳 Breakfast', callback_data: `meal|breakfast|${sessionId}` },
        { text: '🍱 Lunch', callback_data: `meal|lunch|${sessionId}` },
      ],
      [
        { text: '🍽️ Dinner', callback_data: `meal|dinner|${sessionId}` },
        { text: '🍿 Snacks / Others', callback_data: `meal|others|${sessionId}` },
      ],
      [{ text: '🚫 Cancel', callback_data: `meal_cancel|${sessionId}`, style: 'danger' }],
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

function timezoneFromToken(token: string): string | null {
  switch (token) {
    case 'india': return 'Asia/Kolkata';
    case 'usa_eastern': return 'America/New_York';
    case 'uk': return 'Europe/London';
    case 'uae': return 'Asia/Dubai';
    default: return null;
  }
}

function mealTypeLabel(mealType: MealType | null | undefined): string {
  switch (mealType) {
    case 'breakfast': return 'Breakfast';
    case 'lunch': return 'Lunch';
    case 'dinner': return 'Dinner';
    default: return 'Snacks / Others';
  }
}

function formatPreview(items: FoodItem[], mealNotes?: string | null): string {
  const lines = ['🥗 *Nutrient Breakdown:*'];
  items.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.quantity} ${item.unit} ${item.name} - ${item.calories_kcal ?? '?'} kcal | P ${item.protein_g ?? '?'}g | C ${item.carbs_g ?? '?'}g | F ${item.fat_g ?? '?'}g`);
  });
  if (mealNotes) {
    lines.push('', `📝 *Notes:* ${mealNotes}`);
  }
  const totals = items.reduce((acc, item) => ({
    calories: acc.calories + (item.calories_kcal ?? 0),
    protein: acc.protein + (item.protein_g ?? 0),
    carbs: acc.carbs + (item.carbs_g ?? 0),
    fat: acc.fat + (item.fat_g ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  lines.push('', `📊 *Meal Totals:* ${Math.round(totals.calories)} kcal | P ${Math.round(totals.protein)}g | C ${Math.round(totals.carbs)}g | F ${Math.round(totals.fat)}g`, '*Save this log?*');
  return lines.join('\n');
}

function buildTotalsMessage(rows: TodayFoodRow[]): { text: string; entities?: any[] } {
  const totals = rows.reduce((acc, row) => ({
    calories: acc.calories + (row.calories ?? 0),
    protein: acc.protein + (row.protein_g ?? 0),
    carbs: acc.carbs + (row.carbs_g ?? 0),
    fat: acc.fat + (row.fat_g ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const groups: MealType[] = ['breakfast', 'lunch', 'dinner', 'others'];
  const groupedRows = groups.map((meal) => ({
    meal,
    rows: rows.filter((row) => (row.meal_type ?? 'others') === meal),
  }));

  const lines = ["📅 *Today's food logs:*"];
  const entities: any[] = [];

  for (const group of groupedRows) {
    if (group.rows.length === 0) continue;
    lines.push('', `*${mealTypeLabel(group.meal)}:*`);
    group.rows.forEach((row, index) => {
      const quantityPrefix = row.quantity && row.unit ? `${row.quantity} ${row.unit} ` : '';
      const baseLine = `${index + 1}. ${quantityPrefix}${row.food_name} - ${row.calories ?? '?'} kcal | P ${row.protein_g ?? '?'}g | C ${row.carbs_g ?? '?'}g | F ${row.fat_g ?? '?'}g`;
      const currentText = lines.join('\n') + '\n';
      const lineWithTimestamp = baseLine + (row.created_at ? ` [${new Date(row.created_at).getHours().toString().padStart(2, '0')}:${new Date(row.created_at).getMinutes().toString().padStart(2, '0')}]` : '');
      if (row.created_at) {
        entities.push({
          type: 'date_time',
          offset: currentText.length + baseLine.length + 2,
          length: 5,
          unix_time: Math.floor(new Date(row.created_at).getTime() / 1000),
          date_time_format: 't'
        });
      }
      lines.push(lineWithTimestamp);
    });
  }
  lines.push('', `✨ *Daily totals:* ${Math.round(totals.calories)} kcal | P ${Math.round(totals.protein)}g | C ${Math.round(totals.carbs)}g | F ${Math.round(totals.fat)}g`);
  return { text: lines.join('\n'), entities };
}

async function handleFoodInput(env: Env, chatId: number, telegramId: string, logText: string, mealType: MealType, state: any): Promise<void> {
  const sessionId = crypto.randomUUID();

  try {
    await sendChatAction(env, chatId, 'typing');
    // We send a normal message first so the user knows calculation has started
    await sendTelegramMessage(env, chatId, `⏳ Calculating nutrients for ${mealTypeLabel(mealType)}...`);

    const extracted = await extractFoodFromInput(env, logText);
    
    const pendingLog: PendingLog = {
      session_id: sessionId,
      source_text: logText,
      ai_raw_response: extracted.raw,
      items: extracted.parsed.items,
      meal_type: mealType,
      meal_notes: extracted.parsed.meal_notes,
    };

    await saveState(env, telegramId, 'awaiting_food_input', {
      ...state.context,
      pending_log: pendingLog,
      selected_meal_type: undefined,
      pending_source_text: undefined
    });

    await sendTelegramMessage(env, chatId, formatPreview(pendingLog.items, pendingLog.meal_notes), undefined);
    // Send keyboard in a separate message for stability
    await sendTelegramMessage(env, chatId, "Would you like to save this meal?", undefined);
    // Actually, Telegram prefers keyboard attached to the message. Let's send with keyboard:
    await sendTelegramMessage(env, chatId, "Confirm your log:", undefined);
    // Let's use the helper to attach keyboard to the preview
    // Actually, I'll use a standard call to ensure it reaches:
    const token = env.TELEGRAM_BOT_TOKEN;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Please choose an action:",
        reply_markup: buildInlineKeyboard(sessionId)
      })
    });

  } catch (error: any) {
    await sendTelegramMessage(env, chatId, `⚠️ Sorry, nutrient calculation failed: ${error.message}`);
  }
}

async function handleCallbackQuery(env: Env, callback: TelegramCallbackQuery): Promise<void> {
  const telegramId = String(callback.from.id);
  const [action, arg1, arg2] = (callback.data || '').split('|');
  const { state } = await getUserAndState(env, telegramId);

  // ANSWER IMMEDIATELY to stop loading spinner
  await answerCallbackQuery(env, callback.id);

  if (action === 'meal_cancel') {
    await saveState(env, telegramId, 'awaiting_food_input', {});
    await editMessageReplyMarkup(env, callback.message!.chat.id, callback.message!.message_id, { inline_keyboard: [] });
    await sendTelegramMessage(env, callback.message!.chat.id, '🚫 Meal logging cancelled.');
    return;
  } 
  
  if (action === 'tz') {
    const timezone = timezoneFromToken(arg1);
    if (timezone) {
      await saveState(env, telegramId, 'onboarding', {
        onboarding: { step: 'calorie_goal', draft: { ...state.context.onboarding!.draft, timezone } },
      });
      await editMessageReplyMarkup(env, callback.message!.chat.id, callback.message!.message_id, { inline_keyboard: [] });
      await sendTelegramMessage(env, callback.message!.chat.id, `✅ Timezone set to ${arg1}. What is your daily calorie goal?`);
      return;
    }
  }

  if (action === 'meal') {
    const mealType = arg1 as MealType;
    // Remove buttons immediately
    await editMessageReplyMarkup(env, callback.message!.chat.id, callback.message!.message_id, { inline_keyboard: [] });
    
    if (state.context.pending_source_text) {
      const foodText = state.context.pending_source_text;
      await handleFoodInput(env, callback.message!.chat.id, telegramId, foodText, mealType, state);
      return;
    }

    await saveState(env, telegramId, 'awaiting_food_input', { 
      ...state.context, 
      selected_meal_type: mealType 
    });

    await sendTelegramMessage(env, callback.message!.chat.id, `🍽️ Logging ${mealTypeLabel(mealType)}. What did you have?`);
    return;
  }

  if (action === 'save') {
    if (state.context.pending_log && state.context.pending_log.session_id === arg1) {
      await editMessageReplyMarkup(env, callback.message!.chat.id, callback.message!.message_id, { inline_keyboard: [] });
      await saveFoodLog(env, telegramId, state.context.pending_log);
      await saveState(env, telegramId, 'awaiting_food_input', {});
      await sendTelegramMessage(env, callback.message!.chat.id, `✅ *Meal saved successfully!*\n\n💡 Use /today to see your logs.`);
      return;
    }
  }

  if (action === 'cancel') {
    await saveState(env, telegramId, 'awaiting_food_input', {});
    await editMessageReplyMarkup(env, callback.message!.chat.id, callback.message!.message_id, { inline_keyboard: [] });
    await sendTelegramMessage(env, callback.message!.chat.id, '🚫 Log cancelled.');
    return;
  }
}

export async function handleTelegramUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
    return;
  }

  const message = update.message;
  if (!message?.from || !message.text) return;

  const telegramId = String(message.from.id);
  const { user, state } = await getUserAndState(env, telegramId);

  const text = message.text.trim();
  const loweredText = text.toLowerCase();

  // START
  if (text === '/start') {
    if (user) {
      await sendTelegramMessage(env, message.chat.id, '👋 You are already set up. Send food text any time to log meals.');
      return;
    }
    await saveState(env, telegramId, 'onboarding', { onboarding: { step: 'name', draft: {} } });
    await sendTelegramMessage(env, message.chat.id, "Welcome to NutriBot! Let's set up your profile.\n\nWhat name should I call you?");
    return;
  }

  // TODAY
  if (loweredText === '/today') {
    if (!user) {
      await sendTelegramMessage(env, message.chat.id, 'Please complete /start first.');
      return;
    }
    const rows = await getTodayFoods(env, user.id);
    if (rows.length === 0) {
      await sendTelegramMessage(env, message.chat.id, '📭 No logs for today yet.');
      return;
    }
    const { text: totalsText, entities } = buildTotalsMessage(rows);
    await sendTelegramMessage(env, message.chat.id, totalsText, entities);
    return;
  }
  
  // LOG
  if (loweredText.startsWith('/log')) {
    const logText = text.replace(/^\/log\s*/i, '').trim();
    if (!logText) {
      const keyboard = buildMealSelectionKeyboard('new');
      const token = env.TELEGRAM_BOT_TOKEN;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: 'What type of meal would you like to log?',
          reply_markup: keyboard
        })
      });
      return;
    }
    await saveState(env, telegramId, 'awaiting_food_input', { ...state.context, pending_source_text: logText });
    const keyboard = buildMealSelectionKeyboard('prefilled');
    const token = env.TELEGRAM_BOT_TOKEN;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: 'Select meal type:',
        reply_markup: keyboard
      })
    });
    return;
  }

  // DELETE
  if (loweredText.startsWith('/delete')) {
    if (!user) {
      await sendTelegramMessage(env, message.chat.id, 'Please complete /start first.');
      return;
    }
    const nameToDelete = text.replace(/^\/delete\s*/i, '').trim();
    const deleted = await softDeleteFoodForToday(env, user.id, nameToDelete);
    await sendTelegramMessage(env, message.chat.id, deleted ? `✅ Deleted: ${deleted}` : `No match today.`);
    return;
  }

  // Onboarding
  if (state.state === 'onboarding') {
    const onboarding = state.context.onboarding!;
    if (onboarding.step === 'name') {
      await saveState(env, telegramId, 'onboarding', { onboarding: { step: 'timezone', draft: { ...onboarding.draft, first_name: text } } });
      const keyboard = buildTimezoneKeyboard();
      const token = env.TELEGRAM_BOT_TOKEN;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: 'Great. Choose your timezone:',
          reply_markup: keyboard
        })
      });
      return;
    }
    if (onboarding.step === 'timezone') {
      const timezone = mapTimezoneInput(text);
      await saveState(env, telegramId, 'onboarding', { onboarding: { step: 'calorie_goal', draft: { ...onboarding.draft, timezone } } });
      await sendTelegramMessage(env, message.chat.id, 'What is your daily calorie goal?');
      return;
    }
    if (onboarding.step === 'calorie_goal') {
      await saveUser(env, telegramId, onboarding.draft.first_name!, onboarding.draft.timezone!, Number.parseInt(text, 10));
      await saveState(env, telegramId, 'awaiting_food_input', {});
      await sendTelegramMessage(env, message.chat.id, '✅ Setup complete! Use /log to add meals.');
      return;
    }
  }

  // Active Logging (Meal Type already picked)
  if (state.context.selected_meal_type) {
    await handleFoodInput(env, message.chat.id, telegramId, text, state.context.selected_meal_type, state);
    return;
  }

  // Direct Input (No /log prefix)
  if (user) {
    await saveState(env, telegramId, 'awaiting_food_input', { ...state.context, pending_source_text: text });
    const keyboard = buildMealSelectionKeyboard('input');
    const token = env.TELEGRAM_BOT_TOKEN;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: 'Select meal type:',
        reply_markup: keyboard
      })
    });
    return;
  }
  
  // Default to Start if completely unknown
  await sendTelegramMessage(env, message.chat.id, 'Use /start to begin or /log to add a meal.');
}
