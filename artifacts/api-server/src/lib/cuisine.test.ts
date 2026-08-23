import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CUISINE,
  SUPPORTED_CUISINES,
  normalizeCuisine,
  isSupportedCuisine,
  resolveCuisine,
  hasExplicitCuisine,
  selectRecoveryDatasetSource,
  cuisineStatement,
  canonicalCuisine,
} from "./cuisine";

// Regression protection for the PERMANENT Indian default.
test("Indian is the permanent default cuisine (missing values)", () => {
  assert.equal(DEFAULT_CUISINE, "Indian");
  assert.equal(resolveCuisine(undefined), "Indian");
  assert.equal(resolveCuisine(null), "Indian");
});

test("empty / whitespace cuisine resolves to Indian", () => {
  assert.equal(resolveCuisine(""), "Indian");
  assert.equal(resolveCuisine("    "), "Indian");
  assert.equal(resolveCuisine(" \t\n  "), "Indian");
});

test("invalid / arbitrary cuisine resolves to Indian", () => {
  assert.equal(resolveCuisine("pizza"), "Indian");
  assert.equal(resolveCuisine("north-african fusion"), "Indian");
  assert.equal(resolveCuisine(42), "Indian");
  assert.equal(resolveCuisine({}), "Indian");
  assert.equal(resolveCuisine(["Indian"]), "Indian");
});

test("a valid selected cuisine is NEVER silently replaced with Indian", () => {
  assert.equal(resolveCuisine("Asian"), "Asian");
  assert.equal(resolveCuisine("North Indian"), "North Indian");
  assert.equal(resolveCuisine("South Indian"), "South Indian");
  assert.equal(resolveCuisine("Western"), "Western");
  assert.equal(resolveCuisine("Global"), "Global");
  assert.equal(resolveCuisine("Mediterranean"), "Mediterranean");
  assert.equal(resolveCuisine("Mexican"), "Mexican");
});

test("resolution is case-insensitive and separator-normalised", () => {
  assert.equal(resolveCuisine("indian"), "Indian");
  assert.equal(resolveCuisine("INDIAN"), "Indian");
  assert.equal(resolveCuisine(" asian "), "Asian");
  assert.equal(resolveCuisine("north_indian"), "North Indian");
  assert.equal(resolveCuisine("SOUTH INDIAN"), "South Indian");
});

test("all supported cuisines round-trip; unrecognised values are rejected", () => {
  for (const cuisine of SUPPORTED_CUISINES) {
    assert.equal(resolveCuisine(cuisine), cuisine);
    assert.equal(isSupportedCuisine(cuisine), true);
  }
  assert.equal(isSupportedCuisine("nope"), false);
  assert.equal(isSupportedCuisine(""), false);
  assert.equal(isSupportedCuisine(null), false);
});

test("normalizeCuisine handles non-strings and trims", () => {
  assert.equal(normalizeCuisine(null), "");
  assert.equal(normalizeCuisine(undefined), "");
  assert.equal(normalizeCuisine(123), "");
  assert.equal(normalizeCuisine("  Indian  "), "indian");
});

// Requirements 5/11: the AI generator is handed the RESOLVED cuisine and the
// statement clearly says recommendations must follow it.
test("cuisineStatement embeds the resolved cuisine (AI requirement)", () => {
  assert.ok(cuisineStatement("Asian").includes("Resolved cuisine: Asian"));
  assert.ok(cuisineStatement(resolveCuisine(undefined)).includes("Resolved cuisine: Indian"));
  assert.match(cuisineStatement("Indian"), /must follow this cuisine/);
});

