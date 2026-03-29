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

export interface ParsedFoodItem {
  name: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface PendingLog {
  session_id: string;
  source_text: string;
  ai_raw_response: string;
  items: ParsedFoodItem[];
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
}

export interface ConversationState {
  state: string;
  context: OnboardingContext;
}

export interface TodayFoodRow {
  food_name: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}
