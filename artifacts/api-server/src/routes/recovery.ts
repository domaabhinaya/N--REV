import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, profilesTable, foodsTable } from "@workspace/db";
import { GetRecoveryPlanParams, GetNutrientTargetsParams } from "@workspace/api-zod";
import { getPrioritiesWithFoodSources, targetsMap, toProfileInput } from "../lib/profile-service";
import { resolveCuisine, hasExplicitCuisine } from "../lib/cuisine";
import { generateRecoveryPlan, type PlannerFood } from "../lib/meal-planner";
import type { NutrientLine } from "../lib/nutrition-calculator";
import { generatePlanExplanation } from "../lib/recovery-engine";
import { getUserRoutineContext } from "../lib/user-routine-normalizer";
import { buildRoutineInsights } from "../lib/dataset-routine-helpers";
import { getRecoveryFoodCandidates } from "../lib/food-lookup";

const router: IRouter = Router();

function statusFromLines(nutrientLines: NutrientLine[]) {
  const map: Record<string, NutrientLine["status"]> = {};
  for (const line of nutrientLines) {
    // Map all nutrient keys to camelCase matching the frontend RecoveryPlanDayStatus type
    const key = line.nutrient === "vitamin_d" ? "vitaminD"
      : line.nutrient === "vitamin_a" ? "vitaminA"
      : line.nutrient === "vitamin_c" ? "vitaminC"
      : line.nutrient === "vitamin_b7" ? "vitaminB7"
      : line.nutrient === "vitamin_e" ? "vitaminE"
      : line.nutrient === "vitamin_k" ? "vitaminK"
      : line.nutrient === "vitamin_b12" ? "vitaminB12"
      : line.nutrient === "vitamin_b1" ? "vitaminB1"
      : line.nutrient === "vitamin_b2" ? "vitaminB2"
      : line.nutrient === "vitamin_b3" ? "vitaminB3"
      : line.nutrient === "vitamin_b6" ? "vitaminB6"
      : line.nutrient;
    map[key] = line.status;
  }
  return map as {
    protein: NutrientLine["status"];
    iron: NutrientLine["status"];
    calcium: NutrientLine["status"];
    vitaminD: NutrientLine["status"];
    magnesium: NutrientLine["status"];
    vitaminA: NutrientLine["status"];
    vitaminC: NutrientLine["status"];
    vitaminB7: NutrientLine["status"];
    vitaminE: NutrientLine["status"];
    vitaminK: NutrientLine["status"];
    vitaminB1: NutrientLine["status"];
    vitaminB2: NutrientLine["status"];
    vitaminB3: NutrientLine["status"];
    vitaminB6: NutrientLine["status"];
    vitaminB12: NutrientLine["status"];
  };
}

router.get("/profiles/:profileId/recovery-plan", async (req, res): Promise<void> => {
  const params = GetRecoveryPlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db.select().from(profilesTable).where(eq(profilesTable.id, params.data.profileId));
  if (!row) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  // AUTHORITATIVE recovery candidate source: when the cuisine is absent, this
  // builds the pool EXCLUSIVELY from the PRIMARY REFINED dataset. The secondary
  // dataset never enters the no-cuisine recovery pool. When an explicit cuisine
  // is selected, the pool is PRIMARY + SECONDARY combined and filtered to that
  // cuisine.
  const foods: PlannerFood[] = await getRecoveryFoodCandidates(row.cuisinePreference);
  const priorities = getPrioritiesWithFoodSources(row, foods);
  const targets = targetsMap(priorities);

  // Normalize the user's User Food Plate / Typical Daily Food Routine (stored in profiles.foodHabits)
  // and use it only for explainable context/inferences.
  const { normalized: routineNormalized } = getUserRoutineContext(row);
  const routineInsights = buildRoutineInsights(routineNormalized, priorities);

  const plan = generateRecoveryPlan(foods, row.dietType, row.allergies, priorities, targets, resolveCuisine(row.cuisinePreference), row.recoveryDuration ?? 30);

  // PERMANENT RULE (STEP 12): an explicitly selected cuisine must be respected.
  // If the cuisine-filtered pool yields ZERO eligible meals (after cuisine +
  // diet + allergy filters), we return the app's clear empty/error state instead
  // of silently falling back to all cuisines, to the un-filtered secondary
  // dataset, or to the default cuisine. The no-cuisine path is left untouched.
  if (hasExplicitCuisine(row.cuisinePreference)) {
    const hasAnyMeal = plan.days.some(
      (d) => d.breakfast.length > 0 || d.lunch.length > 0 || d.dinner.length > 0 || d.snacks.length > 0,
    );
    if (!hasAnyMeal) {
      res.status(404).json({
        error: "No foods matched the selected cuisine given your dietary restrictions and allergies.",
      });
      return;
    }
  }

  const profileInput = toProfileInput(row);
  const planExplanation = generatePlanExplanation(profileInput, priorities, routineInsights);

  res.json({
    profileId: row.id,
    durationDays: plan.durationDays,
    days: plan.days.map((day) => ({
      dayNumber: day.dayNumber,
      breakfast: day.breakfast.map((i) => `${i.name} (${i.servingSize})`),
      lunch: day.lunch.map((i) => `${i.name} (${i.servingSize})`),
      dinner: day.dinner.map((i) => `${i.name} (${i.servingSize})`),
      snacks: day.snacks.map((i) => `${i.name} (${i.servingSize})`),
      totals: day.totals,
      status: statusFromLines(day.nutrientLines),
    })),
    planExplanation,
  });
});

router.get("/profiles/:profileId/targets", async (req, res): Promise<void> => {
  const params = GetNutrientTargetsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db.select().from(profilesTable).where(eq(profilesTable.id, params.data.profileId));
  if (!row) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  // Use the same authoritative source so nutrient targets reflect the identical
  // primary-refined candidate set used by the recovery plan.
  const foods: PlannerFood[] = await getRecoveryFoodCandidates(row.cuisinePreference);
  const priorities = getPrioritiesWithFoodSources(row, foods);
  res.json(priorities);
});

export default router;
