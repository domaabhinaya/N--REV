import { db, foodsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import type { FoodRow } from "@workspace/db";
import { selectRecoveryDatasetSource, resolveCuisine, type SupportedCuisine } from "./cuisine";
import { cuisineAffinity } from "./meal-planner";
import { classifyCuisine } from "./food-classifier";

const FOOD_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes instead of 5
// Loading every primary record (currently about 40k rows) transfers far more
// data than the planner can use and made a cold request take 60-90 seconds.
// A stable, sizeable candidate set keeps plans varied while making startup
// bounded. Ordering is important so every process builds the same plan.
const RECOMMENDATION_FOOD_LIMIT = 5000;
let foodCache: { rows: FoodRow[]; expiresAt: number } | null = null;
let foodCacheLoad: Promise<FoodRow[]> | null = null;

// Cache for the secondary (extended) tier, used ONLY by the explicit-cuisine
// combined path. It is kept separate from the primary cache so the no-cuisine
// path stays completely isolated from (and never triggers) a secondary load.
let extendedCache: { rows: FoodRow[]; expiresAt: number } | null = null;
let extendedCacheLoad: Promise<FoodRow[]> | null = null;

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

  // Search PRIMARY first by normalized name
  const primaryCandidates = await db
    .select()
    .from(foodsTable)
    .where(eq(foodsTable.tier, "primary"));

  const primaryMatch = primaryCandidates.find(
    (f) => normalizeFoodName(f.name) === normalized
  );
  if (primaryMatch) return primaryMatch;

  // Fallback to EXTENDED by normalized name
  const extendedCandidates = await db
    .select()
    .from(foodsTable)
    .where(eq(foodsTable.tier, "extended"));

  const extendedMatch = extendedCandidates.find(
    (f) => normalizeFoodName(f.name) === normalized
  );
  if (extendedMatch) return extendedMatch;

  return null;
}

