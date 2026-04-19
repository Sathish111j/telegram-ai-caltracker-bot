import postgres, { type Sql } from 'postgres';
import {
  type ConversationState,
  type Env,
  type GeminiKeyRecord,
  type OnboardingContext,
  type PendingLog,
  type ReportType,
  type SummaryPayload,
  type TodayFoodRow,
} from '../types/index.js';

let db: Sql | null = null;
// Schema metadata is cached per isolate lifetime; deploy/restart refreshes it.
const tableExistsCache = new Map<string, Promise<boolean>>();
const columnExistsCache = new Map<string, Promise<boolean>>();
const detailedFoodItemColumns = [
  'quantity',
  'unit',
  'fiber_g',
  'sugar_g',
  'net_carbs_g',
  'saturated_fat_g',
  'trans_fat_g',
  'monounsaturated_fat_g',
  'polyunsaturated_fat_g',
  'cholesterol_mg',
  'sodium_mg',
  'potassium_mg',
  'calcium_mg',
  'iron_mg',
  'magnesium_mg',
  'phosphorus_mg',
  'zinc_mg',
  'selenium_mcg',
  'vitamin_a_mcg',
  'vitamin_c_mg',
  'vitamin_d_mcg',
  'vitamin_e_mg',
  'vitamin_k_mcg',
  'vitamin_b1_mg',
  'vitamin_b2_mg',
  'vitamin_b3_mg',
  'vitamin_b5_mg',
  'vitamin_b6_mg',
  'vitamin_b9_mcg',
  'vitamin_b12_mcg',
  'glycemic_index',
  'glycemic_load',
  'omega3_g',
  'omega6_g',
  'water_content_g',
  'confidence_score',
  'notes',
] as const;

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

function tableCacheKey(tableName: string): string {
  return tableName.toLowerCase();
}

function columnCacheKey(tableName: string, columnName: string): string {
  return `${tableName.toLowerCase()}.${columnName.toLowerCase()}`;
}

async function hasTable(env: Env, tableName: string): Promise<boolean> {
  const key = tableCacheKey(tableName);
  if (!tableExistsCache.has(key)) {
    const sql = getDb(env);
    const promise = sql<{ exists: boolean }[]>`
        select exists (
          select 1
          from information_schema.tables
          where table_schema = 'public'
            and table_name = ${tableName}
        ) as exists
      `.then((rows) => rows[0]?.exists ?? false);
    promise.catch(() => tableExistsCache.delete(key));
    tableExistsCache.set(key, promise);
  }

  return tableExistsCache.get(key) as Promise<boolean>;
}

async function hasColumn(env: Env, tableName: string, columnName: string): Promise<boolean> {
  const key = columnCacheKey(tableName, columnName);
  if (!columnExistsCache.has(key)) {
    const sql = getDb(env);
    const promise = sql<{ exists: boolean }[]>`
        select exists (
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = ${tableName}
            and column_name = ${columnName}
        ) as exists
      `.then((rows) => rows[0]?.exists ?? false);
    promise.catch(() => columnExistsCache.delete(key));
    columnExistsCache.set(key, promise);
  }

  return columnExistsCache.get(key) as Promise<boolean>;
}

async function supportsDetailedFoodItemStorage(env: Env): Promise<boolean> {
  const checks = await Promise.all(detailedFoodItemColumns.map((columnName) => hasColumn(env, 'food_items', columnName)));
  return checks.every(Boolean);
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
  const key = await pickGeminiKey(env, []);
  if (!key?.api_key) {
    throw new Error('No active Gemini key found in gemini_keys table.');
  }
  return key.api_key;
}

export async function pickGeminiKey(env: Env, attemptedKeyIds: number[]): Promise<GeminiKeyRecord | null> {
  const sql = getDb(env);
  const excludeIds = attemptedKeyIds.length ? attemptedKeyIds : [-1];
  const hasExhaustedUntil = await hasColumn(env, 'gemini_keys', 'exhausted_until');
  const hasLastUsedAt = await hasColumn(env, 'gemini_keys', 'last_used_at');

  const rows = hasExhaustedUntil && hasLastUsedAt
    ? await sql<GeminiKeyRecord[]>`
        select id, label, api_key
        from gemini_keys
        where is_active = true
          and id not in ${sql(excludeIds)}
          and (exhausted_until is null or exhausted_until <= now())
        order by last_used_at asc nulls first, id asc
        limit 1
      `
    : await sql<GeminiKeyRecord[]>`
        select id, label, api_key
        from gemini_keys
        where is_active = true
          and id not in ${sql(excludeIds)}
        order by id asc
        limit 1
      `;

  return rows[0] ?? null;
}

