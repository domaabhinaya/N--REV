import { test } from "node:test";
import assert from "node:assert/strict";
import type { FoodRow } from "@workspace/db";
import { assertPrimaryRefinedOnly, matchesCuisine, filterByCuisine } from "./food-lookup";
import { selectRecoveryDatasetSource, hasExplicitCuisine, resolveCuisine } from "./cuisine";
import type { NutrientKey } from "./recovery-engine";
import type { PlannerFood } from "./meal-planner";
import { generateRecoveryPlan } from "./meal-planner";

// ===========================================================================
// PERMANENT BUSINESS RULE test coverage for the recovery-plan dataset source.
//
// There are exactly two dataset-selection modes:
//
//   MODE 1 — NO CUISINE SELECTED  => PRIMARY REFINED FOOD DATASET ONLY.
//            The secondary dataset must never be used as a source, a fallback,
//            a ranking source, a nutrition fallback, or an automatic expansion.
//
//   MODE 2 — EXPLICIT CUISINE     => PRIMARY + SECONDARY combined into one food
//            pool, then filtered to the resolved cuisine, then the existing
//            diet/allergy/meal/nutrition filters and recovery ranking.
//
// These tests exercise the pure, authoritative source-selection, cuisine-filter
// and provenance guard logic without touching a live database.
// ===========================================================================

const ZERO = {
  protein: 0,
  iron: 0,
  calcium: 0,
  vitaminD: 0,
  magnesium: 0,
  vitaminA: 0,
  vitaminC: 0,
  vitaminB7: 0,
  vitaminE: 0,
  vitaminK: 0,
  vitaminB1: 0,
  vitaminB2: 0,
  vitaminB3: 0,
  vitaminB6: 0,
  vitaminB12: 0,
};

function food(
  id: number,
  name: string,
  tier: string,
  protein = 0,
  cuisineTags: string[] = [],
  dietTags: string[] = [],
): FoodRow {
  return {
    id,
    name,
    servingSize: "1 serving",
    tier,
    dietTags,
    mealTags: [],
    cuisineTags,
    country: null,
    region: null,
    source: tier === "primary" ? "primary-refined" : "secondary-extended",
    ...ZERO,
    protein,
  } as unknown as FoodRow;
}

const TARGETS: Record<NutrientKey, number> = {
  protein: 0, iron: 0, calcium: 0, vitamin_d: 0, magnesium: 0,
  vitamin_a: 0, vitamin_c: 0, vitamin_k: 0, vitamin_e: 0, vitamin_b7: 0,
  vitamin_b6: 0, vitamin_b1: 0, vitamin_b2: 0, vitamin_b3: 0, vitamin_b12: 0,
};

// Cuisine-tagged fixtures. These are the deterministic, reliable-metadata path
// (explicit cuisineTags) used to verify combined + cuisine filtering.
const PRIMARY_INDIAN = food(1, "Moong Dal", "primary", 14, ["north_indian"]);
const SECONDARY_INDIAN = food(2, "Sambar", "extended", 8, ["south_indian"]);
const PRIMARY_ASIAN = food(3, "Vegetable Stir Fry", "primary", 10, ["asian"]);
const SECONDARY_ASIAN = food(4, "Miso Soup", "extended", 6, ["asian"]);
const NON_VEG_INDIAN = food(5, "Chicken Curry", "extended", 25, ["north_indian"], ["non_vegetarian"]);

// TEST 11 verification — dataset source / provenance:
//   * every food entering the pool must be primary-refined (tier === "primary");
//   * a secondary (extended) food that reaches the pool is a hard error, so the
//     secondary dataset can never silently appear in a no-cuisine plan.
test("assertPrimaryRefinedOnly accepts a primary-only pool", () => {
  const pool = [food(1, "Dal", "primary"), food(2, "Spinach", "primary")];
  const out = assertPrimaryRefinedOnly(pool);
  assert.equal(out.length, 2);
  assert.ok(out.every((f) => f.tier === "primary"));
});

test("assertPrimaryRefinedOnly rejects any secondary/extended food (provenance)", () => {
  const pool = [food(1, "Dal", "primary"), food(2, "Secondary Dish", "extended")];
  assert.throws(() => assertPrimaryRefinedOnly(pool), /non-primary food/);
});

