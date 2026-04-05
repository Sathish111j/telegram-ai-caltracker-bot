import * as XLSX from 'xlsx';
import type {
  ExportDailyTotalRow,
  ExportFoodLogRow,
  ExportGoalContext,
  ExportMicronutrientHeatmapRow,
  NumericNutrientColumn,
  ExportSupplementRow,
  ExportWeeklyAverageRow,
} from '../types/index.js';

const MACRO_COLUMNS: NumericNutrientColumn[] = ['calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];

const MICRONUTRIENT_COLUMNS = [
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
] as const;

const NUTRIENT_COLUMNS: NumericNutrientColumn[] = [
  'calories_kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'sugar_g',
  'net_carbs_g',
  'saturated_fat_g',
  'trans_fat_g',
  'monounsaturated_fat_g',
  'polyunsaturated_fat_g',
  'cholesterol_mg',
  ...MICRONUTRIENT_COLUMNS,
  'glycemic_index',
  'glycemic_load',
  'omega3_g',
  'omega6_g',
  'water_content_g',
] as const;

const NUTRIENT_LABELS: Record<NumericNutrientColumn, string> = {
  calories_kcal: 'Calories (kcal)',
  protein_g: 'Protein (g)',
  carbs_g: 'Carbs (g)',
  fat_g: 'Fat (g)',
  fiber_g: 'Fiber (g)',
  sugar_g: 'Sugar (g)',
  net_carbs_g: 'Net Carbs (g)',
  saturated_fat_g: 'Saturated Fat (g)',
  trans_fat_g: 'Trans Fat (g)',
  monounsaturated_fat_g: 'Monounsaturated Fat (g)',
  polyunsaturated_fat_g: 'Polyunsaturated Fat (g)',
  cholesterol_mg: 'Cholesterol (mg)',
  sodium_mg: 'Sodium (mg)',
  potassium_mg: 'Potassium (mg)',
  calcium_mg: 'Calcium (mg)',
  iron_mg: 'Iron (mg)',
  magnesium_mg: 'Magnesium (mg)',
  phosphorus_mg: 'Phosphorus (mg)',
  zinc_mg: 'Zinc (mg)',
  selenium_mcg: 'Selenium (mcg)',
  vitamin_a_mcg: 'Vitamin A (mcg)',
  vitamin_c_mg: 'Vitamin C (mg)',
  vitamin_d_mcg: 'Vitamin D (mcg)',
  vitamin_e_mg: 'Vitamin E (mg)',
  vitamin_k_mcg: 'Vitamin K (mcg)',
  vitamin_b1_mg: 'Vitamin B1 (mg)',
  vitamin_b2_mg: 'Vitamin B2 (mg)',
  vitamin_b3_mg: 'Vitamin B3 (mg)',
  vitamin_b5_mg: 'Vitamin B5 (mg)',
  vitamin_b6_mg: 'Vitamin B6 (mg)',
  vitamin_b9_mcg: 'Vitamin B9 (mcg)',
  vitamin_b12_mcg: 'Vitamin B12 (mcg)',
  glycemic_index: 'Glycemic Index',
  glycemic_load: 'Glycemic Load',
  omega3_g: 'Omega-3 (g)',
  omega6_g: 'Omega-6 (g)',
  water_content_g: 'Water Content (g)',
};

function mealLabel(mealType: string | null | undefined): string {
  switch ((mealType ?? '').toLowerCase()) {
    case 'breakfast':
      return 'Breakfast';
    case 'lunch':
      return 'Lunch';
    case 'dinner':
      return 'Dinner';
    case 'snacks':
    case 'snack':
      return 'Snacks';
    default:
      return 'Uncategorized';
  }
}

function dataSourceLabel(source: string | null | undefined): string {
  switch ((source ?? '').toLowerCase()) {
    case 'ai_text':
      return 'AI Text';
    case 'ai_image':
      return 'AI Image';
    case 'ai_both':
      return 'AI Text + Image';
    case 'manual':
      return 'Manual';
    case 'history':
    case 'history_reuse':
      return 'History';
    case 'barcode':
    case 'barcode_entry':
      return 'Barcode';
    case 'common':
    case 'common_library':
      return 'Common Library';
    default:
      return source ?? 'Unknown';
  }
}

function numeric(value: number | null | undefined): number {
  return value ?? 0;
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function calcGoalBand(value: number | null | undefined, goal: number | null | undefined): string {
  if (!goal || goal <= 0 || value === null || value === undefined) {
    return 'N/A';
  }
  const pct = (value / goal) * 100;
  if (pct >= 100) {
    return 'On/Above';
  }
  if (pct >= 85) {
    return 'Near';
  }
  return 'Below';
}

function trendArrow(current: number | null, previous: number | null): string {
  if (current === null || previous === null) {
    return 'Flat';
  }
  const delta = current - previous;
  if (Math.abs(delta) < 0.001) {
    return 'Flat';
  }
  return delta > 0 ? 'Up' : 'Down';
}

function emptyNutrients(): Record<NumericNutrientColumn, number> {
  return {
    calories_kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    sugar_g: 0,
    net_carbs_g: 0,
    saturated_fat_g: 0,
    trans_fat_g: 0,
    monounsaturated_fat_g: 0,
    polyunsaturated_fat_g: 0,
    cholesterol_mg: 0,
    sodium_mg: 0,
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
  };
}

function makeTotalsByDayRows(foodRows: ExportFoodLogRow[]): ExportDailyTotalRow[] {
  const grouped = new Map<string, ExportDailyTotalRow>();
  for (const row of foodRows) {
    const existing = grouped.get(row.log_date) ?? {
      log_date: row.log_date,
      ...emptyNutrients(),
    };
    for (const nutrient of NUTRIENT_COLUMNS) {
      existing[nutrient] = numeric(existing[nutrient]) + numeric(row[nutrient]);
    }
    grouped.set(row.log_date, existing);
  }
  return Array.from(grouped.values()).sort((a, b) => a.log_date.localeCompare(b.log_date));
}

function buildSheet(rows: Array<Record<string, string | number | null>>, columns: string[], widths?: number[]): XLSX.WorkSheet {
  const sheetRows = rows.map((row) => {
    const mapped: Record<string, string | number | null> = {};
    for (const column of columns) {
      mapped[column] = row[column] ?? null;
    }
    return mapped;
  });

  const ws = XLSX.utils.json_to_sheet(sheetRows, { header: columns });
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: columns.length - 1 } }) };
  ws['!cols'] = columns.map((column, index) => ({
    wch: widths?.[index] ?? Math.max(12, Math.min(28, column.length + 2)),
  }));
  return ws;
}

