import { escapeMarkdown } from './telegram.js';
import { type FoodItem, type MealType, type TodayFoodRow } from '../types/index.js';

// Kept deliberately narrow: Telegram's mobile clients *soft-wrap* long lines
// inside ``` code blocks instead of scrolling them, which destroys column
// alignment the moment a row is wider than the screen. A long food name or a
// bulky quantity string used to push rows past 45+ characters — this table
// only carries Food/Qty/Kcal (protein/carbs/fat move to a summary line
// outside the block) so no row can ever exceed ~26 characters, comfortably
// under the wrap width of even the narrowest phone screens.
const COL = {
  food: 13,
  qty: 7,
  kcal: 5,
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

export interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function sumMacros(rows: TableRow[]): MacroTotals {
  return rows.reduce(
    (acc, row) => ({
      calories: acc.calories + (row.calories ?? 0),
      protein: acc.protein + (row.protein ?? 0),
      carbs: acc.carbs + (row.carbs ?? 0),
      fat: acc.fat + (row.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function macroLine(label: string, totals: MacroTotals): string {
  return `${label} ${Math.round(totals.calories)} kcal | P ${Math.round(totals.protein)}g | C ${Math.round(totals.carbs)}g | F ${Math.round(totals.fat)}g`;
}

/**
 * Renders items as a narrow, aligned monospace table inside a ``` code
 * block. Content inside the fence is shown literally (Telegram doesn't
 * parse markdown there), so cell values only need backticks neutralized,
 * not full markdown-escaping.
 */
export function buildFoodTable(rows: TableRow[]): string {
  const header = `${padEnd('Food', COL.food)} ${padEnd('Qty', COL.qty)} ${padStart('Kcal', COL.kcal)}`;
  const separator = '-'.repeat(header.length);

  const lines = rows.map((row) => `${padEnd(forTableCell(row.name), COL.food)} ${padEnd(forTableCell(row.qty), COL.qty)} ${kcalCell(row.calories)}`);

  const totals = sumMacros(rows);
  const totalRow = `${padEnd('Total', COL.food)} ${padEnd('', COL.qty)} ${kcalCell(totals.calories)}`;

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

function toTableRow(item: {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}): TableRow {
  return {
    name: item.name,
    qty: item.quantity && item.unit ? `${item.quantity} ${item.unit}` : '-',
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  };
}

/** The nutrient preview (table + full macro totals) shown before a meal is saved. */
export function formatPreview(items: FoodItem[], mealNotes?: string | null): string {
  const rows = items.map((item) =>
    toTableRow({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      calories: item.calories_kcal,
      protein: item.protein_g,
      carbs: item.carbs_g,
      fat: item.fat_g,
    }),
  );

  const lines = ['🥗 *Nutrient Breakdown*', buildFoodTable(rows), macroLine('📊 *Total:*', sumMacros(rows))];
  if (mealNotes) {
    lines.push(`📝 *Notes:* ${escapeMarkdown(mealNotes)}`);
  }
  lines.push('*Save this log?*');
  return lines.join('\n\n');
}

function toRow(row: TodayFoodRow): TableRow {
  return toTableRow({
    name: row.food_name,
    quantity: row.quantity,
    unit: row.unit,
    calories: row.calories,
    protein: row.protein_g,
    carbs: row.carbs_g,
    fat: row.fat_g,
  });
}

/** Today's logs grouped by meal type, each as its own table with a macro subtotal, plus a daily total. */
export function buildTotalsMessage(rows: TodayFoodRow[], calorieGoal?: number | null): string {
  const groups: MealType[] = ['breakfast', 'lunch', 'dinner', 'others'];
  const groupedRows = groups.map((meal) => ({
    meal,
    rows: rows.filter((row) => (row.meal_type ?? 'others') === meal).map(toRow),
  }));

  const sections = ["📅 *Today's food logs*"];

  for (const group of groupedRows) {
    if (group.rows.length === 0) continue;
    sections.push(`${macroLine(`*${mealTypeLabel(group.meal)}* —`, sumMacros(group.rows))}\n${buildFoodTable(group.rows)}`);
  }

  const totals = sumMacros(rows.map(toRow));
  const roundedCalories = Math.round(totals.calories);
  const goalLine = calorieGoal
    ? `\n🔥 ${roundedCalories} / ${calorieGoal} kcal (${Math.min(999, Math.round((roundedCalories / calorieGoal) * 100))}%)`
    : '';

  sections.push(`${macroLine('✨ *Daily totals:*', totals)}${goalLine}`);

  return sections.join('\n\n');
}
