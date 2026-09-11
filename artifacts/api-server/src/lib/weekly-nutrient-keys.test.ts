import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyHistoryKey } from "./weekly-nutrient-keys";

test("weeklyHistoryKey maps every snake_case vitamin to its camelCase weekly field", () => {
  const expected: Record<string, string> = {
    vitamin_d: "vitaminD",
    vitamin_a: "vitaminA",
    vitamin_c: "vitaminC",
    vitamin_b7: "vitaminB7",
    vitamin_e: "vitaminE",
    vitamin_k: "vitaminK",
    vitamin_b12: "vitaminB12",
    vitamin_b1: "vitaminB1",
    vitamin_b2: "vitaminB2",
    vitamin_b3: "vitaminB3",
    vitamin_b6: "vitaminB6",
  };
  for (const [key, field] of Object.entries(expected)) {
    assert.equal(weeklyHistoryKey(key), field, `${key} should resolve to ${field}`);
  }
});

test("weeklyHistoryKey passes through keys that already match the weekly shape", () => {
  for (const nutrient of ["protein", "iron", "calcium", "magnesium"]) {
    assert.equal(weeklyHistoryKey(nutrient), nutrient);
  }
});

test("a resolved weeklyHistoryKey reads real intake values (not 0)", () => {
  const weekPoint: Record<string, number | string> = {
    date: "2026-08-20",
    protein: 55,
    iron: 12,
    vitaminC: 40,
    vitaminB12: 2.1,
  };
  // The old bug looked up snake_case keys against a camelCase weeklyHistory,
  // so vitaminC / vitaminB12 silently fell back to 0.
  assert.equal(weekPoint[weeklyHistoryKey("vitamin_c")], 40);
  assert.equal(weekPoint[weeklyHistoryKey("vitamin_b12")], 2.1);
});