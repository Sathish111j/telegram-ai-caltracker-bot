export interface Env {
  DATABASE_URL?: string;
  GEMINI_MODEL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

export interface TelegramMessage {
  chat: { id: number };
  message_id?: number;
  text?: string;
  from?: { id: number; first_name?: string };
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from: { id: number; first_name?: string };
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export type FoodUnit = 'g' | 'ml' | 'piece' | 'cup' | 'tbsp' | 'tsp' | 'oz';

export interface FoodItem {
  name: string;
  quantity: number;
  unit: FoodUnit;
  calories_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  net_carbs_g: number | null;
  saturated_fat_g: number | null;
  trans_fat_g: number | null;
  monounsaturated_fat_g: number | null;
  polyunsaturated_fat_g: number | null;
  cholesterol_mg: number | null;
  sodium_mg: number | null;
  potassium_mg: number | null;
  calcium_mg: number | null;
  iron_mg: number | null;
  magnesium_mg: number | null;
  phosphorus_mg: number | null;
  zinc_mg: number | null;
  selenium_mcg: number | null;
  vitamin_a_mcg: number | null;
  vitamin_c_mg: number | null;
  vitamin_d_mcg: number | null;
  vitamin_e_mg: number | null;
  vitamin_k_mcg: number | null;
  vitamin_b1_mg: number | null;
  vitamin_b2_mg: number | null;
  vitamin_b3_mg: number | null;
  vitamin_b5_mg: number | null;
  vitamin_b6_mg: number | null;
  vitamin_b9_mcg: number | null;
  vitamin_b12_mcg: number | null;
  glycemic_index: number | null;
  glycemic_load: number | null;
  omega3_g: number | null;
  omega6_g: number | null;
  water_content_g: number | null;
  confidence_score: number | null;
  notes: string | null;
}

export type NumericNutrientColumn = Exclude<
  keyof FoodItem,
  'name' | 'quantity' | 'unit' | 'notes' | 'confidence_score'
>;

export interface FoodExtractionResult {
  items: FoodItem[];
  meal_notes: string | null;
}

export type AiCallType = 'food_extract';

export interface GeminiResponse {
  raw: string;
  parsed: FoodExtractionResult;
  tokens: {
    input: number;
    output: number;
  };
  latencyMs: number;
  keyLabel: string;
}

export interface GeminiErrorMetadata {
  geminiKeyLabel?: string;
}

export interface PendingLog {
  session_id: string;
  source_text: string;
  meal_type?: MealType;
  ai_raw_response: string;
  items: FoodItem[];
  meal_notes?: string | null;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'others';

export interface OnboardingContext {
  onboarding?: {
    step: 'name' | 'timezone' | 'calorie_goal';
    draft: {
      first_name?: string;
      timezone?: string;
      calorie_goal?: number;
    };
  };
  pending_log?: PendingLog;
  pending_meal_selection?: {
    session_id: string;
    source_text: string;
  };
  awaiting_log_text?: boolean;
}

export interface ConversationState {
  state: 'idle' | 'onboarding' | 'awaiting_food_input' | string;
  context: OnboardingContext;
}

export interface TodayFoodRow {
  food_name: string;
  meal_type?: MealType | null;
  quantity?: number | null;
  unit?: FoodUnit | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface GeminiKeyRecord {
  id: number;
  label: string;
  api_key: string;
}

export interface SummaryPayload {
  lines: string[];
  hasData: boolean;
}

export type ReportType = 'daily' | 'weekly' | 'meal_gap';

export type Intent = 'food_log' | 'weight' | 'supplement' | 'query';

export interface SanitizeResult {
  clean: boolean;
  blockedPattern?: string;
}

type ExportFoodBase = Pick<
  FoodItem,
  | 'quantity'
  | 'unit'
  | 'calories_kcal'
  | 'protein_g'
  | 'carbs_g'
  | 'fat_g'
  | 'fiber_g'
  | 'sugar_g'
  | 'net_carbs_g'
  | 'saturated_fat_g'
  | 'trans_fat_g'
  | 'monounsaturated_fat_g'
  | 'polyunsaturated_fat_g'
  | 'cholesterol_mg'
  | 'sodium_mg'
  | 'potassium_mg'
  | 'calcium_mg'
  | 'iron_mg'
  | 'magnesium_mg'
  | 'phosphorus_mg'
  | 'zinc_mg'
  | 'selenium_mcg'
  | 'vitamin_a_mcg'
  | 'vitamin_c_mg'
  | 'vitamin_d_mcg'
  | 'vitamin_e_mg'
  | 'vitamin_k_mcg'
  | 'vitamin_b1_mg'
  | 'vitamin_b2_mg'
  | 'vitamin_b3_mg'
  | 'vitamin_b5_mg'
  | 'vitamin_b6_mg'
  | 'vitamin_b9_mcg'
  | 'vitamin_b12_mcg'
  | 'glycemic_index'
  | 'glycemic_load'
  | 'omega3_g'
  | 'omega6_g'
  | 'water_content_g'
>;

export interface ExportFoodLogRow extends ExportFoodBase {
  log_date: string;
  meal_type: string | null;
  food_name: string;
  created_at: string;
}

export interface ExportDailyTotalRow extends Omit<ExportFoodBase, 'quantity' | 'unit'> {
  log_date: string;
}

export interface ExportWeeklyAverageRow extends Omit<ExportFoodBase, 'quantity' | 'unit'> {
  week_start: string;
}

export interface ExportMicronutrientHeatmapRow
  extends Pick<
    FoodItem,
    | 'sodium_mg'
    | 'potassium_mg'
    | 'calcium_mg'
    | 'iron_mg'
    | 'magnesium_mg'
    | 'phosphorus_mg'
    | 'zinc_mg'
    | 'selenium_mcg'
    | 'vitamin_a_mcg'
    | 'vitamin_c_mg'
    | 'vitamin_d_mcg'
    | 'vitamin_e_mg'
    | 'vitamin_k_mcg'
    | 'vitamin_b1_mg'
    | 'vitamin_b2_mg'
    | 'vitamin_b3_mg'
    | 'vitamin_b5_mg'
    | 'vitamin_b6_mg'
    | 'vitamin_b9_mcg'
    | 'vitamin_b12_mcg'
  > {
  log_date: string;
}

export interface ExportSupplementRow {
  log_date: string;
  log_time: string | null;
  name: string;
  brand: string | null;
  form: string | null;
  servings: number | null;
  dose: number | null;
  calories_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  type_color: string | null;
}

export interface ExportGoalContext {
  calorie_goal: number | null;
  protein_goal_g: number | null;
  carb_goal_g: number | null;
  fat_goal_g: number | null;
  fiber_goal_g: number | null;
}
