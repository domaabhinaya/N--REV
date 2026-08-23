import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFoodsFromRows, foodSlug, type SourceFoodRow } from "./seed";

// ===========================================================================
// FULL-DATASET IMPORT CONTRACT regression tests.
//
// These exercise buildFoodsFromRows() with deterministic fixtures that mirror
// the source XLSX structure. They verify:
//   - no arbitrary food-count limitation exists anywhere in the pipeline
//   - deduplication happens ONLY for truly duplicated records (same slug)
//   - invalid rows are rejected and counted
//   - nutrient values survive mapping verbatim (never invented/converted)
//   - missing OPTIONAL nutrients are preserved as null (safe absence)
//   - the import is idempotent by construction (slug-keyed)
// ===========================================================================

function sourceRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    food_name: "Test Food",
    serving_size: "100 g",
    protein_g: 1,
    iron_mg: 0.5,
    calcium_mg: 10,
    vitamin_d_ug: 0,
    magnesium_mg: null,
    vitamin_a_ug: null,
    vitamin_c_mg: null,
    vitamin_b7_ug: null,
    vitamin_e_mg: null,
    vitamin_k_ug: null,
    vitamin_b12_ug: null,
    vitamin_b1_mg: null,
    vitamin_b2_mg: null,
    vitamin_b3_mg: null,
    vitamin_b6_mg: null,
    source: "test-source",
    food_code: "TC001",
    category: "Test",
    ...overrides,
  };
}

test("foodSlug produces a stable normalized identity key", () => {
  assert.equal(foodSlug("  Moong   Dal! "), foodSlug("moong dal"));
});

test("A/B: full dataset imports every valid row — no ~1,014-style cap", () => {
  // Build a fixture far larger than the old 1,014 limit to prove no hidden cap.
  const SIZE = 3000;
  const primary = Array.from({ length: SIZE }, (_, i) =>
    sourceRow({ food_name: `Fixture Food ${i}`, food_code: `F${i}` }),
  );
  const { foods, report } = buildFoodsFromRows(primary, []);
  assert.equal(report.sourceRows, SIZE);
  assert.ok(foods.length > 1014, "full pool must exceed the old 1,014 limitation");
  assert.equal(report.imported, SIZE);
  assert.equal(report.duplicates, 0);
  assert.equal(report.invalid, 0);
  assert.equal(report.primary, SIZE);
  assert.equal(report.secondary, 0);
});

test("B: imported count matches validated source count under documented rules", () => {
  const primary = [
    sourceRow({ food_name: "Alpha Food" }),
    sourceRow({ food_name: "Beta Food" }),
    // true duplicate of Alpha (same normalized name) -> counted as duplicate
    sourceRow({ food_name: "alpha  FOOD!!" }),
    // missing name -> invalid/rejected
    sourceRow({ food_name: "" }),
  ];
  const extended = [sourceRow({ food_name: "Gamma Food" })];
  const { foods, report } = buildFoodsFromRows(primary, extended);

  assert.equal(report.sourceRows, 5);
  assert.equal(foods.length, 3); // Alpha, Beta, Gamma only
  assert.equal(report.imported, 3);
  assert.equal(report.duplicates, 1);
  assert.equal(report.invalid, 1);
  assert.equal(report.unique, 3);
  assert.equal(report.primarySourceRows, 4);
  assert.equal(report.secondarySourceRows, 1);
  // Tier provenance is preserved per source dataset.
  assert.ok(foods.find((f) => f.name === "Gamma Food")!.tier === "extended");
});

test("K: import mapping is deterministic and slug-keyed, enabling idempotent re-seeding", () => {
  const primary = [
    sourceRow({ food_name: "Idempotent Dish" }),
    sourceRow({ food_name: "Second Dish" }),
  ];
  const first = buildFoodsFromRows(primary, []);
  const second = buildFoodsFromRows(primary, []);
  // Pure mapping is fully deterministic — same slugs every run — so the
  // slug-keyed reconcile step in importFoodDatasets() matches existing rows
  // exactly and re-seeding never inserts duplicates.
  assert.equal(second.foods.length, first.foods.length);
  assert.deepEqual(
    second.foods.map((f) => f.slug),
    first.foods.map((f) => f.slug),
  );
  // Every imported row carries its stable identity key.
  for (const f of first.foods) {
    assert.ok(f.slug && f.slug.length > 0);
    assert.equal(f.slug, foodSlug(f.name));
  }
});

test("L/N: nutrient values survive import verbatim — never invented or converted", () => {
  const row = sourceRow({
    food_name: "Nutrient Fidelity Dish",
    protein_g: 13.25,
    iron_mg: 4.7,
    calcium_mg: 62,
    vitamin_d_ug: 1.1,
    magnesium_mg: 55.5,
    vitamin_c_mg: 8.25,
  });
  const { foods } = buildFoodsFromRows([row], []);
  const f = foods[0] as SourceFoodRow;
  assert.equal(f.protein, 13.25);
  assert.equal(f.iron, 4.7);
  assert.equal(f.calcium, 62);
  assert.equal(f.vitaminD, 1.1);
  assert.equal(f.magnesium, 55.5);
  assert.equal(f.vitaminC, 8.25);
  // Source provenance survives.
  assert.equal(f.source, "test-source");
  assert.equal(f.sourceId, "TC001");
  assert.equal(f.foodCategory, "Test");
});

test("M: missing optional nutrients are null (safe), never fabricated to 0 or defaults", () => {
  const row = sourceRow({ food_name: "Sparse Nutrient Dish" });
  const { foods, report } = buildFoodsFromRows([row], []);
  const f = foods[0];
  for (const key of ["magnesium", "vitaminA", "vitaminC", "vitaminB7", "vitaminE", "vitaminK", "vitaminB12", "vitaminB1", "vitaminB2", "vitaminB3", "vitaminB6"] as const) {
    assert.equal(f[key], null, `${key} must stay null when absent at source`);
  }
  assert.equal(f.hasAllOptional, false);
  assert.equal(report.missingOptional, 1);
  assert.equal(report.completeNutrients, 0);
});

test("M: a complete nutrient set is reported as completeNutrients", () => {
  const row = sourceRow({
    food_name: "Complete Dish",
    magnesium_mg: 1, vitamin_a_ug: 1, vitamin_c_mg: 1, vitamin_b7_ug: 1,
    vitamin_e_mg: 1, vitamin_k_ug: 1, vitamin_b12_ug: 1,
    vitamin_b1_mg: 1, vitamin_b2_mg: 1, vitamin_b3_mg: 1, vitamin_b6_mg: 1,
  });
  const { report } = buildFoodsFromRows([row], []);
  assert.equal(report.completeNutrients, 1);
  assert.equal(report.missingOptional, 0);
});

test("rows failing REQUIRED fields are rejected and counted, never defaulted silently", () => {
  const bad = [
    sourceRow({ food_name: "", protein_g: 5 }),                       // no name
    sourceRow({ food_name: "No Protein Dish", protein_g: null }),     // required nutrient absent
  ];
  const { foods, report } = buildFoodsFromRows(bad, []);
  // The nameless row is dropped outright; the protein-less row keeps its name
  // but is flagged in rejectedRequired (missing value recorded, not invented).
  assert.equal(foods.length, 1);
  assert.equal(report.invalid, 1);
  assert.ok(report.rejectedRequired >= 1);
  assert.deepEqual(foods[0].missingRequired, ["protein_g"]);
});