// ===========================================================================
// "No cuisine" definition + PERMANENT dataset-source rule
// ===========================================================================
//
// PERMANENT BUSINESS RULE:
//   "WHEN THE USER DOES NOT EXPLICITLY SELECT A CUISINE, N-REV BUILDS THE
//    RECOVERY POOL FROM THE FULL IMPORTED FOOD DATASET WITHOUT A CUISINE
//    FILTER. A CUISINE FILTER IS ONLY APPLIED FOR AN EXPLICITLY SELECTED,
//    SUPPORTED CUISINE."
//
// TEST 1..5: every "no cuisine" shape must be recognised as NO cuisine selected
// (and therefore use the full imported pool with no cuisine filter).
test("no cuisine field / undefined / null / empty / whitespace -> NOT an explicit cuisine", () => {
  // TEST 1: no cuisine field (omitted)
  assert.equal(hasExplicitCuisine(undefined), false);
  // TEST 2: undefined
  assert.equal(hasExplicitCuisine(undefined), false);
  // TEST 3: null
  assert.equal(hasExplicitCuisine(null), false);
  // TEST 4: empty string
  assert.equal(hasExplicitCuisine(""), false);
  // TEST 5: whitespace-only
  assert.equal(hasExplicitCuisine("   "), false);
  assert.equal(hasExplicitCuisine(" \t\n "), false);
  // missing cuisine field (accessing an absent property yields undefined)
  const noCuisineProfile: { name: string; cuisinePreference?: string } = { name: "A" };
  assert.equal(hasExplicitCuisine(noCuisineProfile.cuisinePreference), false);
});

test("every 'no cuisine' shape uses the FULL imported pool with no cuisine filter", () => {
  assert.equal(selectRecoveryDatasetSource(undefined), "full-pool");
  assert.equal(selectRecoveryDatasetSource(null), "full-pool");
  assert.equal(selectRecoveryDatasetSource(""), "full-pool");
  assert.equal(selectRecoveryDatasetSource("   "), "full-pool");
  assert.equal(selectRecoveryDatasetSource(" \t\n "), "full-pool");
  assert.equal(selectRecoveryDatasetSource(123), "full-pool");
});

// ===========================================================================
// canonicalCuisine — the persistable profile value that preserves the
// "no cuisine selected" sentinel (MODE 1) vs an explicit cuisine (MODE 2).
// ===========================================================================
test("canonicalCuisine: no-cuisine / invalid values are persisted as null (never 'Indian')", () => {
  assert.equal(canonicalCuisine(undefined), null);
  assert.equal(canonicalCuisine(null), null);
  assert.equal(canonicalCuisine(""), null);
  assert.equal(canonicalCuisine("   "), null);
  assert.equal(canonicalCuisine(" \t\n "), null);
  assert.equal(canonicalCuisine(123), null);
  // an unrecognised cuisine is treated as "no cuisine selected", not Indian.
  assert.equal(canonicalCuisine("pizza"), null);
  assert.equal(canonicalCuisine("north-african fusion"), null);
});

test("canonicalCuisine: an explicit supported cuisine is persisted canonically", () => {
  assert.equal(canonicalCuisine("Indian"), "Indian");
  assert.equal(canonicalCuisine("indian"), "Indian");
  assert.equal(canonicalCuisine("INDIAN"), "Indian");
  assert.equal(canonicalCuisine("Asian"), "Asian");
  assert.equal(canonicalCuisine("North Indian"), "North Indian");
  assert.equal(canonicalCuisine("Mexico"), null); // "mexico" != "mexican" -> not supported
  assert.equal(canonicalCuisine(canonicalCuisine("  ASIAN  ")), "Asian");
  // explicit vs no-cuisine are genuinely distinct at the persistence boundary
  assert.notEqual(canonicalCuisine("Indian"), canonicalCuisine(undefined));
});

// TEST 6: an explicit cuisine is recognised as explicit and filters the full pool.
test("explicit cuisine filters the full imported pool to that cuisine", () => {
  for (const c of ["Indian", "North Indian", "South Indian", "Asian", "Western", "Global", "Mediterranean", "Mexican"]) {
    assert.equal(hasExplicitCuisine(c), true, `expected hasExplicitCuisine(${c}) to be true`);
    assert.equal(selectRecoveryDatasetSource(c), "cuisine-filtered", `explicit cuisine (${c}) filters the full pool`);
  }
  // case/space insensitive like the rest of the module
  assert.equal(hasExplicitCuisine("  ASIAN  "), true);
  assert.equal(hasExplicitCuisine("north_indian"), true);
  assert.equal(selectRecoveryDatasetSource("  ASIAN  "), "cuisine-filtered");
  assert.equal(selectRecoveryDatasetSource("north_indian"), "cuisine-filtered");
});