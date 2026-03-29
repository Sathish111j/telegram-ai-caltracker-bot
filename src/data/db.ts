import postgres, { type Sql } from 'postgres';
import {
  type ConversationState,
  type Env,
  type OnboardingContext,
  type PendingLog,
  type TodayFoodRow,
} from '../types/index.js';

let db: Sql | null = null;

function getDb(env: Env): Sql {
  if (!env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL secret.');
  }

  if (!db) {
    db = postgres(env.DATABASE_URL, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  return db;
}

export async function getState(env: Env, telegramId: string): Promise<ConversationState> {
  const sql = getDb(env);
  const rows = await sql<{ state: string; context: OnboardingContext | null }[]>`
    select state, context
    from conversation_state
    where telegram_id = ${telegramId}
    limit 1
  `;

  if (rows.length === 0) {
    return { state: 'idle', context: {} };
  }

  return { state: rows[0].state, context: rows[0].context ?? {} };
}

export async function saveState(env: Env, telegramId: string, state: string, context: OnboardingContext): Promise<void> {
  const sql = getDb(env);
  const jsonContext = JSON.parse(JSON.stringify(context));

  await sql`
    insert into conversation_state (telegram_id, state, context, created_at, updated_at)
    values (${telegramId}, ${state}, ${sql.json(jsonContext)}, now(), now())
    on conflict (telegram_id)
    do update set
      state = excluded.state,
      context = excluded.context,
      updated_at = now()
  `;
}

export async function saveUser(
  env: Env,
  telegramId: string,
  firstName: string,
  timezone: string,
  calorieGoal: number,
): Promise<void> {
  const sql = getDb(env);

  await sql`
    insert into users (telegram_id, first_name, timezone, calorie_goal, created_at, updated_at)
    values (${telegramId}, ${firstName}, ${timezone}, ${calorieGoal}, now(), now())
    on conflict (telegram_id)
    do update set
      first_name = excluded.first_name,
      timezone = excluded.timezone,
      calorie_goal = excluded.calorie_goal,
      updated_at = now()
  `;
}

export async function getUserIdByTelegramId(env: Env, telegramId: string): Promise<number | null> {
  const sql = getDb(env);
  const rows = await sql<{ id: number }[]>`
    select id
    from users
    where telegram_id = ${telegramId}
    limit 1
  `;

  return rows.length ? rows[0].id : null;
}

export async function getActiveGeminiKey(env: Env): Promise<string> {
  const sql = getDb(env);
  const rows = await sql<{ api_key: string }[]>`
    select api_key
    from gemini_keys
    where is_active = true
    order by id asc
    limit 1
  `;

  if (rows.length === 0 || !rows[0].api_key) {
    throw new Error('No active Gemini key found in gemini_keys table.');
  }

  return rows[0].api_key;
}

export async function saveFoodLog(env: Env, telegramId: string, pendingLog: PendingLog): Promise<void> {
  const sql = getDb(env);
  const userId = await getUserIdByTelegramId(env, telegramId);

  if (!userId) {
    throw new Error('User profile not found. Use /start first.');
  }

  const inserted = await sql<{ id: number }[]>`
    insert into food_logs (user_id, session_id, log_date, meal_type, ai_raw_response, confirmed, is_deleted, created_at, updated_at)
    values (${userId}, ${pendingLog.session_id}, current_date, null, ${pendingLog.ai_raw_response}, true, false, now(), now())
    returning id
  `;

  const foodLogId = inserted[0].id;

  for (const item of pendingLog.items) {
    const rawItem = JSON.parse(JSON.stringify(item));
    await sql`
      insert into food_items (food_log_id, name, calories, protein_g, carbs_g, fat_g, raw_json, data_source, is_deleted, created_at, updated_at)
      values (
        ${foodLogId},
        ${item.name},
        ${item.calories},
        ${item.protein_g},
        ${item.carbs_g},
        ${item.fat_g},
        ${sql.json(rawItem)},
        'ai_text',
        false,
        now(),
        now()
      )
    `;
  }
}

export async function getTodayFoods(env: Env, userId: number): Promise<TodayFoodRow[]> {
  const sql = getDb(env);
  return sql<TodayFoodRow[]>`
    select fi.name as food_name, fi.calories, fi.protein_g, fi.carbs_g, fi.fat_g
    from food_logs fl
    join food_items fi on fi.food_log_id = fl.id
    where fl.user_id = ${userId}
      and fl.log_date = current_date
      and fl.confirmed = true
      and fl.is_deleted = false
      and fi.is_deleted = false
    order by fi.created_at asc
  `;
}

export async function softDeleteFoodForToday(env: Env, userId: number, namePart: string): Promise<string | null> {
  const sql = getDb(env);
  const targetRows = await sql<{ food_item_id: number; food_log_id: number; food_name: string }[]>`
    select fi.id as food_item_id, fl.id as food_log_id, fi.name as food_name
    from food_items fi
    join food_logs fl on fl.id = fi.food_log_id
    where fl.user_id = ${userId}
      and fl.log_date = current_date
      and fl.confirmed = true
      and fl.is_deleted = false
      and fi.is_deleted = false
      and lower(fi.name) like ${`%${namePart.toLowerCase()}%`}
    order by fi.created_at desc
    limit 1
  `;

  if (targetRows.length === 0) {
    return null;
  }

  const target = targetRows[0];
  await sql`
    update food_items
    set is_deleted = true, updated_at = now()
    where id = ${target.food_item_id}
  `;

  const remaining = await sql<{ count: number }[]>`
    select count(*)::int as count
    from food_items
    where food_log_id = ${target.food_log_id}
      and is_deleted = false
  `;

  if ((remaining[0]?.count ?? 0) === 0) {
    await sql`
      update food_logs
      set is_deleted = true, updated_at = now()
      where id = ${target.food_log_id}
    `;
  }

  return target.food_name;
}
