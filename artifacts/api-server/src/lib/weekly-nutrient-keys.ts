/**
 * Maps a snake_case NutrientKey to the camelCase field name used in
 * WeeklyNutrientPoint (the `/dashboard` `weeklyHistory` entries).
 *
 * Priorities / active nutrients are keyed by the snake_case NutrientKey
 * (vitamin_d, vitamin_a, vitamin_b7, ...), while weeklyHistory exposes vitamins
 * under camelCase keys (vitaminD, vitaminA, vitaminB7, ...). Keys that already
 * match the weekly shape (protein, iron, calcium, magnesium, ...) pass through
 * unchanged so intake lookups never silently fall back to 0.
 */
export function weeklyHistoryKey(nutrient: string): string {
  switch (nutrient) {
    case "vitamin_d": return "vitaminD";
    case "vitamin_a": return "vitaminA";
    case "vitamin_c": return "vitaminC";
    case "vitamin_b7": return "vitaminB7";
    case "vitamin_e": return "vitaminE";
    case "vitamin_k": return "vitaminK";
    case "vitamin_b12": return "vitaminB12";
    case "vitamin_b1": return "vitaminB1";
    case "vitamin_b2": return "vitaminB2";
    case "vitamin_b3": return "vitaminB3";
    case "vitamin_b6": return "vitaminB6";
    default: return nutrient;
  }
}