import { db, foodsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import XLSX from "xlsx";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { normalizeFoodName } from "./food-lookup";
import { populateCountryRegion } from "./populate-country-region";
import { classifyCuisine } from "./food-classifier";
import type { PlannerFood } from "./meal-planner";
import type { InsertFood } from "@workspace/db";

function findProjectRoot(): string {
  // Walk upward from this module until a directory containing the source
  // datasets is found. This works identically under tsx (src/lib), tests, and
  // bundled output (dist), with no machine-specific hardcoded paths.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "NREV_Refined_Dataset.xlsx"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: repository root relative to src/lib layout.
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

const projectRoot = findProjectRoot();

const PRIMARY_XLSX = join(projectRoot, "NREV_Refined_Dataset.xlsx");
const EXTENDED_XLSX = join(projectRoot, "NREV_Extended_Dataset.xlsx");
const BATCH_SIZE = 1000;

export interface ImportReport {
  sourceFiles: string[];
  sourceRows: number;
  primarySourceRows: number;
  secondarySourceRows: number;
  imported: number;
  primary: number;
  secondary: number;
  duplicates: number;
  invalid: number;
  unique: number;
  completeNutrients: number;
  missingOptional: number;
  rejectedRequired: number;
}

export interface SourceFoodRow {
  name: string;
  slug: string;
  servingSize: string;
  protein: number;
  iron: number;
  calcium: number;
  vitaminD: number;
  magnesium: number | null;
  vitaminA: number | null;
  vitaminC: number | null;
  vitaminB7: number | null;
  vitaminE: number | null;
  vitaminK: number | null;
  vitaminB12: number | null;
  vitaminB1: number | null;
  vitaminB2: number | null;
  vitaminB3: number | null;
  vitaminB6: number | null;
  cuisineTags: string[];
  tier: "primary" | "extended";
  source: string | null;
  sourceId: string | null;
  foodCategory: string | null;
  valid: boolean;
  missingRequired: string[];
  hasAllOptional: boolean;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstPresent(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const v = row[key];
    if (v !== null && v !== undefined && v !== "") return v;
  }
  return undefined;
}

/** Deterministic, source-stable identity key for a food row. */
export function foodSlug(name: string): string {
  return normalizeFoodName(name);
}

const OPTIONAL_FIELDS = [
  "magnesium", "vitaminA", "vitaminC", "vitaminB7", "vitaminE", "vitaminK",
  "vitaminB12", "vitaminB1", "vitaminB2", "vitaminB3", "vitaminB6",
] as const;

function mapRowToFood(row: Record<string, unknown>, tier: "primary" | "extended"): SourceFoodRow {
  const name = String(firstPresent(row, ["food_name", "Food Name", "name", "Food"]) ?? "").trim();
  const servingSize = String(firstPresent(row, ["serving_size", "Serving Size", "serving_description"]) ?? "1 serving").trim() || "1 serving";
  const source = (firstPresent(row, ["source", "Source"]) as string | null) ?? null;
  const sourceId = (firstPresent(row, ["food_code", "Food Code", "id", "ID"]) as string | null) ?? null;
  const foodCategory = (firstPresent(row, ["category", "Category"]) as string | null) ?? null;

  const missingRequired: string[] = [];
  const read = (keys: string[]): number => {
    const n = toNumber(firstPresent(row, keys));
    if (n === null) {
      missingRequired.push(keys[0]);
      return 0;
    }
    return n;
  };

  const food: SourceFoodRow = {
    name,
    slug: foodSlug(name),
    servingSize,
    protein: read(["protein_g", "Protein_g", "protein"]),
    iron: read(["iron_mg", "Iron_mg", "iron"]),
    calcium: read(["calcium_mg", "Calcium_mg", "calcium"]),
    vitaminD: read(["vitamin_d_ug", "VitaminD_IU", "vitamin_d"]),
    magnesium: opt(row, ["magnesium_mg", "magnesium"]),
    vitaminA: opt(row, ["vitamin_a_ug", "vitaminA"]),
    vitaminC: opt(row, ["vitamin_c_mg", "vitaminC"]),
    vitaminB7: opt(row, ["vitamin_b7_ug", "vitaminB7"]),
    vitaminE: opt(row, ["vitamin_e_mg", "vitaminE"]),
    vitaminK: opt(row, ["vitamin_k_ug", "vitaminK"]),
    vitaminB12: opt(row, ["vitamin_b12_ug", "vitaminB12"]),
    vitaminB1: opt(row, ["vitamin_b1_mg", "vitaminB1"]),
    vitaminB2: opt(row, ["vitamin_b2_mg", "vitaminB2"]),
    vitaminB3: opt(row, ["vitamin_b3_mg", "vitaminB3"]),
    vitaminB6: opt(row, ["vitamin_b6_mg", "vitaminB6"]),
    cuisineTags: inferCuisineTags({ name, source } as PlannerFood),
    tier,
    source,
    sourceId,
    foodCategory,
    valid: Boolean(name && servingSize),
    missingRequired,
    hasAllOptional: true,
  };

  food.hasAllOptional = OPTIONAL_FIELDS.every((k) => food[k] !== null);
  return food;
}

function opt(row: Record<string, unknown>, keys: string[]): number | null {
  const n = toNumber(firstPresent(row, keys));
  return n === null ? null : n;
}

function cuisineTagForLabel(label: string): string | null {
  switch (label) {
    case "Indian": return "indian";
    case "North Indian": return "north_indian";
    case "South Indian": return "south_indian";
    case "Asian": return "asian";
    case "Western": return "western";
    case "Global": return "global";
    default: return null;
  }
}

/** Precompute cuisine tags at import time using the existing keyword classifier. */
export function inferCuisineTags(food: Pick<PlannerFood, "name" | "source">): string[] {
  const label = classifyCuisine({
    ...food,
    cuisineTags: [],
    servingSize: "",
    tier: "primary",
  } as unknown as PlannerFood);
  const tag = cuisineTagForLabel(label);
  return tag ? [tag] : [];
}

function loadDatasetFromExcel(path: string): Record<string, unknown>[] {
  const workbook = XLSX.readFile(path);
  const sheetName =
    workbook.SheetNames.find((name) =>
      name.toLowerCase().includes("cleaned") || name.toLowerCase().includes("final"),
    ) || workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName]);
}

