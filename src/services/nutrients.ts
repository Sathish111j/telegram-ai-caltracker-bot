import { type FoodItem } from '../types/index.js';

const NUMERIC_NUTRIENT_KEYS: Array<keyof FoodItem> = [
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
];

export function rescaleNutrients(item: FoodItem, newQuantity: number): FoodItem {
  const factor = newQuantity / item.quantity;
  const next: FoodItem = { ...item, quantity: newQuantity };

  for (const key of NUMERIC_NUTRIENT_KEYS) {
    const value = next[key];
    if (typeof value === 'number') {
      (next[key] as number) = Number((value * factor).toFixed(2));
    }
  }

  return next;
}