function appendSheet(
  wb: XLSX.WorkBook,
  name: string,
  rows: Array<Record<string, string | number | null>>,
  columns: string[],
  widths?: number[],
): void {
  const safeRows = rows.length ? rows : [Object.fromEntries(columns.map((column) => [column, null]))];
  XLSX.utils.book_append_sheet(wb, buildSheet(safeRows, columns, widths), name);
}

function buildSummaryRows(
  input: ExportWorkbookInput,
  dailyRows: ExportDailyTotalRow[],
): Array<Record<string, string | number | null>> {
  const totalDays = dailyRows.length;
  const totals = dailyRows.reduce(
    (acc, row) => ({
      calories: acc.calories + numeric(row.calories_kcal),
      protein: acc.protein + numeric(row.protein_g),
      carbs: acc.carbs + numeric(row.carbs_g),
      fat: acc.fat + numeric(row.fat_g),
      fiber: acc.fiber + numeric(row.fiber_g),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );

  const topFoods = Array.from(
    input.foodRows.reduce((map, row) => {
      const current = map.get(row.food_name) ?? { count: 0, calories: 0 };
      current.count += 1;
      current.calories += numeric(row.calories_kcal);
      map.set(row.food_name, current);
      return map;
    }, new Map<string, { count: number; calories: number }>()),
  )
    .sort((a, b) => b[1].count - a[1].count || b[1].calories - a[1].calories)
    .slice(0, 5)
    .map(([name, meta]) => `${name} (${meta.count})`)
    .join(', ');

  const goalDays = dailyRows.filter((row) => calcGoalBand(row.calories_kcal, input.goals.calorie_goal) === 'On/Above').length;

  return [
    { Metric: 'User', Value: input.userFirstName ?? 'User', Notes: null },
    { Metric: 'Date Range', Value: `${input.rangeStart} to ${input.rangeEnd}`, Notes: null },
    { Metric: 'Logged Days', Value: totalDays, Notes: null },
    { Metric: 'Food Rows', Value: input.foodRows.length, Notes: null },
    { Metric: 'Supplement Rows', Value: input.supplementRows.length, Notes: null },
    { Metric: 'Total Calories', Value: round(totals.calories), Notes: null },
    { Metric: 'Avg Calories / Day', Value: totalDays ? round(totals.calories / totalDays) : null, Notes: null },
    { Metric: 'Avg Protein / Day (g)', Value: totalDays ? round(totals.protein / totalDays) : null, Notes: null },
    { Metric: 'Avg Carbs / Day (g)', Value: totalDays ? round(totals.carbs / totalDays) : null, Notes: null },
    { Metric: 'Avg Fat / Day (g)', Value: totalDays ? round(totals.fat / totalDays) : null, Notes: null },
    { Metric: 'Avg Fiber / Day (g)', Value: totalDays ? round(totals.fiber / totalDays) : null, Notes: null },
    { Metric: 'Days At/Above Calorie Goal', Value: goalDays, Notes: input.goals.calorie_goal ?? 'No goal set' },
    { Metric: 'Top Foods', Value: topFoods || 'None', Notes: 'Top 5 by frequency' },
  ];
}

function buildMetadataRows(input: ExportWorkbookInput): Array<Record<string, string | number | null>> {
  return [
    { Key: 'Generated At', Value: new Date().toISOString() },
    { Key: 'Workbook', Value: 'NutriBot Export' },
    { Key: 'Range Start', Value: input.rangeStart },
    { Key: 'Range End', Value: input.rangeEnd },
    { Key: 'Food Rows', Value: input.foodRows.length },
    { Key: 'Daily Rows', Value: input.dailyRows.length },
    { Key: 'Weekly Rows', Value: input.weeklyRows.length },
    { Key: 'Micronutrient Rows', Value: input.micronutrientRows.length },
    { Key: 'Supplement Rows', Value: input.supplementRows.length },
  ];
}

function buildDailyTotalsRows(
  dailyRows: ExportDailyTotalRow[],
  foodRows: ExportFoodLogRow[],
): Array<Record<string, string | number | null>> {
  const mealByDay = new Map<string, Record<string, number>>();
  for (const row of foodRows) {
    const key = row.log_date;
    const current = mealByDay.get(key) ?? { Breakfast: 0, Lunch: 0, Dinner: 0, Snacks: 0 };
    current[mealLabel(row.meal_type)] = (current[mealLabel(row.meal_type)] ?? 0) + numeric(row.calories_kcal);
    mealByDay.set(key, current);
  }

  return dailyRows.map((row) => {
    const meals = mealByDay.get(row.log_date) ?? { Breakfast: 0, Lunch: 0, Dinner: 0, Snacks: 0 };
    return {
      Date: row.log_date,
      'Calories (kcal)': round(row.calories_kcal),
      'Protein (g)': round(row.protein_g),
      'Carbs (g)': round(row.carbs_g),
      'Fat (g)': round(row.fat_g),
      'Fiber (g)': round(row.fiber_g),
      'Sugar (g)': round(row.sugar_g),
      'Breakfast Calories': round(meals.Breakfast),
      'Lunch Calories': round(meals.Lunch),
      'Dinner Calories': round(meals.Dinner),
      'Snacks Calories': round(meals.Snacks),
    };
  });
}

function buildMealSummaryRows(foodRows: ExportFoodLogRow[]): Array<Record<string, string | number | null>> {
  const grouped = new Map<string, {
    date: string;
    meal: string;
    itemCount: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>();

  for (const row of foodRows) {
    const meal = mealLabel(row.meal_type);
    const key = `${row.log_date}__${meal}`;
    const current = grouped.get(key) ?? {
      date: row.log_date,
      meal,
      itemCount: 0,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    };
    current.itemCount += 1;
    current.calories += numeric(row.calories_kcal);
    current.protein += numeric(row.protein_g);
    current.carbs += numeric(row.carbs_g);
    current.fat += numeric(row.fat_g);
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.meal.localeCompare(b.meal))
    .map((row) => ({
      Date: row.date,
      Meal: row.meal,
      'Item Count': row.itemCount,
      'Calories (kcal)': round(row.calories),
      'Protein (g)': round(row.protein),
      'Carbs (g)': round(row.carbs),
      'Fat (g)': round(row.fat),
    }));
}

function buildFoodItemRows(foodRows: ExportFoodLogRow[]): Array<Record<string, string | number | null>> {
  return [...foodRows]
    .sort((a, b) => a.log_date.localeCompare(b.log_date) || a.created_at.localeCompare(b.created_at))
    .map((row) => ({
      Date: row.log_date,
      Meal: mealLabel(row.meal_type),
      'Food Name': row.food_name,
      Quantity: round(row.quantity),
      Unit: row.unit,
      'Calories (kcal)': round(row.calories_kcal),
      'Protein (g)': round(row.protein_g),
      'Carbs (g)': round(row.carbs_g),
      'Fat (g)': round(row.fat_g),
      'Fiber (g)': round(row.fiber_g),
      'Sugar (g)': round(row.sugar_g),
      'Sodium (mg)': round(row.sodium_mg),
      'Potassium (mg)': round(row.potassium_mg),
      CreatedAt: row.created_at,
    }));
}

function buildWeeklyTrendRows(
  rows: ExportWeeklyAverageRow[],
  goals: ExportGoalContext,
): Array<Record<string, string | number | null>> {
  let previousCalories: number | null = null;
  return rows.map((row) => {
    const result = {
      'Week Start': row.week_start,
      'Calories (kcal)': round(row.calories_kcal),
      'Protein (g)': round(row.protein_g),
      'Carbs (g)': round(row.carbs_g),
      'Fat (g)': round(row.fat_g),
      'Fiber (g)': round(row.fiber_g),
      'Calories % Goal': goals.calorie_goal ? round((numeric(row.calories_kcal) / goals.calorie_goal) * 100, 1) : null,
      'Protein % Goal': goals.protein_goal_g ? round((numeric(row.protein_g) / goals.protein_goal_g) * 100, 1) : null,
      'Carbs % Goal': goals.carb_goal_g ? round((numeric(row.carbs_g) / goals.carb_goal_g) * 100, 1) : null,
      'Fat % Goal': goals.fat_goal_g ? round((numeric(row.fat_g) / goals.fat_goal_g) * 100, 1) : null,
      Trend: trendArrow(row.calories_kcal, previousCalories),
    };
    previousCalories = row.calories_kcal;
    return result;
  });
}

function buildMicronutrientRows(
  rows: ExportMicronutrientHeatmapRow[],
  rdaTargets: Record<string, number>,
): Array<Record<string, string | number | null>> {
  return rows.map((row) => {
    const output: Record<string, string | number | null> = { Date: row.log_date };
    for (const nutrient of MICRONUTRIENT_COLUMNS) {
      output[NUTRIENT_LABELS[nutrient]] = round(row[nutrient]);
      output[`${NUTRIENT_LABELS[nutrient]} %RDA`] = rdaTargets[nutrient]
        ? round((numeric(row[nutrient]) / rdaTargets[nutrient]) * 100, 1)
        : null;
    }
    return output;
  });
}

function buildGoalsVsActualRows(
  dailyRows: ExportDailyTotalRow[],
  goals: ExportGoalContext,
): Array<Record<string, string | number | null>> {
  return dailyRows.map((row) => ({
    Date: row.log_date,
    'Calorie Goal': goals.calorie_goal,
    'Calories Actual': round(row.calories_kcal),
    'Calories Delta': goals.calorie_goal ? round(numeric(row.calories_kcal) - goals.calorie_goal) : null,
    'Calories Status': calcGoalBand(row.calories_kcal, goals.calorie_goal),
    'Protein Goal (g)': goals.protein_goal_g,
    'Protein Actual (g)': round(row.protein_g),
    'Protein Delta (g)': goals.protein_goal_g ? round(numeric(row.protein_g) - goals.protein_goal_g) : null,
    'Protein Status': calcGoalBand(row.protein_g, goals.protein_goal_g),
    'Carb Goal (g)': goals.carb_goal_g,
    'Carb Actual (g)': round(row.carbs_g),
    'Carb Delta (g)': goals.carb_goal_g ? round(numeric(row.carbs_g) - goals.carb_goal_g) : null,
    'Carb Status': calcGoalBand(row.carbs_g, goals.carb_goal_g),
    'Fat Goal (g)': goals.fat_goal_g,
    'Fat Actual (g)': round(row.fat_g),
    'Fat Delta (g)': goals.fat_goal_g ? round(numeric(row.fat_g) - goals.fat_goal_g) : null,
    'Fat Status': calcGoalBand(row.fat_g, goals.fat_goal_g),
    'Fiber Goal (g)': goals.fiber_goal_g,
    'Fiber Actual (g)': round(row.fiber_g),
    'Fiber Delta (g)': goals.fiber_goal_g ? round(numeric(row.fiber_g) - goals.fiber_goal_g) : null,
    'Fiber Status': calcGoalBand(row.fiber_g, goals.fiber_goal_g),
  }));
}

function buildSupplementRows(rows: ExportSupplementRow[]): Array<Record<string, string | number | null>> {
  return rows.map((row) => ({
    Date: row.log_date,
    Time: row.log_time,
    Name: row.name,
    Brand: row.brand,
    Form: row.form,
    Servings: round(row.servings),
    Dose: round(row.dose),
    'Calories (kcal)': round(row.calories_kcal),
    'Protein (g)': round(row.protein_g),
    'Carbs (g)': round(row.carbs_g),
    'Fat (g)': round(row.fat_g),
    'Type Color': row.type_color,
  }));
}

export interface ExportWorkbookInput {
  userFirstName: string | null;
  rangeStart: string;
  rangeEnd: string;
  foodRows: ExportFoodLogRow[];
  dailyRows: ExportDailyTotalRow[];
  weeklyRows: ExportWeeklyAverageRow[];
  micronutrientRows: ExportMicronutrientHeatmapRow[];
  supplementRows: ExportSupplementRow[];
  goals: ExportGoalContext;
  rdaTargets: Record<string, number>;
}

export function buildNutritionWorkbook(input: ExportWorkbookInput): Uint8Array {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: 'NutriBot Export',
    Subject: `Nutrition export ${input.rangeStart} to ${input.rangeEnd}`,
    Author: 'NutriBot',
    CreatedDate: new Date(),
  };

  const dailyRows = input.dailyRows.length ? input.dailyRows : makeTotalsByDayRows(input.foodRows);

  appendSheet(
    wb,
    'Summary',
    buildSummaryRows(input, dailyRows),
    ['Metric', 'Value', 'Notes'],
    [28, 18, 42],
  );

  appendSheet(
    wb,
    'Daily Totals',
    buildDailyTotalsRows(dailyRows, input.foodRows),
    [
      'Date',
      'Calories (kcal)',
      'Protein (g)',
      'Carbs (g)',
      'Fat (g)',
      'Fiber (g)',
      'Sugar (g)',
      'Breakfast Calories',
      'Lunch Calories',
      'Dinner Calories',
      'Snacks Calories',
    ],
  );

  appendSheet(
    wb,
    'Meal Summary',
    buildMealSummaryRows(input.foodRows),
    ['Date', 'Meal', 'Item Count', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)'],
  );

  appendSheet(
    wb,
    'Food Items',
    buildFoodItemRows(input.foodRows),
    [
      'Date',
      'Meal',
      'Food Name',
      'Quantity',
      'Unit',
      'Calories (kcal)',
      'Protein (g)',
      'Carbs (g)',
      'Fat (g)',
      'Fiber (g)',
      'Sugar (g)',
      'Sodium (mg)',
      'Potassium (mg)',
      'CreatedAt',
    ],
  );

  appendSheet(
    wb,
    'Supplements',
    buildSupplementRows(input.supplementRows),
    ['Date', 'Time', 'Name', 'Brand', 'Form', 'Servings', 'Dose', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Type Color'],
  );

  appendSheet(
    wb,
    'Weekly Trends',
    buildWeeklyTrendRows(input.weeklyRows, input.goals),
    ['Week Start', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fiber (g)', 'Calories % Goal', 'Protein % Goal', 'Carbs % Goal', 'Fat % Goal', 'Trend'],
  );

  appendSheet(
    wb,
    'Micronutrients',
    buildMicronutrientRows(input.micronutrientRows, input.rdaTargets),
    ['Date', ...MICRONUTRIENT_COLUMNS.flatMap((nutrient) => [NUTRIENT_LABELS[nutrient], `${NUTRIENT_LABELS[nutrient]} %RDA`])],
  );

  appendSheet(
    wb,
    'Goals vs Actual',
    buildGoalsVsActualRows(dailyRows, input.goals),
    [
      'Date',
      'Calorie Goal',
      'Calories Actual',
      'Calories Delta',
      'Calories Status',
      'Protein Goal (g)',
      'Protein Actual (g)',
      'Protein Delta (g)',
      'Protein Status',
      'Carb Goal (g)',
      'Carb Actual (g)',
      'Carb Delta (g)',
      'Carb Status',
      'Fat Goal (g)',
      'Fat Actual (g)',
      'Fat Delta (g)',
      'Fat Status',
      'Fiber Goal (g)',
      'Fiber Actual (g)',
      'Fiber Delta (g)',
      'Fiber Status',
    ],
  );

  appendSheet(
    wb,
    'Metadata',
    buildMetadataRows(input),
    ['Key', 'Value'],
    [26, 38],
  );

  const output = XLSX.write(wb, {
    type: 'array',
    bookType: 'xlsx',
    compression: true,
  }) as ArrayBuffer;

  return new Uint8Array(output);
}
