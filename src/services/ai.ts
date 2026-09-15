import { GoogleGenAI, Type } from '@google/genai';
import {
  deactivateKey,
  incrementKeyFailCount,
  markKeyExhausted,
  pickGeminiKey,
  touchGeminiKey,
} from '../data/db.js';
import {
  type Env,
  type FoodItem,
  type GeminiResponse,
} from '../types/index.js';
import { ALL_NUMERIC_NUTRIENT_KEYS } from './nutrients.js';

/**
 * Custom error for when all API keys are depleted.
 */
export class GeminiQuotaExhaustedError extends Error {
  constructor() {
    super('All Gemini API keys are exhausted.');
  }
}

/**
 * Custom error for a Gemini call that didn't complete within the timeout.
 */
export class GeminiTimeoutError extends Error {
  constructor() {
    super('The AI took too long to respond.');
  }
}

const DEFAULT_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 25_000;
const ALLOWED_FOOD_UNITS = new Set(['g', 'ml', 'piece', 'cup', 'tbsp', 'tsp', 'oz']);
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Structured schema for food extraction.
 * Defined using standard types for reliability.
 */
const FOOD_EXTRACTION_SCHEMA: any = {
  type: Type.OBJECT,
  description: "Response containing extracted food items and optional meal notes.",
  properties: {
    items: {
      type: Type.ARRAY,
      description: "List of food items identified in the input.",
      items: {
        type: Type.OBJECT,
        required: ["name", "quantity", "unit"],
        properties: {
          name: { type: Type.STRING, description: "Common name of the food." },
          quantity: { type: Type.NUMBER, description: "Numeric quantity of the item." },
          unit: { 
            type: Type.STRING, 
            description: "Standard unit (g, ml, piece, cup, tbsp, tsp, oz). Use 'piece' for countable items like eggs." 
          },
          calories_kcal: { type: Type.NUMBER, nullable: true },
          protein_g: { type: Type.NUMBER, nullable: true },
          carbs_g: { type: Type.NUMBER, nullable: true },
          fat_g: { type: Type.NUMBER, nullable: true },
          fiber_g: { type: Type.NUMBER, nullable: true },
          sugar_g: { type: Type.NUMBER, nullable: true },
          net_carbs_g: { type: Type.NUMBER, nullable: true },
          saturated_fat_g: { type: Type.NUMBER, nullable: true },
          trans_fat_g: { type: Type.NUMBER, nullable: true },
          monounsaturated_fat_g: { type: Type.NUMBER, nullable: true },
          polyunsaturated_fat_g: { type: Type.NUMBER, nullable: true },
          cholesterol_mg: { type: Type.NUMBER, nullable: true },
          sodium_mg: { type: Type.NUMBER, nullable: true },
          potassium_mg: { type: Type.NUMBER, nullable: true },
          calcium_mg: { type: Type.NUMBER, nullable: true },
          iron_mg: { type: Type.NUMBER, nullable: true },
          magnesium_mg: { type: Type.NUMBER, nullable: true },
          phosphorus_mg: { type: Type.NUMBER, nullable: true },
          zinc_mg: { type: Type.NUMBER, nullable: true },
          selenium_mcg: { type: Type.NUMBER, nullable: true },
          vitamin_a_mcg: { type: Type.NUMBER, nullable: true },
          vitamin_c_mg: { type: Type.NUMBER, nullable: true },
          vitamin_d_mcg: { type: Type.NUMBER, nullable: true },
          vitamin_e_mg: { type: Type.NUMBER, nullable: true },
          vitamin_k_mcg: { type: Type.NUMBER, nullable: true },
          vitamin_b1_mg: { type: Type.NUMBER, nullable: true },
          vitamin_b2_mg: { type: Type.NUMBER, nullable: true },
          vitamin_b3_mg: { type: Type.NUMBER, nullable: true },
          vitamin_b5_mg: { type: Type.NUMBER, nullable: true },
          vitamin_b6_mg: { type: Type.NUMBER, nullable: true },
          vitamin_b9_mcg: { type: Type.NUMBER, nullable: true },
          vitamin_b12_mcg: { type: Type.NUMBER, nullable: true },
          glycemic_index: { type: Type.NUMBER, nullable: true },
          glycemic_load: { type: Type.NUMBER, nullable: true },
          omega3_g: { type: Type.NUMBER, nullable: true },
          omega6_g: { type: Type.NUMBER, nullable: true },
          water_content_g: { type: Type.NUMBER, nullable: true },
          confidence_score: { type: Type.NUMBER, nullable: true },
          notes: { type: Type.STRING, nullable: true },
        }
      }
    },
    meal_notes: { type: Type.STRING, nullable: true, description: "General observations about the meal." }
  },
  required: ["items"]
};

