import { type Sql } from 'postgres';

export interface Env {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  GEMINI_MODEL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  HYPERDRIVE?: { connectionString: string };
  sql?: Sql;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  chat: { id: number; type?: string };
  message_id?: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  voice?: unknown;
  document?: unknown;
  sticker?: unknown;
  video?: unknown;
  audio?: unknown;
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
  edited_message?: TelegramMessage;
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

export interface PendingImage {
  data: string;
  mimeType: string;
  caption?: string;
}

export interface PendingDelete {
  food_item_id: number;
  food_log_id: number;
  food_name: string;
}

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
  pending_source_text?: string;
  pending_source_image?: PendingImage;
  selected_meal_type?: MealType;
  pending_delete?: PendingDelete[];
  awaiting_reset_confirm?: boolean;
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
  created_at?: string;
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

export interface SanitizeResult {
  clean: boolean;
  blockedPattern?: string;
}

export interface TodayFoodMatch {
  food_item_id: number;
  food_log_id: number;
  food_name: string;
  quantity: number | null;
  unit: FoodUnit | null;
}