export async function touchGeminiKey(env: Env, keyId: number): Promise<void> {
  const sql = getDb(env);
  const hasLastUsedAt = await hasColumn(env, 'gemini_keys', 'last_used_at');

  if (hasLastUsedAt) {
    await sql`
      update gemini_keys
      set last_used_at = now(), updated_at = now()
      where id = ${keyId}
    `;
    return;
  }

  await sql`
    update gemini_keys
    set updated_at = now()
    where id = ${keyId}
  `;
}

export async function markKeyExhausted(env: Env, keyId: number): Promise<void> {
  const sql = getDb(env);
  const hasExhaustedUntil = await hasColumn(env, 'gemini_keys', 'exhausted_until');

  if (hasExhaustedUntil) {
    await sql`
      update gemini_keys
      set exhausted_until = now() + interval '1 hour', updated_at = now()
      where id = ${keyId}
    `;
    return;
  }

  await touchGeminiKey(env, keyId);
}

export async function incrementKeyFailCount(env: Env, keyId: number): Promise<number> {
  const sql = getDb(env);
  const hasFailCount = await hasColumn(env, 'gemini_keys', 'fail_count');

  if (!hasFailCount) {
    await touchGeminiKey(env, keyId);
    return 1;
  }

  const rows = await sql<{ fail_count: number }[]>`
    update gemini_keys
    set fail_count = coalesce(fail_count, 0) + 1,
        updated_at = now()
    where id = ${keyId}
    returning fail_count
  `;

  return rows[0]?.fail_count ?? 1;
}

export async function deactivateKey(env: Env, keyId: number): Promise<void> {
  const sql = getDb(env);
  await sql`
    update gemini_keys
    set is_active = false, updated_at = now()
    where id = ${keyId}
  `;
}

export async function saveFoodLog(env: Env, telegramId: string, pendingLog: PendingLog): Promise<void> {
  const sql = getDb(env);
  const userId = await getUserIdByTelegramId(env, telegramId);
  const detailedStorageAvailable = await supportsDetailedFoodItemStorage(env);

  if (!userId) {
    throw new Error('User profile not found. Use /start first.');
  }

  await sql.begin(async (transaction) => {
    const txn = transaction as unknown as Sql;
    const inserted = await txn<{ id: number }[]>`
      insert into food_logs (user_id, session_id, log_date, meal_type, ai_raw_response, confirmed, is_deleted, created_at, updated_at)
      values (${userId}, ${pendingLog.session_id}, current_date, ${pendingLog.meal_type ?? null}, ${pendingLog.ai_raw_response}, true, false, now(), now())
      returning id
    `;

    const foodLogId = inserted[0]?.id;
    if (!foodLogId) {
      throw new Error('Failed to create food log.');
    }

    for (const item of pendingLog.items) {
      const rawItem = JSON.parse(JSON.stringify(item));

      if (detailedStorageAvailable) {
        await txn`
          insert into food_items (
            food_log_id,
            name,
            quantity,
            unit,
            calories,
            protein_g,
            carbs_g,
            fat_g,
            fiber_g,
            sugar_g,
            net_carbs_g,
            saturated_fat_g,
            trans_fat_g,
            monounsaturated_fat_g,
            polyunsaturated_fat_g,
            cholesterol_mg,
            sodium_mg,
            potassium_mg,
            calcium_mg,
            iron_mg,
            magnesium_mg,
            phosphorus_mg,
            zinc_mg,
            selenium_mcg,
            vitamin_a_mcg,
            vitamin_c_mg,
            vitamin_d_mcg,
            vitamin_e_mg,
            vitamin_k_mcg,
            vitamin_b1_mg,
            vitamin_b2_mg,
            vitamin_b3_mg,
            vitamin_b5_mg,
            vitamin_b6_mg,
            vitamin_b9_mcg,
            vitamin_b12_mcg,
            glycemic_index,
            glycemic_load,
            omega3_g,
            omega6_g,
            water_content_g,
            confidence_score,
            notes,
            raw_json,
            data_source,
            is_deleted,
            created_at,
            updated_at
          )
          values (
            ${foodLogId},
            ${item.name},
            ${item.quantity},
            ${item.unit},
            ${item.calories_kcal},
            ${item.protein_g},
            ${item.carbs_g},
            ${item.fat_g},
            ${item.fiber_g},
            ${item.sugar_g},
            ${item.net_carbs_g},
            ${item.saturated_fat_g},
            ${item.trans_fat_g},
            ${item.monounsaturated_fat_g},
            ${item.polyunsaturated_fat_g},
            ${item.cholesterol_mg},
            ${item.sodium_mg},
            ${item.potassium_mg},
            ${item.calcium_mg},
            ${item.iron_mg},
            ${item.magnesium_mg},
            ${item.phosphorus_mg},
            ${item.zinc_mg},
            ${item.selenium_mcg},
            ${item.vitamin_a_mcg},
            ${item.vitamin_c_mg},
            ${item.vitamin_d_mcg},
            ${item.vitamin_e_mg},
            ${item.vitamin_k_mcg},
            ${item.vitamin_b1_mg},
            ${item.vitamin_b2_mg},
            ${item.vitamin_b3_mg},
            ${item.vitamin_b5_mg},
            ${item.vitamin_b6_mg},
            ${item.vitamin_b9_mcg},
            ${item.vitamin_b12_mcg},
            ${item.glycemic_index},
            ${item.glycemic_load},
            ${item.omega3_g},
            ${item.omega6_g},
            ${item.water_content_g},
            ${item.confidence_score},
            ${item.notes},
            ${txn.json(rawItem)},
            'ai_text',
            false,
            now(),
            now()
          )
        `;
        continue;
      }

      await txn`
          insert into food_items (food_log_id, name, calories, protein_g, carbs_g, fat_g, raw_json, data_source, is_deleted, created_at, updated_at)
          values (
            ${foodLogId},
            ${item.name},
            ${item.calories_kcal},
            ${item.protein_g},
            ${item.carbs_g},
            ${item.fat_g},
            ${txn.json(rawItem)},
            'ai_text',
            false,
            now(),
            now()
          )
        `;
    }
  });
}