/**
 * System instruction ensures the AI behaves as a specialized nutritional assistant.
 */
const SYSTEM_INSTRUCTION = `You are a clinical dietitian and board-certified nutritional scientist.
Your task is to extract food items from user input (text or images) and provide structured nutritional data.
IMPORTANT RULES:
1. Always extract the numeric quantity and standard unit.
2. Use 'piece' for countable items (e.g., 3 eggs, 1 banana).
3. Provide nutritional values for the *specific quantity* extracted, not per 100g.
4. Estimate missing values based on standard references if not explicitly provided.
5. Return ONLY valid JSON following the provided schema.`;

/**
 * Normalizes an item to ensure numeric precision and default values.
 */
function normalizeItem(raw: any): FoodItem {
  const parsedQuantity = Number(raw.quantity);
  const unit = String(raw.unit || 'piece').toLowerCase();

  const item: any = {
    name: String(raw.name || 'Unknown food').trim(),
    quantity: Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1,
    unit: ALLOWED_FOOD_UNITS.has(unit) ? unit : 'piece',
    confidence_score: typeof raw.confidence_score === 'number' ? Math.min(1, Math.max(0, raw.confidence_score)) : 0.5,
    notes: raw.notes ? String(raw.notes) : null,
  };

  for (const key of ALL_NUMERIC_NUTRIENT_KEYS) {
    const val = raw[key];
    const numeric = typeof val === 'number' ? val : typeof val === 'string' && val.trim() !== '' ? Number(val) : NaN;
    if (Number.isFinite(numeric) && numeric >= 0) {
      item[key] = key === 'glycemic_index' ? Math.round(numeric) : Number(numeric.toFixed(2));
    } else {
      item[key] = null;
    }
  }

  return item as FoodItem;
}

/**
 * End-to-end optimized food extraction using Gemini 2.5 Flash.
 */
export async function extractFoodFromInput(env: Env, userText: string, image?: { data: string; mimeType: string }): Promise<GeminiResponse> {
  if (image && !ALLOWED_IMAGE_MIME_TYPES.has(image.mimeType)) {
    throw new Error(`Unsupported image type: ${image.mimeType}`);
  }

  let attempts = 0;
  const attemptedKeyIds = new Set<number>();

  while (attempts < 4) {
    const key = await pickGeminiKey(env, [...attemptedKeyIds]);
    if (!key) throw new GeminiQuotaExhaustedError();
    attemptedKeyIds.add(key.id);
    attempts++;

    // Separate the network/API call from response parsing so a malformed
    // (but successfully-delivered) response doesn't count against the key's
    // health — only genuine API-reported failures should be able to
    // permanently deactivate a key.
    let response: any;
    try {
      const client = new GoogleGenAI({ apiKey: key.api_key });

      response = await withTimeout(
        client.models.generateContent({
          model: env.GEMINI_MODEL || DEFAULT_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                { text: userText },
                ...(image ? [{ inlineData: { data: image.data, mimeType: image.mimeType } }] : []),
              ],
            },
          ],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseJsonSchema: FOOD_EXTRACTION_SCHEMA,
            temperature: 0.1,
          },
        }),
        GEMINI_TIMEOUT_MS,
      );
    } catch (error: any) {
      const msg = safeErrorMessage(error).toLowerCase();
      console.error('Gemini API Error', { message: msg, key: key.label });

      if (error instanceof GeminiTimeoutError || msg.includes('timeout') || msg.includes('network') || msg.includes('fetch failed')) {
        // Transient — don't penalize the key's health, just try another key/attempt.
        continue;
      }

      if (msg.includes('quota') || msg.includes('429')) {
        await markKeyExhausted(env, key.id);
      } else {
        const failCount = await incrementKeyFailCount(env, key.id);
        if (failCount > 5) await deactivateKey(env, key.id);
      }
      continue;
    }

    // Parsing failures are a model/response issue, not evidence the key itself
    // is unhealthy — don't touch key-health bookkeeping here.
    try {
      const data = response.text ? JSON.parse(response.text) : { items: [] };
      const normalizedItems = (data.items || []).map(normalizeItem);

      await touchGeminiKey(env, key.id);

      return {
        raw: response.text || '{}',
        parsed: { items: normalizedItems, meal_notes: data.meal_notes || null },
        tokens: {
          input: response.usageMetadata?.promptTokenCount || 0,
          output: response.usageMetadata?.candidatesTokenCount || 0,
        },
        latencyMs: 0,
        keyLabel: key.label,
      };
    } catch (parseError: any) {
      console.error('Gemini response parse error', { message: safeErrorMessage(parseError), key: key.label });
      continue;
    }
  }

  throw new GeminiQuotaExhaustedError();
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? 'Unknown error');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new GeminiTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