export async function getAllFoodsForRecommendations(): Promise<FoodRow[]> {
  if (foodCache && foodCache.expiresAt > Date.now()) {
    return foodCache.rows;
  }

  // Deduplicate concurrent cold-cache requests from the dashboard's parallel queries.
  if (!foodCacheLoad) {
    foodCacheLoad = db
      .select()
      .from(foodsTable)
      .where(eq(foodsTable.tier, "primary"))
      .orderBy(asc(foodsTable.id))
      .limit(RECOMMENDATION_FOOD_LIMIT)
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
 * Returns ONLY the PRIMARY REFINED food dataset — a well-formed, explicit
 * wrapper around the primary-tier candidate set. Secondary (extended) foods are
 * never included here.
 */
export async function getPrimaryRefinedFoods(): Promise<FoodRow[]> {
  return getAllFoodsForRecommendations();
}

/**
 * Returns the SECONDARY (EXTENDED) food dataset. This tier is queried ONLY on
 * the explicit-cuisine combined path — never for a no-cuisine request. It is
 * cached independently of the primary cache so loading it can never contaminate
 * (or be triggered by) the no-cuisine primary-only pool.
 */
export async function getExtendedFoods(): Promise<FoodRow[]> {
  if (extendedCache && extendedCache.expiresAt > Date.now()) {
    return extendedCache.rows;
  }
  if (!extendedCacheLoad) {
    extendedCacheLoad = db
      .select()
      .from(foodsTable)
      .where(eq(foodsTable.tier, "extended"))
      .orderBy(asc(foodsTable.id))
      .limit(RECOMMENDATION_FOOD_LIMIT)
      .then((all) => {
        extendedCache = { rows: all, expiresAt: Date.now() + FOOD_CACHE_TTL_MS };
        return all;
      })
      .finally(() => {
        extendedCacheLoad = null;
      });
  }
  return extendedCacheLoad;
}

/**
 * The COMBINED internal food pool used by the explicit-cuisine path:
 *   PRIMARY (refined) + SECONDARY (extended), primary-first.
 *
 * It is constructed BEFORE any cuisine filter is applied so the selected
 * cuisine is matched across the whole internal food pool, not per-tier then
 * arbitrarily concatenated. Tier provenance is preserved on every row.
 */
export async function getCombinedFoods(): Promise<FoodRow[]> {
  const [primary, extended] = await Promise.all([getPrimaryRefinedFoods(), getExtendedFoods()]);
  return [...primary, ...extended];
}

/**
 * Cuisine membership check against the project's EXISTING, established cuisine
 * model. It does NOT invent a new classifier.
 *   - `cuisineAffinity` (meal-planner.ts) matches via explicit `cuisineTags`
 *     and the established name-keyword map; a value > 0 means the food belongs
 *     to that cuisine family.
 *   - `classifyCuisine` (food-classifier.ts) is a supplementary source that maps
 *     explicit tags / name keywords / upstream source (e.g. OpenFoodFacts, USDA)
 *     to a cuisine label.
 *
 * A food matches when either recogniser identifies it as the resolved cuisine.
 */
export function matchesCuisine(food: FoodRow, cuisine: SupportedCuisine): boolean {
  return cuisineAffinity(food, cuisine) > 0 || classifyCuisine(food) === cuisine;
}

/**
 * Filter a combined food pool down to foods matching a RESOLVED cuisine.
 * The cuisine value must already be resolved through the single authoritative
 * `resolveCuisine()` so case/whitespace normalization is consistent and a
 * different valid cuisine is never silently replaced with the default.
 */
export function filterByCuisine(foods: FoodRow[], cuisine: SupportedCuisine): FoodRow[] {
  return foods.filter((f) => matchesCuisine(f, cuisine));
}

/**
 * Runtime provenance guard. Every food entering the recovery-plan candidate
 * pool MUST be traceable to the PRIMARY REFINED dataset (tier === "primary").
 * If a non-primary food is ever found, that is a hard error — the secondary
 * dataset must never feed the no-cuisine recovery path.
 */
export function assertPrimaryRefinedOnly(foods: FoodRow[]): FoodRow[] {
  const nonPrimary = foods.find((f) => f.tier !== "primary");
  if (nonPrimary) {
    throw new Error(
      `[dataset-source] recovery candidate pool contains a non-primary food (id=${nonPrimary.id}, tier=${nonPrimary.tier}). The secondary dataset must never enter the recovery candidate pool.`,
    );
  }
  return foods;
}

/**
 * The authoritative backend selection of recovery-plan food candidates.
 *
 * This is the SINGLE place that answers "which dataset is eligible for this
 * recovery-plan request?" and it uses the same decision function
 * (`selectRecoveryDatasetSource`) that every recovery-plan code path relies on.
 *
 * PERMANENT BUSINESS RULES:
 *
 * MODE 1 — NO CUISINE SELECTED:
 *   candidate pool is built EXCLUSIVELY from the PRIMARY REFINED FOOD DATASET.
 *   The secondary (extended) dataset is not queried, merged, ranked, or used as
 *   a fallback for that request. A runtime provenance guard
 *   (`assertPrimaryRefinedOnly`) makes any secondary food a hard error.
 *
 * MODE 2 — EXPLICIT CUISINE SELECTED:
 *   PRIMARY + SECONDARY are combined into one pool, then filtered to the
 *   resolved selected cuisine. Diet/allergy/meal/nutrition filtering and the
 *   existing recovery ranking still run downstream on this cuisine-filtered
 *   candidate pool (see meal-planner.generateRecoveryPlan).
 */
export async function getRecoveryFoodCandidates(cuisine?: unknown): Promise<FoodRow[]> {
  const source = selectRecoveryDatasetSource(cuisine);
  if (source === "combined") {
    // MODE 2 — explicit cuisine: combined pool, then cuisine filter.
    const combined = await getCombinedFoods();
    return filterByCuisine(combined, resolveCuisine(cuisine));
  }
  // MODE 1 — no cuisine: PRIMARY REFINED DATASET ONLY (secondary never appears).
  return assertPrimaryRefinedOnly(await getPrimaryRefinedFoods());
}

/**
 * Get all unique countries from the foods database (with caching)
 */
export async function getAllCountries(): Promise<string[]> {
  // Check cache first
  if (countriesCache && countriesCache.expiresAt > Date.now()) {
    return countriesCache.data;
  }

  try {
    // Fetch all foods (already cached) and extract unique countries
    const foods = await getAllFoodsForRecommendations();
    const countries = [...new Set(foods.map((f) => f.country).filter((c): c is string => c !== null))];
    const sorted = countries.sort();

    // Cache the result
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
  // Check cache first
  const cached = regionsCache.get(country);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    // Fetch all foods (already cached) and filter by country
    const foods = await getAllFoodsForRecommendations();
    const regions = [
      ...new Set(
        foods
          .filter((f) => f.country === country)
          .map((f) => f.region)
          .filter((r): r is string => r !== null)
      ),
    ];
    const sorted = regions.sort();

    // Cache the result
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
  region?: string
): Promise<FoodRow[]> {
  try {
    // Fetch all foods (already cached) and filter in memory
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
