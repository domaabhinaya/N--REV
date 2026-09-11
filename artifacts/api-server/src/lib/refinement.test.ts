import { test } from "node:test";
import assert from "node:assert/strict";
import { refineCuisine, belongsToCuisine, normalizeCuisineTags } from "./cuisine-metadata";
import { buildFoodsFromRows, buildFoodDatasets } from "./seed";
import { generateRecoveryPlan, type PlannerFood } from "./meal-planner";
import type { NutrientKey } from "./recovery-engine";
import { ListFoodsResponse } from "@workspace/api-zod";

test("normalization preserves multiple supported cuisine associations", () => {
  assert.deepEqual(normalizeCuisineTags([" INDIA ", "Indian Food", "north-indian", "ASIAN", "unknown"]), ["asian", "indian", "north_indian"]);
});
test("classification rejects partial words, database provenance and conflicting cuisine evidence", () => {
  for (const name of ["Cordial", "Scandal cake", "Cumin", "Coriander", "Tofu", "Sliced Bread"]) assert.deepEqual(refineCuisine(name).tags, []);
  assert.equal(refineCuisine("Thai Paneer Curry").status, "ambiguous");
  assert.deepEqual(refineCuisine("Moong Dal").tags, ["indian"]);
  assert.equal(belongsToCuisine({ name: "Thai Paneer", cuisineTags: ["asian"] }, "Indian"), false);
});
test("import retains missing nutrients, explicit unknown cuisine and source category", () => {
  const { foods } = buildFoodsFromRows([{ food_name: "Paneer", food_category: "Dairy", cuisine_tags: [], protein_g: null, iron_mg: 0, calcium_mg: 2, vitamin_d_ug: null }], []);
  assert.equal(foods[0].protein, null);
  assert.equal(foods[0].iron, 0);
  assert.equal(foods[0].vitaminD, null);
  assert.equal(foods[0].foodCategory, "Dairy");
  assert.deepEqual(foods[0].cuisineTags, []);
  assert.doesNotThrow(() => ListFoodsResponse.parse({ items: [{ ...foods[0], id: 1, dietTags: [], mealTags: [] }], total: 1, limit: 1, offset: 0, hasMore: false }));
});
test("complete refined dataset preserves 82,073 identities and source tiers", () => {
  const { foods, report } = buildFoodDatasets();
  assert.equal(foods.length, 82073);
  assert.equal(new Set(foods.map(f => f.slug)).size, 82073);
  assert.equal(report.primary, 40000);
  assert.equal(report.secondary, 42073);
  assert.equal(foods.find(f => f.sourceId === "ASC001")?.vitaminD, null);
});
test("cuisine is a hard constraint before ranking, diet, allergy and meal exclusions remain active", () => {
  const base = { servingSize: "1 serving", protein: 1, iron: 0, calcium: 0, vitaminD: 0, tier: "primary", dietTags: ["vegetarian"], mealTags: ["lunch"], cuisineTags: ["indian"] };
  const foods = [
    { ...base, id: 1, name: "Moong Dal" },
    { ...base, id: 2, name: "High Protein Asian", cuisineTags: ["asian"], protein: 10000 },
    { ...base, id: 3, name: "Chicken Tikka", dietTags: ["non_vegetarian"] },
    { ...base, id: 4, name: "Peanut Chutney" },
  ] as PlannerFood[];
  for (const cuisine of [undefined, null, "", "  ", "invalid", "Indian"]) {
    const plan = generateRecoveryPlan(foods, "vegetarian", "peanut", [], {} as Record<NutrientKey, number>, cuisine, 1);
    assert.ok(plan.days[0].lunch.length > 0);
    assert.ok(plan.days[0].lunch.every(f => f.foodId === 1));
    assert.deepEqual(plan.days[0].breakfast, []);
  }
});