// TEST 9: no cuisine + recovery requirements — primary foods are still ranked
// by the existing recovery/nutritional logic when the candidate pool is pure
// primary-refined.
test("no cuisine: primary-only pool is still ranked by recovery/nutritional logic", () => {
  const primary = [
    food(1, "Low Protein Food", "primary", 1),
    food(2, "High Protein Food", "primary", 30),
  ] as unknown as PlannerFood[];

  // nutrient priority for protein is "high" so higher-protein primary food ranks first.
  const plan = generateRecoveryPlan(primary, "vegetarian", null, [
    { nutrient: "protein", priority: "high", score: 3, dailyTarget: 50, unit: "g", foodSources: [], reasons: [] },
  ], TARGETS, undefined, 1);
  const names = [...plan.days[0].breakfast, ...plan.days[0].lunch, ...plan.days[0].dinner, ...plan.days[0].snacks]
    .map((i) => i.name);
  assert.ok(names.includes("High Protein Food"));
});

// no cuisine must mean primary-refined source (never "combined"/secondary).
test("no cuisine resolves to primary-refined source", () => {
  assert.equal(hasExplicitCuisine(undefined), false);
  assert.equal(selectRecoveryDatasetSource(undefined), "primary-refined");
  assert.equal(selectRecoveryDatasetSource(null), "primary-refined");
  assert.equal(selectRecoveryDatasetSource(""), "primary-refined");
  assert.equal(selectRecoveryDatasetSource("   "), "primary-refined");
});

// explicit cuisine now uses the COMBINED primary+secondary source.
test("explicit cuisine resolves to the combined primary+secondary source", () => {
  assert.equal(hasExplicitCuisine("Asian"), true);
  assert.equal(selectRecoveryDatasetSource("Indian"), "combined");
  assert.equal(selectRecoveryDatasetSource("North Indian"), "combined");
  assert.equal(selectRecoveryDatasetSource("South Indian"), "combined");
  assert.equal(selectRecoveryDatasetSource("Asian"), "combined");
});

// ===========================================================================
// MODE 2 — EXPLICIT CUISINE uses the combined (primary + secondary) pool,
// filtered to the resolved cuisine, then the existing recovery filters/ranking.
// ===========================================================================

// TEST D — explicit Indian: combined + Indian filter; valid secondary foods
// participate and a plan can include them.
test("explicit Indian: combined pool filtered to Indian keeps primary AND secondary food", () => {
  const pool = filterByCuisine([PRIMARY_INDIAN, SECONDARY_INDIAN, SECONDARY_ASIAN], resolveCuisine("Indian"));
  const names = pool.map((f) => f.name);
  assert.ok(names.includes("Moong Dal"), "primary Indian food retained");
  assert.ok(names.includes("Sambar"), "secondary Indian food retained");
  assert.ok(!names.includes("Miso Soup"), "non-Indian secondary food excluded");

  // provenance is preserved: both tiers are present in the cuisine-filtered pool.
  const tiers = new Set(pool.map((f) => f.tier));
  assert.deepEqual(tiers, new Set(["primary", "extended"]));

  // the recovery plan can include the SECONDARY food after cuisine filtering.
  const plan = generateRecoveryPlan(pool as unknown as PlannerFood[], "vegetarian", null, [], TARGETS, "Indian", 1);
  const dayFoods = plan.days.flatMap((d) => [...d.breakfast, ...d.lunch, ...d.dinner, ...d.snacks].map((i) => i.name));
  assert.ok(dayFoods.includes("Sambar"), "secondary Indian food appears in the plan");
});

// TEST E — explicit non-Indian supported cuisine is combined + filtered and is
// NEVER replaced by Indian.
test("explicit non-Indian cuisine (Asian): combined + Asian filter, never replaced with Indian", () => {
  assert.equal(resolveCuisine("Asian"), "Asian");
  const combined = [PRIMARY_INDIAN, SECONDARY_INDIAN, PRIMARY_ASIAN, SECONDARY_ASIAN];
  const pool = filterByCuisine(combined, resolveCuisine("Asian"));
  const names = pool.map((f) => f.name);
  assert.ok(names.includes("Vegetable Stir Fry"), "primary Asian food retained");
  assert.ok(names.includes("Miso Soup"), "secondary Asian food retained");
  assert.ok(!names.includes("Moong Dal"), "Indian food excluded from Asian filter");
  assert.ok(!names.includes("Sambar"), "South Indian food excluded from Asian filter");
  assert.equal(selectRecoveryDatasetSource("Asian"), "combined");
});

// TEST F — case normalization: all spellings resolve identically through the
// existing resolution logic.
test("case normalization: Indian / indian / INDIAN resolve consistently for filtering", () => {
  for (const v of ["Indian", "indian", "INDIAN", "  indian ", "inDian"]) {
    const resolved = resolveCuisine(v);
    assert.equal(resolved, "Indian");
    const pool = filterByCuisine([PRIMARY_INDIAN, SECONDARY_INDIAN, SECONDARY_ASIAN], resolved);
    assert.deepEqual(new Set(pool.map((f) => f.name)), new Set(["Moong Dal", "Sambar"]), `spelling "${v}"`);
  }
});