export async function getTodayFoods(env: Env, userId: number): Promise<TodayFoodRow[]> {
  const sql = getDb(env);
  const hasQuantity = await hasColumn(env, 'food_items', 'quantity');
  const hasUnit = await hasColumn(env, 'food_items', 'unit');

  if (hasQuantity && hasUnit) {
    return sql<TodayFoodRow[]>`
      select fi.name as food_name, fl.meal_type, fi.quantity, fi.unit, fi.calories, fi.protein_g, fi.carbs_g, fi.fat_g
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

  return sql<TodayFoodRow[]>`
    select fi.name as food_name, fl.meal_type, null::double precision as quantity, null::text as unit, fi.calories, fi.protein_g, fi.carbs_g, fi.fat_g
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
  return sql.begin(async (transaction) => {
    const txn = transaction as unknown as Sql;
    const targetRows = await txn<{ food_item_id: number; food_log_id: number; food_name: string }[]>`
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
    await txn`
      update food_items
      set is_deleted = true, updated_at = now()
      where id = ${target.food_item_id}
    `;

    const remaining = await txn<{ count: number }[]>`
      select count(*)::int as count
      from food_items
      where food_log_id = ${target.food_log_id}
        and is_deleted = false
    `;

    if ((remaining[0]?.count ?? 0) === 0) {
      await txn`
        update food_logs
        set is_deleted = true, updated_at = now()
        where id = ${target.food_log_id}
      `;
    }

    return target.food_name;
  });
}

export async function getDueDailyReportTelegramIds(env: Env): Promise<string[]> {
  if (!(await hasTable(env, 'report_send_log'))) {
    return [];
  }

  const sql = getDb(env);
  const rows = await sql<{ telegram_id: string }[]>`
    select u.telegram_id
    from users u
    where not exists (
      select 1
      from report_send_log r
      where r.telegram_id = u.telegram_id
        and r.report_type = 'daily'
        and r.sent_on = (now() at time zone (
          case
            when exists (select 1 from pg_timezone_names tzn where tzn.name = u.timezone) then u.timezone
            else 'UTC'
          end
        ))::date
    )
    order by u.id asc
  `;

  return rows.map((row) => row.telegram_id);
}

export async function getDueWeeklyReportTelegramIds(env: Env): Promise<string[]> {
  if (!(await hasTable(env, 'report_send_log'))) {
    return [];
  }

  const sql = getDb(env);
  const rows = await sql<{ telegram_id: string }[]>`
    select u.telegram_id
    from users u
    where not exists (
      select 1
      from report_send_log r
      where r.telegram_id = u.telegram_id
        and r.report_type = 'weekly'
        and date_trunc('week', r.sent_on::timestamp) = date_trunc('week', ((now() at time zone (
          case
            when exists (select 1 from pg_timezone_names tzn where tzn.name = u.timezone) then u.timezone
            else 'UTC'
          end
        ))::date)::timestamp)
    )
    order by u.id asc
  `;

  return rows.map((row) => row.telegram_id);
}

export async function getMealGapTelegramIds(env: Env, hours: number): Promise<string[]> {
  const sql = getDb(env);
  const rows = await sql<{ telegram_id: string }[]>`
    select u.telegram_id
    from users u
    where not exists (
      select 1
      from food_logs fl
      where fl.user_id = u.id
        and fl.confirmed = true
        and fl.is_deleted = false
        and fl.created_at >= now() - (${hours} * interval '1 hour')
    )
    order by u.id asc
  `;

  return rows.map((row) => row.telegram_id);
}

function buildSummaryLines(rows: TodayFoodRow[], title: string): SummaryPayload {
  if (rows.length === 0) {
    return { lines: [], hasData: false };
  }

  const totals = rows.reduce(
    (acc, row) => ({
      calories: acc.calories + (row.calories ?? 0),
      protein: acc.protein + (row.protein_g ?? 0),
      carbs: acc.carbs + (row.carbs_g ?? 0),
      fat: acc.fat + (row.fat_g ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const lines = [title];
  rows.forEach((row, index) => {
    lines.push(
      `${index + 1}. ${row.food_name} - ${row.calories ?? '?'} kcal | P ${row.protein_g ?? '?'}g | C ${row.carbs_g ?? '?'}g | F ${row.fat_g ?? '?'}g`,
    );
  });
  lines.push('');
  lines.push(
    `Totals: ${Math.round(totals.calories)} kcal | P ${Math.round(totals.protein)}g | C ${Math.round(totals.carbs)}g | F ${Math.round(totals.fat)}g`,
  );

  return { lines, hasData: true };
}

export async function getDailySummary(env: Env, telegramId: string): Promise<SummaryPayload> {
  const userId = await getUserIdByTelegramId(env, telegramId);
  if (!userId) {
    return { lines: [], hasData: false };
  }

  const rows = await getTodayFoods(env, userId);
  return buildSummaryLines(rows, "Today's logs:");
}

export async function getWeeklySummary(env: Env, telegramId: string): Promise<SummaryPayload> {
  const userId = await getUserIdByTelegramId(env, telegramId);
  if (!userId) {
    return { lines: [], hasData: false };
  }

  const sql = getDb(env);
  const rows = await sql<TodayFoodRow[]>`
    select fi.name as food_name, fi.calories, fi.protein_g, fi.carbs_g, fi.fat_g
    from food_logs fl
    join food_items fi on fi.food_log_id = fl.id
    where fl.user_id = ${userId}
      and fl.log_date >= current_date - interval '6 day'
      and fl.confirmed = true
      and fl.is_deleted = false
      and fi.is_deleted = false
    order by fl.log_date asc, fi.created_at asc
  `;

  return buildSummaryLines(rows, 'Last 7 days:');
}

export async function markReportSent(env: Env, telegramId: string, reportType: ReportType): Promise<void> {
  if (!(await hasTable(env, 'report_send_log'))) {
    return;
  }

  const sql = getDb(env);
  await sql`
    insert into report_send_log (telegram_id, report_type, sent_on, created_at)
    select
      u.telegram_id,
      ${reportType},
      (now() at time zone (
        case
          when exists (select 1 from pg_timezone_names tzn where tzn.name = u.timezone) then u.timezone
          else 'UTC'
        end
      ))::date,
      now()
    from users u
    where u.telegram_id = ${telegramId}
    limit 1
  `;
}

export async function resetDailyAiCounters(env: Env): Promise<number> {
  if (!(await hasColumn(env, 'users', 'ai_calls_today'))) {
    return 0;
  }

  const sql = getDb(env);
  const rows = await sql<{ count: number }[]>`
    with updated as (
      update users
      set ai_calls_today = 0,
          updated_at = now()
      where coalesce(ai_calls_today, 0) <> 0
      returning 1
    )
    select count(*)::int as count
    from updated
  `;

  return rows[0]?.count ?? 0;
}

export async function hardPurgeDeleted(
  env: Env,
): Promise<{ users: number; food_logs: number; food_items: number; supplements: number }> {
  const sql = getDb(env);

  const purgeTable = async (tableName: 'users' | 'food_logs' | 'food_items' | 'supplement_logs'): Promise<number> => {
    if (!(await hasTable(env, tableName)) || !(await hasColumn(env, tableName, 'is_deleted'))) {
      return 0;
    }

    const rows = await sql<{ count: number }[]>`
      with deleted as (
        delete from ${sql(tableName)}
        where is_deleted = true
        returning 1
      )
      select count(*)::int as count
      from deleted
    `;

    return rows[0]?.count ?? 0;
  };

  const foodItems = await purgeTable('food_items');
  const foodLogs = await purgeTable('food_logs');
  const supplements = await purgeTable('supplement_logs');
  const users = await purgeTable('users');

  return {
    users,
    food_logs: foodLogs,
    food_items: foodItems,
    supplements,
  };
}
