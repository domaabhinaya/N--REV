import { db, foodsTable } from "@workspace/db";
import { asc } from "drizzle-orm";
import type { FoodRow } from "@workspace/db";
import { hasExplicitCuisine, resolveCuisine, type SupportedCuisine } from "./cuisine";
import { cuisineAffinity } from "./meal-planner";
import { classifyCuisine } from "./food-classifier";

// Full-dataset candidates are cached (30 minutes) so the ~80k imported pool is
// not reloaded from Postgres on every request. Cuisine tags are precomputed at
// import time (see seed.ts), so recovery filtering never re-runs the keyword
// classifier over the whole pool.
const FOOD_CACHE_TTL_MS = 30 * 60 * 1000;

let foodCache: { rows: FoodRow[]; expiresAt: number } | null = null;
let foodCacheLoad: Promise<FoodRow[]> | null = null;

// Cache for countries and regions to avoid repeated DB queries
let countriesCache: { data: string[]; expiresAt: number } | null = null;
let regionsCache: Map<string, { data: string[]; expiresAt: number }> = new Map();

/**
 * Normalize a food name for matching.
 * Mirrors the Python norm_name behavior used in the dataset pipeline.
 */
export function normalizeFoodName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function lookupFoodByName(name: string): Promise<FoodRow | null> {
  const normalized = normalizeFoodName(name);
  if (!normalized) return null;

  const candidates = await db.select().from(foodsTable);
  const match = candidates.find((f) => normalizeFoodName(f.name) === normalized);
  return match ?? null;
}

/**
 * Returns the FULL imported food pool (primary + extended, primary-first by
 * insertion id), cached. Both recovery modes source their eligible candidate
 * set from here — no-cuisine directly, explicit-cuisine after `filterByCuisine`.
 */
export async function getAllFoodsForRecommendations(): Promise<FoodRow[]> {
  if (foodCache && foodCache.expiresAt > Date.now()) {
    return foodCache.rows;
  }

  if (!foodCacheLoad) {
    foodCacheLoad = db
      .select()
      .from(foodsTable)
      .orderBy(asc(foodsTable.id))
      .then((all) => {
        foodCache = { rows: all, expiresAt: Date.now() + FOOD_CACHE_TTL_MS };
        return all;
      })
      .finally(() => {
        foodCacheLoad = null;
      });
  }

  return foodCacheLoad;
}

/**
 * Cuisine membership check against the project's existing cuisine model:
 *   - `cuisineAffinity` (meal-planner.ts) matches explicit `cuisineTags` and the
 *     established name-keyword map;
 *   - `classifyCuisine` (food-classifier.ts) maps tags / name keywords / source.
 * A food matches when either recogniser identifies it as the resolved cuisine.
 */
export function matchesCuisine(food: FoodRow, cuisine: SupportedCuisine): boolean {
  return cuisineAffinity(food, cuisine) > 0 || classifyCuisine(food) === cuisine;
}

/**
 * Filter a food pool down to foods matching a RESOLVED cuisine. The cuisine
 * value must already be resolved through `resolveCuisine()` so a different valid
 * cuisine is never silently replaced with the default.
 */
export function filterByCuisine(foods: FoodRow[], cuisine: SupportedCuisine): FoodRow[] {
  return foods.filter((f) => matchesCuisine(f, cuisine));
}

/**
 * The authoritative backend selection of recovery-plan food candidates.
 *
 * MODE 1 — NO EXPLICIT CUISINE:
 *   The full imported food pool is eligible and flows straight to the existing
 *   diet / allergy / meal / nutrient ranking filters. No cuisine filter is
 *   activated; nothing is silently reduced to a smaller primary-refined pool.
 *
 * MODE 2 — EXPLICIT CUISINE:
 *   The full imported pool is first filtered to the resolved explicit cuisine,
 *   then the existing filters/ranking run downstream. A selected cuisine is
 *   never replaced with the default Indian.
 */
export async function getRecoveryFoodCandidates(cuisine?: unknown): Promise<FoodRow[]> {
  const all = await getAllFoodsForRecommendations();
  if (hasExplicitCuisine(cuisine)) {
    return filterByCuisine(all, resolveCuisine(cuisine));
  }
  return all;
}

/**
 * Get all unique countries from the foods database (with caching)
 */
export async function getAllCountries(): Promise<string[]> {
  if (countriesCache && countriesCache.expiresAt > Date.now()) {
    return countriesCache.data;
  }

  try {
    const foods = await getAllFoodsForRecommendations();
    const countries = [...new Set(foods.map((f) => f.country).filter((c): c is string => c !== null))];
    const sorted = countries.sort();
    countriesCache = { data: sorted, expiresAt: Date.now() + FOOD_CACHE_TTL_MS };
    return sorted;
  } catch (error) {
    console.error("Failed to fetch countries:", error);
    return [];
  }
}

/**
 * Get all regions for a specific country (with caching)
 */
export async function getRegionsByCountry(country: string): Promise<string[]> {
  const cached = regionsCache.get(country);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const foods = await getAllFoodsForRecommendations();
    const regions = [
      ...new Set(
        foods
          .filter((f) => f.country === country)
          .map((f) => f.region)
          .filter((r): r is string => r !== null),
      ),
    ];
    const sorted = regions.sort();
    regionsCache.set(country, { data: sorted, expiresAt: Date.now() + FOOD_CACHE_TTL_MS });
    return sorted;
  } catch (error) {
    console.error(`Failed to fetch regions for ${country}:`, error);
    return [];
  }
}

/**
 * Filter foods by country and optional region
 */
export async function getFoodsByCountry(
  country: string,
  region?: string,
): Promise<FoodRow[]> {
  try {
    const foods = await getAllFoodsForRecommendations();

    let filtered = foods.filter((f) => f.country === country);
    if (region) {
      filtered = filtered.filter((f) => f.region === region);
    }
    return filtered;
  } catch (error) {
    console.error(`Failed to fetch foods by country ${country}:`, error);
    return [];
  }
}