// TEST G — allergy + explicit cuisine: an excluded food must never appear.
test("allergy + explicit cuisine: excluded secondary food never appears", () => {
  const pool = filterByCuisine([PRIMARY_INDIAN, SECONDARY_INDIAN], resolveCuisine("Indian"));
  const plan = generateRecoveryPlan(pool as unknown as PlannerFood[], "vegetarian", "sambar", [], TARGETS, "Indian", 1);
  const dayFoods = plan.days.flatMap((d) => [...d.breakfast, ...d.lunch, ...d.dinner, ...d.snacks].map((i) => i.name));
  assert.ok(dayFoods.includes("Moong Dal"));
  assert.ok(!dayFoods.includes("Sambar"), "allergen food must be filtered out");
});

// TEST H — diet + explicit cuisine: only foods compatible with the diet.
test("diet + explicit cuisine: only diet-compatible foods are planned", () => {
  const pool = filterByCuisine([PRIMARY_INDIAN, NON_VEG_INDIAN], resolveCuisine("Indian"));
  assert.equal(pool.length, 2, "both foods are Indian-family and enter the cuisine pool");
  const plan = generateRecoveryPlan(pool as unknown as PlannerFood[], "vegetarian", null, [], TARGETS, "Indian", 1);
  const dayFoods = plan.days.flatMap((d) => [...d.breakfast, ...d.lunch, ...d.dinner, ...d.snacks].map((i) => i.name));
  assert.ok(dayFoods.includes("Moong Dal"));
  assert.ok(!dayFoods.includes("Chicken Curry"), "non-vegetarian food excluded for a vegetarian diet");
});
// TEST I — explicit cuisine with no matching foods yields a clear empty/error
// state; the cuisine is never silently switched.
test("explicit cuisine with no matching foods yields an empty/error state (no silent switch)", () => {
  // Only Indian foods in the pool, but the user explicitly selected Asian.
  const pool = filterByCuisine([PRIMARY_INDIAN, SECONDARY_INDIAN], resolveCuisine("Asian"));
  assert.equal(pool.length, 0, "no foods matched the selected cuisine");
  // generating from an empty pool produces a plan with zero meals — it does NOT
  // reinterpret the selection as Indian or fall back to all cuisines.
  const plan = generateRecoveryPlan(pool as unknown as PlannerFood[], "vegetarian", null, [], TARGETS, "Asian", 1);
  const hasMeals = plan.days.some((d) => d.breakfast.length || d.lunch.length || d.dinner.length || d.snacks.length);
  assert.equal(hasMeals, false);
});

// STEP 15 (Western) — a valid secondary record can also participate in an
// explicit cuisine via the established upstream-source (OpenFoodFacts / USDA)
// cuisine classifier, proving secondary participation is not limited to
// explicit cuisine-tag fixtures.
test("explicit Western: secondary food classified via upstream source metadata is retained", () => {
  const usaFood = {
    ...food(6, "Sliced Bread", "extended", 9, []),
    source: "openfoodfacts",
  };
  assert.equal(matchesCuisine(usaFood, resolveCuisine("Western")), true);
  const pool = filterByCuisine([usaFood as FoodRow, PRIMARY_INDIAN], resolveCuisine("Western"));
  assert.deepEqual(pool.map((f) => f.name), ["Sliced Bread"]);
});

// ===========================================================================
// MODE 1 — NO CUISINE remains PRIMARY REFINED ONLY (regression protection).
// ===========================================================================

// TEST A/B/C — every no-cuisine shape must resolve to primary-refined and can
// never pull in a secondary food.
test("no cuisine (undefined) stays primary-refined; secondary food in the pool is a hard error", () => {
  assert.equal(hasExplicitCuisine(undefined), false);
  assert.equal(selectRecoveryDatasetSource(undefined), "primary-refined");
  assert.throws(() => assertPrimaryRefinedOnly([SECONDARY_ASIAN]), /non-primary food/);
});

test("empty cuisine stays primary-refined; secondary food in the pool is a hard error", () => {
  assert.equal(hasExplicitCuisine(""), false);
  assert.equal(selectRecoveryDatasetSource(""), "primary-refined");
  assert.throws(() => assertPrimaryRefinedOnly([SECONDARY_INDIAN]), /non-primary food/);
});

