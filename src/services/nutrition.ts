import { GoogleGenAI } from '@google/genai';
import { getActiveGeminiKey } from '../data/db.js';
import { type Env, type ParsedFoodItem } from '../types/index.js';

const DEFAULT_MODEL = 'gemini-3-flash-preview';

function normalizeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

function parseGeminiJson(raw: string): { items: ParsedFoodItem[] } {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as { items?: unknown[] };
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  return {
    items: items
      .map((item) => {
        const entry = item as Record<string, unknown>;
        const name = String(entry.name ?? '').trim();
        if (!name) {
          return null;
        }

        return {
          name,
          calories: normalizeNumber(entry.calories),
          protein_g: normalizeNumber(entry.protein_g),
          carbs_g: normalizeNumber(entry.carbs_g),
          fat_g: normalizeNumber(entry.fat_g),
        } as ParsedFoodItem;
      })
      .filter((x): x is ParsedFoodItem => x !== null),
  };
}

export function buildInlineKeyboard(sessionId: string): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: '✅ Save', callback_data: `save|${sessionId}` },
        { text: '❌ Cancel', callback_data: `cancel|${sessionId}` },
      ],
    ],
  };
}

export function formatPreview(items: ParsedFoodItem[]): string {
  const total = items.reduce(
    (acc, item) => ({
      calories: acc.calories + (item.calories ?? 0),
      protein: acc.protein + (item.protein_g ?? 0),
      carbs: acc.carbs + (item.carbs_g ?? 0),
      fat: acc.fat + (item.fat_g ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const lines = items.map(
    (item, idx) =>
      `${idx + 1}. ${item.name} - ${item.calories ?? '?'} kcal | P ${item.protein_g ?? '?'}g | C ${item.carbs_g ?? '?'}g | F ${item.fat_g ?? '?'}g`,
  );

  lines.push('');
  lines.push(
    `Total: ${Math.round(total.calories)} kcal | P ${Math.round(total.protein)}g | C ${Math.round(total.carbs)}g | F ${Math.round(total.fat)}g`,
  );
  lines.push('Save this log?');

  return lines.join('\n');
}

export async function extractNutrition(env: Env, userText: string): Promise<{ items: ParsedFoodItem[]; raw: string }> {
  const apiKey = await getActiveGeminiKey(env);
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const ai = new GoogleGenAI({ apiKey });

  const prompt = [
    'You are a nutrition assistant for a Telegram bot.',
    'Extract structured food items from user input.',
    'Return strict JSON only with this shape:',
    '{"items":[{"name":"...","calories":123,"protein_g":10,"carbs_g":20,"fat_g":5}]}',
    'Use null when a value is unknown.',
    'Do not include markdown fences or extra text.',
    `User input: ${userText}`,
  ].join('\n');

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  const raw = (response.text || '').trim();

  try {
    const parsed = parseGeminiJson(raw);
    if (parsed.items.length > 0) {
      return { items: parsed.items, raw };
    }
  } catch {
    // Keep flow working when JSON shape is imperfect.
  }

  return {
    items: [
      {
        name: userText,
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
      },
    ],
    raw,
  };
}
