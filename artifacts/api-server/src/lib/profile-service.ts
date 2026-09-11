import type { ProfileRow } from "@workspace/db";
import { computeNutrientPriorities, type ProfileInput, type NutrientKey, type NutrientPriorityResult } from "./recovery-engine";
import { topFoodSourcesForNutrient, type PlannerFood } from "./meal-planner";
import { getAllFoodsForRecommendations } from "./food-lookup";

export function toProfileInput(row: ProfileRow): ProfileInput {
  return {
    age: row.age,
    gender: row.gender,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    dietType: row.dietType,
    symptoms: row.symptoms,
    hemoglobin: row.hemoglobin,
    ferritin: row.ferritin,
    vitaminB12Level: row.vitaminB12Level,
    vitaminDLevel: row.vitaminDLevel,
    serumCalcium: row.serumCalcium,
    totalProtein: row.totalProtein,
  };
}

// Profile priorities depend only on the profile row, which changes only via
// the profile endpoints. Caching per profileId avoids re-ranking 82k+ foods x
// 15 nutrients on every dashboard/suggestions/recovery-plan request.
const priorityCache = new Map<number, NutrientPriorityResult[]>();

export function invalidatePriorityCache(profileId?: number): void {
  if (profileId === undefined) {
    priorityCache.clear();
  } else {
    priorityCache.delete(profileId);
  }
}

/** Pre-filter the candidate pool by dietType ONCE, then rank each nutrient
 *  against that smaller set. The per-nutrient dietTag filter inside
 *  topFoodSourcesForNutrient is idempotent, so passing the pre-filtered array
 *  is behavior-preserving while avoiding 14 redundant passes over the pool. */
function dietFiltered(foods: PlannerFood[], dietType: string): PlannerFood[] {
  return foods.filter((f) => f.dietTags.length === 0 || f.dietTags.includes(dietType));
}

export function getPrioritiesWithFoodSources(row: ProfileRow, foods: PlannerFood[]): NutrientPriorityResult[] {
  const cached = priorityCache.get(row.id);
  if (cached) return cached;

  const priorities = computeNutrientPriorities(toProfileInput(row));
  const eligible = dietFiltered(foods, row.dietType);
  const result = priorities.map((p) => ({
    ...p,
    foodSources: topFoodSourcesForNutrient(eligible, p.nutrient, row.dietType, 6, row.cuisinePreference),
  }));
  priorityCache.set(row.id, result);
  return result;
}

export function targetsMap(priorities: NutrientPriorityResult[]): Record<NutrientKey, number> {
  const map = {} as Record<NutrientKey, number>;
  for (const p of priorities) {
    map[p.nutrient] = p.dailyTarget;
  }
  return map;
}

export async function getPrioritiesWithFoodSourcesAsync(row: ProfileRow): Promise<NutrientPriorityResult[]> {
  const foods = await getAllFoodsForRecommendations();
  return getPrioritiesWithFoodSources(row, foods);
}