test("whitespace cuisine stays primary-refined; secondary food in the pool is a hard error", () => {
  assert.equal(hasExplicitCuisine("   "), false);
  assert.equal(selectRecoveryDatasetSource("   "), "primary-refined");
  assert.throws(() => assertPrimaryRefinedOnly([SECONDARY_ASIAN]), /non-primary food/);
});

// TEST J — CRITICAL regression: implementing the combined explicit-cuisine mode
// must NOT contaminate the default no-cuisine path.
test("REGRESSION: no-cuisine path is still primary refined ONLY after combined mode", () => {
  for (const v of [undefined, null, "", "   ", " \t\n "]) {
    assert.equal(selectRecoveryDatasetSource(v), "primary-refined", `source for ${JSON.stringify(v)}`);
  }
  // explicit and no-cuisine are truly distinct:
  assert.equal(selectRecoveryDatasetSource(undefined), "primary-refined");
  assert.equal(selectRecoveryDatasetSource("Indian"), "combined");
  // the runtime provenance guard still rejects any secondary food:
  const combined = [food(1, "Dal", "primary"), food(2, "Secondary Dish", "extended")];
  assert.throws(() => assertPrimaryRefinedOnly(combined), /non-primary food/);
});
// ===========================================================================
// STEP 5 / 6 — CUISINE CLASSIFICATION PRECISION (regression protection).
// Generic commodity / ingredient foods must NOT be force-classified into a
// cuisine merely because a generic word occurs in the name. This prevents the
// MODE 2 combined+cuisine filter from pulling obviously-unrelated foods into an
// explicit-cuisine plan (e.g. "Peanut Butter" into North Indian, "Green Beans"
// into Mexican).
// ===========================================================================
function namedFood(id: number, name: string, tier = "primary", source?: string): FoodRow {
  return { ...food(id, name, tier), source: source ?? null };
}

test("cuisine filter does NOT classify generic commodity foods (false-positive regression)", () => {
  // "butter" (a generic dairy/spread) must not imply North Indian.
  assert.equal(matchesCuisine(namedFood(1, "Peanut Butter"), resolveCuisine("North Indian")), false);
  assert.equal(matchesCuisine(namedFood(2, "Buttermilk"), resolveCuisine("North Indian")), false);
  assert.equal(matchesCuisine(namedFood(3, "Butter"), resolveCuisine("North Indian")), false);

  // "bean" / "corn" (generic legumes/grain) must not imply Mexican.
  assert.equal(matchesCuisine(namedFood(4, "Green Beans"), resolveCuisine("Mexican")), false);
  assert.equal(matchesCuisine(namedFood(5, "10 Bean Soup Mix"), resolveCuisine("Mexican")), false);
  assert.equal(matchesCuisine(namedFood(6, "Sweet Corn"), resolveCuisine("Mexican")), false);

  // "coconut" (generic ingredient/commodity) must not imply South Indian.
  assert.equal(matchesCuisine(namedFood(7, "Coconut Oil"), resolveCuisine("South Indian")), false);

  // "soy" (generic commodity) must not imply Asian.
  assert.equal(matchesCuisine(namedFood(8, "Soy Milk"), resolveCuisine("Asian")), false);

  // "lentil" / "olive" (generic ingredients) must not imply Mediterranean.
  assert.equal(matchesCuisine(namedFood(9, "Lentil Soup"), resolveCuisine("Mediterranean")), false);
  assert.equal(matchesCuisine(namedFood(10, "Olive Oil"), resolveCuisine("Mediterranean")), false);
  // An "OpenFoodFacts" upstream source must not force these into Western either,
  // because the datasets carry no such source and we must not fabricate it.
  assert.equal(matchesCuisine(namedFood(11, "Butter", "primary", "openfoodfacts"), resolveCuisine("North Indian")), false);
});

test("cuisine filter still matches genuine, cuisine-specific dishes (precision control)", () => {
  assert.equal(matchesCuisine(namedFood(1, "Paneer Tikka"), resolveCuisine("North Indian")), true);
  assert.equal(matchesCuisine(namedFood(2, "Dosa Sambar"), resolveCuisine("South Indian")), true);
  assert.equal(matchesCuisine(namedFood(3, "Beef Taco"), resolveCuisine("Mexican")), true);
  assert.equal(matchesCuisine(namedFood(4, "Hummus"), resolveCuisine("Mediterranean")), true);
  assert.equal(matchesCuisine(namedFood(5, "Vegetable Pad Thai"), resolveCuisine("Asian")), true);
  assert.equal(matchesCuisine(namedFood(6, "Moong Dal"), resolveCuisine("Indian")), true);
});