export function buildFoodDatasets(): { foods: SourceFoodRow[]; report: ImportReport } {
  return buildFoodsFromRows(
    loadDatasetFromExcel(PRIMARY_XLSX),
    loadDatasetFromExcel(EXTENDED_XLSX),
  );
}

export function buildFoodsFromRows(
  primaryRaw: Record<string, unknown>[],
  extendedRaw: Record<string, unknown>[],
): { foods: SourceFoodRow[]; report: ImportReport } {
  const foods: SourceFoodRow[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;
  let completeNutrients = 0;
  let missingOptional = 0;
  let rejectedRequired = 0;

  const ingest = (rows: Record<string, unknown>[], tier: "primary" | "extended") => {
    for (const row of rows) {
      const f = mapRowToFood(row, tier);
      if (!f.valid) {
        invalidCount++;
        rejectedRequired++;
        continue;
      }
      if (seen.has(f.slug)) {
        duplicateCount++;
        continue;
      }
      seen.add(f.slug);
      if (f.missingRequired.length > 0) rejectedRequired++;
      if (f.hasAllOptional) completeNutrients++;
      else missingOptional++;
      foods.push(f);
    }
  };

  ingest(primaryRaw, "primary");
  ingest(extendedRaw, "extended");

  const primaryCount = foods.filter((f) => f.tier === "primary").length;
  const report: ImportReport = {
    sourceFiles: [PRIMARY_XLSX, EXTENDED_XLSX],
    sourceRows: primaryRaw.length + extendedRaw.length,
    primarySourceRows: primaryRaw.length,
    secondarySourceRows: extendedRaw.length,
    imported: foods.length,
    primary: primaryCount,
    secondary: foods.length - primaryCount,
    duplicates: duplicateCount,
    invalid: invalidCount,
    unique: foods.length,
    completeNutrients,
    missingOptional,
    rejectedRequired,
  };
  return { foods, report };
}

function toInsert(food: SourceFoodRow): InsertFood {
  return {
    name: food.name,
    servingSize: food.servingSize,
    protein: food.protein,
    iron: food.iron,
    calcium: food.calcium,
    vitaminD: food.vitaminD,
    magnesium: food.magnesium,
    vitaminA: food.vitaminA,
    vitaminC: food.vitaminC,
    vitaminB7: food.vitaminB7,
    vitaminE: food.vitaminE,
    vitaminK: food.vitaminK,
    vitaminB12: food.vitaminB12,
    vitaminB1: food.vitaminB1,
    vitaminB2: food.vitaminB2,
    vitaminB3: food.vitaminB3,
    vitaminB6: food.vitaminB6,
    dietTags: [],
    mealTags: [],
    cuisineTags: food.cuisineTags,
    tier: food.tier,
    source: food.source,
    slug: food.slug,
    sourceId: food.sourceId,
    foodCategory: food.foodCategory,
  };
}

function logProgress(report: ImportReport): void {
  logger.info(
    {
      sourceRows: report.sourceRows,
      primarySourceRows: report.primarySourceRows,
      secondarySourceRows: report.secondarySourceRows,
      imported: report.imported,
      primary: report.primary,
      secondary: report.secondary,
      duplicates: report.duplicates,
      invalid: report.invalid,
      unique: report.unique,
      completeNutrients: report.completeNutrients,
      missingOptional: report.missingOptional,
      rejectedRequired: report.rejectedRequired,
    },
    "Food dataset import report",
  );
}

/**
 * Idempotent full-dataset import: new foods are inserted in batches, existing
 * foods (matched by normalized name) are reconciled IN PLACE — and only when
 * their derived metadata actually differs — so re-running is both duplicate-free
 * and fast. Valid existing foods are never deleted.
 */
export async function importFoodDatasets(): Promise<ImportReport> {
  const { foods, report } = buildFoodDatasets();
  logProgress(report);

  const existingRows = await db
    .select({
      id: foodsTable.id,
      name: foodsTable.name,
      slug: foodsTable.slug,
      source: foodsTable.source,
      sourceId: foodsTable.sourceId,
      foodCategory: foodsTable.foodCategory,
      cuisineTags: foodsTable.cuisineTags,
    })
    .from(foodsTable);
  const existingByName = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    const key = normalizeFoodName(row.name);
    if (key && !existingByName.has(key)) existingByName.set(key, row);
  }

  const toInsertList: SourceFoodRow[] = [];
  const toReconcile: { food: SourceFoodRow; id: number }[] = [];
  for (const f of foods) {
    const existing = existingByName.get(f.slug);
    if (!existing) toInsertList.push(f);
    else if (reconcileNeeded(existing, f)) toReconcile.push({ food: f, id: existing.id });
  }

  let inserted = 0;
  for (let i = 0; i < toInsertList.length; i += BATCH_SIZE) {
    const batch = toInsertList.slice(i, i + BATCH_SIZE).map(toInsert);
    await db.insert(foodsTable).values(batch);
    inserted += batch.length;
    logger.info({ progress: `${inserted}/${toInsertList.length}` }, "Inserted batch");
  }

  // Reconcile stale metadata concurrently in bounded chunks (never inserts).
  let reconciled = 0;
  const RECONCILE_CONCURRENCY = 100;
  for (let i = 0; i < toReconcile.length; i += RECONCILE_CONCURRENCY) {
    await Promise.all(
      toReconcile.slice(i, i + RECONCILE_CONCURRENCY).map(({ food, id }) =>
        db
          .update(foodsTable)
          .set({
            cuisineTags: food.cuisineTags,
            sourceId: food.sourceId,
            foodCategory: food.foodCategory,
            source: food.source ?? null,
            slug: food.slug,
          })
          .where(eq(foodsTable.id, id)),
      ),
    );
    reconciled += Math.min(RECONCILE_CONCURRENCY, toReconcile.length - i);
    if (reconciled % 10000 === 0 || reconciled === toReconcile.length) {
      logger.info({ progress: `${reconciled}/${toReconcile.length}` }, "Reconciled rows");
    }
  }
  logger.info(
    { inserted, reconciled, unchanged: existingRows.length - reconciled },
    "Food dataset import complete",
  );

  await populateCountryRegion();
  return report;
}

