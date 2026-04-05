import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const simRoot = path.join(root, '.sim-dist');

function writeStub(relativePath, content) {
  const fullPath = path.join(simRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function installStubs() {
  writeStub(
    path.join('data', 'db.js'),
    `const state = {
  users: new Map(),
  conv: new Map(),
  foodLogs: [],
  supplementLogs: [],
  weights: [],
  aiCalls: [],
  sentReports: [],
  nextFoodLogId: 1,
  nextFoodItemId: 1,
  supplementProfiles: [
    { id: 'supp-1', user_id: 'user-1', name: 'Creatine', dose_per_serving: 5, is_active: true },
  ],
};

function todayInTimezone(tz = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function ensureUserId(telegramId) {
  return [...state.users.values()].find((u) => u.telegram_id === BigInt(telegramId))?.id ?? null;
}

function getUserRecordById(userId) {
  return [...state.users.values()].find((u) => u.id === userId) ?? null;
}

export async function getState(_env, telegramId) {
  return state.conv.get(String(telegramId)) ?? { state: 'idle', context: {} };
}

export async function saveState(_env, telegramId, nextState, context) {
  state.conv.set(String(telegramId), { state: nextState, context, updatedAt: Date.now() });
}

export async function resetToIdle(telegramId, _env) {
  state.conv.set(String(telegramId), { state: 'idle', context: {}, updatedAt: Date.now() });
}

export async function checkStateTimeout(telegramId, env) {
  const current = state.conv.get(String(telegramId));
  if (!current) return 'idle';
  const timeoutMinutes = Number.parseInt(env.STATE_TIMEOUT_MINUTES ?? '20', 10);
  if (Date.now() - (current.updatedAt ?? 0) > timeoutMinutes * 60_000) {
    await resetToIdle(telegramId, env);
    return 'idle';
  }
  return current.state;
}

export async function checkRateLimit() { return true; }
export async function checkTempBlock() { return false; }

export async function getUserByTelegramId(_env, telegramId) {
  return state.users.get(String(telegramId)) ?? null;
}

export async function saveUser(_env, telegramId, firstName, timezone, calorieGoal) {
  const existing = state.users.get(String(telegramId));
  const user = {
    id: existing?.id ?? \`user-\${state.users.size + 1}\`,
    telegram_id: BigInt(telegramId),
    onboarded: true,
    timezone,
    ai_calls_today: existing?.ai_calls_today ?? 0,
    daily_ai_limit: existing?.daily_ai_limit ?? 20,
    ai_calls_reset_date: todayInTimezone(timezone),
    first_name: firstName,
    calorie_goal: calorieGoal,
  };
  state.users.set(String(telegramId), user);
}

export async function checkAIQuota(_env, user) {
  return { allowed: user.ai_calls_today < user.daily_ai_limit, remaining: Math.max(0, user.daily_ai_limit - user.ai_calls_today) };
}

export async function incrementUserAiCalls(_env, userId) {
  const user = getUserRecordById(userId);
  if (user) user.ai_calls_today += 1;
}

export async function recordAiCall(_env, userId, telegramId, keyLabel, callType, tokens, latencyMs, success) {
  state.aiCalls.push({ userId, telegramId: String(telegramId), keyLabel, callType, tokens, latencyMs, success });
}

export async function saveFoodLog(_env, userId, sessionId, aiRawResponse, mealType, logDate, items, dataSource) {
  const log = {
    id: state.nextFoodLogId++,
    user_id: userId,
    session_id: sessionId,
    ai_raw_response: aiRawResponse,
    meal_type: mealType,
    log_date: logDate,
    confirmed: true,
    is_deleted: false,
    created_at: new Date().toISOString(),
    items: items.map((item) => ({ ...item, id: state.nextFoodItemId++, data_source: dataSource, is_deleted: false })),
  };
  state.foodLogs.push(log);
}

export async function getFoodsByDate(_env, userId, logDate) {
  return state.foodLogs
    .filter((log) => log.user_id === userId && log.log_date === logDate && !log.is_deleted)
    .flatMap((log) =>
      log.items
        .filter((item) => !item.is_deleted)
        .map((item) => ({
          food_name: item.name,
          calories_kcal: item.calories_kcal ?? null,
          protein_g: item.protein_g ?? null,
          carbs_g: item.carbs_g ?? null,
          fat_g: item.fat_g ?? null,
        })),
    );
}

export async function getLoggedItemsByDate(_env, userId, logDate, limit = 25) {
  return state.foodLogs
    .filter((log) => log.user_id === userId && log.log_date === logDate && !log.is_deleted)
    .flatMap((log) => log.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      calories_kcal: item.calories_kcal ?? null,
      protein_g: item.protein_g ?? null,
      carbs_g: item.carbs_g ?? null,
      fat_g: item.fat_g ?? null,
    })))
    .slice(0, limit);
}

export async function updateLoggedItemQuantity(_env, userId, itemId, newQuantity) {
  const log = state.foodLogs.find((entry) => entry.user_id === userId && entry.items.some((item) => item.id === itemId));
  if (!log) return false;
  const item = log.items.find((entry) => entry.id === itemId);
  if (!item) return false;
  const scale = item.quantity === 0 ? 1 : newQuantity / item.quantity;
  item.quantity = newQuantity;
  for (const key of Object.keys(item)) {
    if (key.endsWith('_kcal') || key.endsWith('_g') || key.endsWith('_mg') || key.endsWith('_mcg') || key.startsWith('glycemic_')) {
      if (typeof item[key] === 'number') item[key] = Number((item[key] * scale).toFixed(2));
    }
  }
  item.is_edited = true;
  return true;
}

export async function checkDuplicateItems() { return []; }

export async function getHistoryTopItems(_env, userId, limit = 20) {
  return state.foodLogs
    .filter((log) => log.user_id === userId)
    .flatMap((log) => log.items)
    .slice(0, limit)
    .map((item) => ({ ...item }));
}

export async function searchCommonLibrary(_env, query) {
  if (!query.toLowerCase().includes('rice')) return [];
  return [{
    name: 'Boiled Rice',
    quantity: 100,
    unit: 'g',
    calories_kcal: 130,
    protein_g: 2.7,
    carbs_g: 28,
    fat_g: 0.3,
    fiber_g: 0.4,
    sugar_g: null,
    net_carbs_g: null,
    saturated_fat_g: null,
    trans_fat_g: null,
    monounsaturated_fat_g: null,
    polyunsaturated_fat_g: null,
    cholesterol_mg: null,
    sodium_mg: null,
    potassium_mg: null,
    calcium_mg: null,
    iron_mg: null,
    magnesium_mg: null,
    phosphorus_mg: null,
    zinc_mg: null,
    selenium_mcg: null,
    vitamin_a_mcg: null,
    vitamin_c_mg: null,
    vitamin_d_mcg: null,
    vitamin_e_mg: null,
    vitamin_k_mcg: null,
    vitamin_b1_mg: null,
    vitamin_b2_mg: null,
    vitamin_b3_mg: null,
    vitamin_b5_mg: null,
    vitamin_b6_mg: null,
    vitamin_b9_mcg: null,
    vitamin_b12_mcg: null,
    glycemic_index: null,
    glycemic_load: null,
    omega3_g: null,
    omega6_g: null,
    water_content_g: null,
    confidence_score: 0.95,
    notes: null,
  }];
}

export async function findSupplementMatch(_env, userId, term) {
  const profile = state.supplementProfiles.find((item) => item.user_id === userId && item.name.toLowerCase().includes(term.toLowerCase()));
  return profile ? { ...profile, calories_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 } : null;
}

export async function saveSupplementLog(_env, userId, profileId, servings) {
  state.supplementLogs.push({ userId, profileId, servings });
}

export async function saveWeightCheckin(_env, userId, weightKg) {
  state.weights.push({ userId, weightKg });
}

export async function getExportFoodRows(_env, userId, startDate, endDate) {
  return state.foodLogs
    .filter((log) => log.user_id === userId && log.log_date >= startDate && log.log_date <= endDate)
    .flatMap((log) => log.items.map((item) => ({
      log_date: log.log_date,
      meal_type: log.meal_type,
      food_name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      created_at: log.created_at,
      calories_kcal: item.calories_kcal ?? 0,
      protein_g: item.protein_g ?? 0,
      carbs_g: item.carbs_g ?? 0,
      fat_g: item.fat_g ?? 0,
      fiber_g: item.fiber_g ?? 0,
      sugar_g: item.sugar_g ?? 0,
      net_carbs_g: item.net_carbs_g ?? 0,
      saturated_fat_g: item.saturated_fat_g ?? 0,
      trans_fat_g: item.trans_fat_g ?? 0,
      monounsaturated_fat_g: item.monounsaturated_fat_g ?? 0,
      polyunsaturated_fat_g: item.polyunsaturated_fat_g ?? 0,
      cholesterol_mg: item.cholesterol_mg ?? 0,
      sodium_mg: item.sodium_mg ?? 0,
      potassium_mg: item.potassium_mg ?? 0,
      calcium_mg: item.calcium_mg ?? 0,
      iron_mg: item.iron_mg ?? 0,
      magnesium_mg: item.magnesium_mg ?? 0,
      phosphorus_mg: item.phosphorus_mg ?? 0,
      zinc_mg: item.zinc_mg ?? 0,
      selenium_mcg: item.selenium_mcg ?? 0,
      vitamin_a_mcg: item.vitamin_a_mcg ?? 0,
      vitamin_c_mg: item.vitamin_c_mg ?? 0,
      vitamin_d_mcg: item.vitamin_d_mcg ?? 0,
      vitamin_e_mg: item.vitamin_e_mg ?? 0,
      vitamin_k_mcg: item.vitamin_k_mcg ?? 0,
      vitamin_b1_mg: item.vitamin_b1_mg ?? 0,
      vitamin_b2_mg: item.vitamin_b2_mg ?? 0,
      vitamin_b3_mg: item.vitamin_b3_mg ?? 0,
      vitamin_b5_mg: item.vitamin_b5_mg ?? 0,
      vitamin_b6_mg: item.vitamin_b6_mg ?? 0,
      vitamin_b9_mcg: item.vitamin_b9_mcg ?? 0,
      vitamin_b12_mcg: item.vitamin_b12_mcg ?? 0,
      glycemic_index: item.glycemic_index ?? 0,
      glycemic_load: item.glycemic_load ?? 0,
      omega3_g: item.omega3_g ?? 0,
      omega6_g: item.omega6_g ?? 0,
      water_content_g: item.water_content_g ?? 0,
    })));
}

export async function getExportDailyTotals() { return []; }
export async function getExportWeeklyAverages() { return []; }
export async function getExportMicronutrientHeatmap() { return []; }
export async function getExportSupplementRows() { return []; }
export async function getExportGoalContext() {
  return {
    calorie_goal: 2000,
    protein_goal_g: 120,
    carb_goal_g: 200,
    fat_goal_g: 70,
    fiber_goal_g: 30,
  };
}

export async function getDailySummary() { return { lines: ['Daily report'], hasData: false }; }
export async function getDueDailyReportTelegramIds() { return []; }
export async function getDueWeeklyReportTelegramIds() { return []; }
export async function getWeeklySummary() { return { lines: ['Weekly report'], hasData: false }; }
export async function getMealGapTelegramIds() { return []; }
export async function markReportSent(_env, telegramId, reportType) { state.sentReports.push({ telegramId: String(telegramId), reportType }); }
export async function resetDailyAiCounters() { return 0; }
export async function hardPurgeDeleted() { return { users: 0, food_logs: 0, food_items: 0, supplements: 0 }; }

export { state as __dbState, todayInTimezone };
`,
  );

  writeStub(
    path.join('services', 'telegram.js'),
    `const state = {
  events: [],
  nextMessageId: 1,
};

function push(kind, payload) {
  const event = { kind, ...payload };
  state.events.push(event);
  return event;
}

export async function downloadTelegramPhotoBase64() {
  return 'ZmFrZS1pbWFnZQ==';
}

export async function sendTelegramMessage(_env, chatId, text) {
  return push('message', { chatId, text, message_id: state.nextMessageId++ });
}

export async function sendTelegramFormattedMessage(_env, chatId, text, options = {}) {
  return push('formatted', { chatId, text, options, message_id: state.nextMessageId++ });
}

export async function editTelegramMessage(_env, chatId, messageId, text, options = {}) {
  return push('edit', { chatId, messageId, text, options });
}

export async function sendTelegramMessageWithKeyboard(_env, chatId, text, replyMarkup, options = {}) {
  return push('keyboard', { chatId, text, replyMarkup, options, message_id: state.nextMessageId++ });
}

export async function answerCallbackQuery(_env, callbackQueryId, text) {
  return push('callback_answer', { callbackQueryId, text });
}

export async function sendTelegramChatAction(_env, chatId, action) {
  return push('chat_action', { chatId, action });
}

export async function sendTelegramMessageDraft(_env, chatId, draftId, text) {
  return push('draft', { chatId, draftId, text });
}

export async function sendTelegramDocument(_env, chatId, fileName, bytes, caption) {
  return push('document', { chatId, fileName, size: bytes.length, caption, message_id: state.nextMessageId++ });
}

export async function sendReport(_env, chatId, report) {
  return push('report', { chatId, report, message_id: state.nextMessageId++ });
}

export { state as __telegramState };
`,
  );

  writeStub(
    path.join('services', 'ai.js'),
    `export class GeminiQuotaExhaustedError extends Error {
  constructor() {
    super('All Gemini keys are exhausted.');
  }
}

export async function extractFoodFromInput(_env, userText, imageBase64) {
  const lower = String(userText).toLowerCase();
  const barcode = lower.includes('barcode lookup');
  const item = barcode
    ? {
        name: 'Barcode Product',
        quantity: 100,
        unit: 'g',
        calories_kcal: 250,
        protein_g: 10,
        carbs_g: 30,
        fat_g: 8,
        fiber_g: 2,
        sugar_g: 4,
        net_carbs_g: 28,
        saturated_fat_g: 1,
        trans_fat_g: 0,
        monounsaturated_fat_g: 0,
        polyunsaturated_fat_g: 0,
        cholesterol_mg: 0,
        sodium_mg: 120,
        potassium_mg: 0,
        calcium_mg: 0,
        iron_mg: 0,
        magnesium_mg: 0,
        phosphorus_mg: 0,
        zinc_mg: 0,
        selenium_mcg: 0,
        vitamin_a_mcg: 0,
        vitamin_c_mg: 0,
        vitamin_d_mcg: 0,
        vitamin_e_mg: 0,
        vitamin_k_mcg: 0,
        vitamin_b1_mg: 0,
        vitamin_b2_mg: 0,
        vitamin_b3_mg: 0,
        vitamin_b5_mg: 0,
        vitamin_b6_mg: 0,
        vitamin_b9_mcg: 0,
        vitamin_b12_mcg: 0,
        glycemic_index: 0,
        glycemic_load: 0,
        omega3_g: 0,
        omega6_g: 0,
        water_content_g: 0,
        confidence_score: 0.9,
        notes: null,
      }
    : {
        name: imageBase64 ? 'Photo Meal' : 'Text Meal',
        quantity: 1,
        unit: 'piece',
        calories_kcal: 300,
        protein_g: 20,
        carbs_g: 35,
        fat_g: 10,
        fiber_g: 3,
        sugar_g: 5,
        net_carbs_g: 32,
        saturated_fat_g: 2,
        trans_fat_g: 0,
        monounsaturated_fat_g: 0,
        polyunsaturated_fat_g: 0,
        cholesterol_mg: 0,
        sodium_mg: 200,
        potassium_mg: 0,
        calcium_mg: 0,
        iron_mg: 0,
        magnesium_mg: 0,
        phosphorus_mg: 0,
        zinc_mg: 0,
        selenium_mcg: 0,
        vitamin_a_mcg: 0,
        vitamin_c_mg: 0,
        vitamin_d_mcg: 0,
        vitamin_e_mg: 0,
        vitamin_k_mcg: 0,
        vitamin_b1_mg: 0,
        vitamin_b2_mg: 0,
        vitamin_b3_mg: 0,
        vitamin_b5_mg: 0,
        vitamin_b6_mg: 0,
        vitamin_b9_mcg: 0,
        vitamin_b12_mcg: 0,
        glycemic_index: 0,
        glycemic_load: 0,
        omega3_g: 0,
        omega6_g: 0,
        water_content_g: 0,
        confidence_score: 0.9,
        notes: null,
      };

  return {
    raw: JSON.stringify({ items: [item], meal_notes: null }),
    parsed: { items: [item], meal_notes: null },
    tokens: { input: 50, output: 25 },
    latencyMs: 5,
  };
}
`,
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function messageUpdate(telegramId, chatId, text, extras = {}) {
  return {
    update_id: Date.now(),
    message: {
      chat: { id: chatId },
      from: { id: telegramId, first_name: 'Test' },
      text,
      ...extras,
    },
  };
}

function photoUpdate(telegramId, chatId, caption = undefined) {
  return {
    update_id: Date.now(),
    message: {
      chat: { id: chatId },
      from: { id: telegramId, first_name: 'Test' },
      text: caption,
      photo: [{ file_id: 'photo-1', file_size: 1234 }],
    },
  };
}

function callbackUpdate(telegramId, chatId, callbackId, data, messageId) {
  return {
    update_id: Date.now(),
    callback_query: {
      id: callbackId,
      data,
      from: { id: telegramId, first_name: 'Test' },
      message: {
        chat: { id: chatId },
        message_id: messageId,
      },
    },
  };
}

async function main() {
  installStubs();

  const handlerModule = await import(pathToFileURL(path.join(simRoot, 'handlers', 'telegram-handler.js')).href);
  const dbModule = await import(pathToFileURL(path.join(simRoot, 'data', 'db.js')).href);
  const telegramModule = await import(pathToFileURL(path.join(simRoot, 'services', 'telegram.js')).href);

  const { handleProcessUpdate } = handlerModule;
  const { __dbState: dbState, todayInTimezone } = dbModule;
  const { __telegramState: telegramState } = telegramModule;

  const env = {
    TELEGRAM_BOT_TOKEN: 'test-token',
    STATE_TIMEOUT_MINUTES: '20',
    RATE_LIMIT_PER_MINUTE: '20',
  };

  const telegramId = 1001;
  const chatId = 2001;

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/start'));
  assert(telegramState.events.at(-1).text.includes('What name should I call you?'), 'Onboarding step 1 failed');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'Sathish'));
  assert(telegramState.events.at(-1).text.includes('timezone'), 'Onboarding step 2 failed');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'Asia/Kolkata'));
  assert(telegramState.events.at(-1).text.includes('calorie goal'), 'Onboarding step 3 failed');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '2200'));
  assert(dbState.users.get(String(telegramId))?.onboarded === true, 'User should be onboarded');
  assert(telegramState.events.some((event) => event.kind === 'keyboard'), 'Main menu should be shown after onboarding');

  const eventsAfterOnboarding = telegramState.events.length;
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/start'));
  const startEvents = telegramState.events.slice(eventsAfterOnboarding);
  assert(startEvents.some((event) => event.kind === 'keyboard'), 'Existing user /start should show menu');
  assert(!startEvents.some((event) => String(event.text).includes('What name should I call you?')), 'Existing user should not re-enter onboarding');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/log'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'today'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'lunch'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'manual'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'Paneer'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '150 g'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '420'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '30 12 28'));
  assert(dbState.conv.get(String(telegramId)).state === 'awaiting_manual_micros', 'Manual micros step should be reachable');
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'skip'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'save'));
  assert(dbState.foodLogs.length >= 1, 'Manual log should be saved');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/log'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'today'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'dinner'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'ai'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '2 eggs and toast'));
  const latestState = dbState.conv.get(String(telegramId));
  assert(latestState.state === 'awaiting_confirmation', 'AI flow should reach confirmation');
  assert(latestState.context.meal_type === 'dinner', 'AI flow should preserve guided meal type');
  assert(latestState.context.log_date === todayInTimezone('Asia/Kolkata'), 'AI flow should preserve guided log date');

  const latestKeyboard = [...telegramState.events].reverse().find((event) => event.kind === 'keyboard');
  const confirmData = latestKeyboard.replyMarkup.inline_keyboard[0][0].callback_data;
  await handleProcessUpdate(env, callbackUpdate(telegramId, chatId, 'cb-1', confirmData, latestKeyboard.message_id));
  assert(dbState.foodLogs.length >= 2, 'AI confirmation should save food log');
  assert(telegramState.events.some((event) => event.kind === 'callback_answer' && event.text === 'Saving...'), 'Callback should be answered quickly');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/today'));
  assert(telegramState.events.at(-1).text.includes('Today'), '/today should return summary');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/edit'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'today'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '1 200'));
  assert(dbState.foodLogs.some((log) => log.items.some((item) => item.quantity === 200)), 'Edit flow should update quantity');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/supplement creatine'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'yes'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '2'));
  assert(dbState.supplementLogs.length === 1, 'Supplement flow should save');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/weight 72 kg'));
  assert(dbState.weights.some((entry) => entry.weightKg === 72), 'Weight direct command should save');
  assert(dbState.conv.get(String(telegramId)).state === 'idle', 'Weight direct command should clear old active flow');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/log'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'today'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'breakfast'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'common'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'rice'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '1'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '150'));
  assert(dbState.foodLogs.length >= 3, 'Common-food flow should save');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/log'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'today'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'snacks'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'history'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '1'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '2'));
  assert(dbState.foodLogs.length >= 4, 'History flow should save');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/log'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'today'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'breakfast'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'barcode'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '8901234567890'));
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '50'));
  assert(dbState.foodLogs.length >= 5, 'Barcode flow should save');

  await handleProcessUpdate(env, photoUpdate(telegramId, chatId));
  const photoKeyboard = [...telegramState.events].reverse().find((event) => event.kind === 'keyboard');
  assert(String(photoKeyboard.text).includes('Nutrition Preview'), 'Photo AI flow should reach confirmation');
  const photoConfirm = photoKeyboard.replyMarkup.inline_keyboard[0][0].callback_data;
  await handleProcessUpdate(env, callbackUpdate(telegramId, chatId, 'cb-photo', photoConfirm, photoKeyboard.message_id));
  assert(dbState.foodLogs.length >= 6, 'Photo AI flow should save after confirmation');

  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/export'));
  assert(telegramState.events.some((event) => event.kind === 'document'), 'Export should send workbook document');
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/export 2026-02-30'));
  assert(String(telegramState.events.at(-1).text).includes('Invalid export range'), 'Invalid export date should be rejected');

  await dbModule.saveState(env, BigInt(telegramId), 'awaiting_manual_name', { manual_draft: {} });
  dbState.conv.get(String(telegramId)).updatedAt = Date.now() - 30 * 60_000;
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, 'banana'));
  assert(dbState.conv.get(String(telegramId)).state === 'awaiting_confirmation', 'Timed out flow should reset and fresh food input should proceed');
  await handleProcessUpdate(env, messageUpdate(telegramId, chatId, '/start'));
  assert(dbState.conv.get(String(telegramId)).state === 'idle', 'Existing user /start should reset stale flow');

  const secondTelegramId = 1002;
  const secondChatId = 2002;
  await handleProcessUpdate(env, messageUpdate(secondTelegramId, secondChatId, '/start'));
  await handleProcessUpdate(env, messageUpdate(secondTelegramId, secondChatId, 'New User'));
  await handleProcessUpdate(env, messageUpdate(secondTelegramId, secondChatId, 'Mars/Olympus'));
  assert(String(telegramState.events.at(-1).text).includes('Invalid timezone'), 'Invalid timezone should be rejected during onboarding');

  console.log(JSON.stringify({
    ok: true,
    scenarios: [
      'onboarding progression',
      'existing user start does not re-onboard',
      'manual logging progression',
      'AI guided logging preserves state',
      'callback confirm save',
      'today summary',
      'edit flow',
      'supplement flow',
      'weight direct reset',
      'common-food flow',
      'history flow',
      'barcode flow',
      'photo AI flow',
      'export flow',
      'invalid export date',
      'state timeout reset',
      'existing user start resets stale flow',
      'invalid timezone onboarding guard',
    ],
    foodLogs: dbState.foodLogs.length,
    supplementLogs: dbState.supplementLogs.length,
    weights: dbState.weights.length,
    telegramEvents: telegramState.events.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
