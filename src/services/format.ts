import { escapeMarkdown } from './telegram.js';
import { type FoodItem, type MealType, type TodayFoodRow } from '../types/index.js';

const COL = {
  food: 14,
  qty: 7,
  kcal: 5,
  macro: 5,
};

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function padEnd(text: string, width: number): string {
  return truncate(text, width).padEnd(width, ' ');
}

function padStart(text: string, width: number): string {
  return truncate(text, width).padStart(width, ' ');
}

/** Backticks would break out of a ``` code block; neutralize them in free-text cell values. */
function forTableCell(text: string): string {
  return text.replace(/`/g, "'");
}

function macroCell(value: number | null | undefined): string {
  const display = value === null || value === undefined ? '?' : `${Math.round(value)}g`;
  return padStart(display, COL.macro);
}

function kcalCell(value: number | null | undefined): string {
  const display = value === null || value === undefined ? '?' : String(Math.round(value));
  return padStart(display, COL.kcal);
}

export interface TableRow {
  name: string;
  qty: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

/**
 * Renders items as an aligned monospace table inside a ``` code block —
 * Telegram doesn't support real tables, but a fixed-width font with padded
 * columns reads the same way in every client. Content inside the fence is
 * shown literally (Telegram doesn't parse markdown there), so cell values
 * only need backticks neutralized, not full markdown-escaping.
 */
export function buildFoodTable(rows: TableRow[]): string {
  const header = `${padEnd('Food', COL.food)} ${padEnd('Qty', COL.qty)} ${padStart('Kcal', COL.kcal)} ${padStart('P', COL.macro)} ${padStart('C', COL.macro)} ${padStart('F', COL.macro)}`;
  const separator = '-'.repeat(header.length);

  const lines = rows.map((row) =>
    `${padEnd(forTableCell(row.name), COL.food)} ${padEnd(forTableCell(row.qty), COL.qty)} ${kcalCell(row.calories)} ${macroCell(row.protein)} ${macroCell(row.carbs)} ${macroCell(row.fat)}`,
  );

  const totals = rows.reduce(
    (acc, row) => ({
      calories: acc.calories + (row.calories ?? 0),
      protein: acc.protein + (row.protein ?? 0),
      carbs: acc.carbs + (row.carbs ?? 0),
      fat: acc.fat + (row.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const totalRow = `${padEnd('Total', COL.food)} ${padEnd('', COL.qty)} ${kcalCell(totals.calories)} ${macroCell(totals.protein)} ${macroCell(totals.carbs)} ${macroCell(totals.fat)}`;

  return ['```', header, separator, ...lines, separator, totalRow, '```'].join('\n');
}

export function mealTypeLabel(mealType: MealType | null | undefined): string {
  switch (mealType) {
    case 'breakfast': return 'Breakfast';
    case 'lunch': return 'Lunch';
    case 'dinner': return 'Dinner';
    default: return 'Snacks / Others';
  }
}

/** The one-item-per-line nutrient preview shown before a meal is saved. */
export function formatPreview(items: FoodItem[], mealNotes?: string | null): string {
  const table = buildFoodTable(
    items.map((item) => ({
      name: item.name,
      qty: `${item.quantity} ${item.unit}`,
      calories: item.calories_kcal,
      protein: item.protein_g,
      carbs: item.carbs_g,
      fat: item.fat_g,
    })),
  );

  const lines = ['🥗 *Nutrient Breakdown*', table];
  if (mealNotes) {
    lines.push(`📝 *Notes:* ${escapeMarkdown(mealNotes)}`);
  }
  lines.push('*Save this log?*');
  return lines.join('\n\n');
}

/** Today's logs grouped by meal type, each as its own table, with a daily total. */
export function buildTotalsMessage(rows: TodayFoodRow[], calorieGoal?: number | null): string {
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

  const sections = ["📅 *Today's food logs*"];

  for (const group of groupedRows) {
    if (group.rows.length === 0) continue;
    const table = buildFoodTable(
      group.rows.map((row) => ({
        name: row.food_name,
        qty: row.quantity && row.unit ? `${row.quantity} ${row.unit}` : '-',
        calories: row.calories,
        protein: row.protein_g,
        carbs: row.carbs_g,
        fat: row.fat_g,
      })),
    );
    sections.push(`*${mealTypeLabel(group.meal)}*\n${table}`);
  }

  const roundedCalories = Math.round(totals.calories);
  const goalLine = calorieGoal
    ? `\n🔥 ${roundedCalories} / ${calorieGoal} kcal (${Math.min(999, Math.round((roundedCalories / calorieGoal) * 100))}%)`
    : '';

  sections.push(
    `✨ *Daily totals:* ${roundedCalories} kcal | P ${Math.round(totals.protein)}g | C ${Math.round(totals.carbs)}g | F ${Math.round(totals.fat)}g${goalLine}`,
  );

  return sections.join('\n\n');
}