/** True only when derived metadata genuinely differs from the stored row. */
function reconcileNeeded(
  existing: { slug: string | null; source: string | null; sourceId: string | null; foodCategory: string | null; cuisineTags: string[] },
  f: SourceFoodRow,
): boolean {
  return (
    existing.slug !== f.slug ||
    existing.source !== (f.source ?? null) ||
    existing.sourceId !== f.sourceId ||
    existing.foodCategory !== f.foodCategory ||
    JSON.stringify(existing.cuisineTags ?? []) !== JSON.stringify(f.cuisineTags)
  );
}

/**
 * Startup seeding guard. Fresh/empty databases are imported in full.
 * Existing databases are never wiped or duplicated; metadata-only
 * reconciliation is available via `importFoodDatasets`.
 */
export async function seedFoodsIfEmpty(): Promise<void> {
  const existing = await db.select({ id: foodsTable.id }).from(foodsTable).limit(1);
  if (existing.length > 0) {
    logger.info("foods table already populated; skipping full re-seed (idempotent import available)");
    return;
  }
  try {
    await importFoodDatasets();
  } catch (error) {
    logger.error({ err: error }, "Failed to seed from datasets, using fallback");
    const { SEED_FOODS } = await import("./food-data");
    const entries: InsertFood[] = SEED_FOODS.map((food) => ({
      name: food.name,
      servingSize: food.servingSize,
      protein: food.protein,
      iron: food.iron,
      calcium: food.calcium,
      vitaminD: food.vitaminD,
      magnesium: food.magnesium ?? null,
      vitaminA: food.vitaminA ?? null,
      vitaminC: food.vitaminC ?? null,
      vitaminB7: food.vitaminB7 ?? null,
      vitaminE: food.vitaminE ?? null,
      vitaminK: food.vitaminK ?? null,
      vitaminB12: food.vitaminB12 ?? null,
      vitaminB1: food.vitaminB1 ?? null,
      vitaminB2: food.vitaminB2 ?? null,
      vitaminB3: food.vitaminB3 ?? null,
      vitaminB6: food.vitaminB6 ?? null,
      dietTags: food.dietTags,
      mealTags: food.mealTags,
      cuisineTags: food.cuisineTags,
      tier: "primary",
      source: null,
      slug: null,
      sourceId: null,
      foodCategory: null,
    }));
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      await db.insert(foodsTable).values(entries.slice(i, i + BATCH_SIZE));
    }
    logger.info({ count: SEED_FOODS.length }, "Seeded foods table from fallback data");
    await populateCountryRegion();
  }
}