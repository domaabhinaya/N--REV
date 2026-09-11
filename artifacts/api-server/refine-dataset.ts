import XLSX from "xlsx";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { refineCuisine, CUISINE_RULE_VERSION } from "./src/lib/cuisine-metadata";
import { normalizeFoodName } from "./src/lib/food-lookup";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "data");
mkdirSync(output, { recursive: true });
const seen = new Map<string, { code: unknown; source: unknown; sourceRow: number; row: Record<string, unknown> }>();
const rows: Record<string, unknown>[] = [];
const duplicates: Record<string, unknown>[] = [];
const reviews: Record<string, unknown>[] = [];
const counts: Record<string, number> = {};
const missing: Record<string, number> = {};
const negative: Record<string, number> = {};
const sources = [];
let sourceRows = 0;
for (const [filename, tier] of [["NREV_Refined_Dataset.xlsx", "primary"], ["NREV_Extended_Dataset.xlsx", "extended"]]) {
  const bytes = readFileSync(resolve(root, filename));
  const workbook = XLSX.read(bytes);
  if (!workbook.Sheets["Final Cleaned"]) throw new Error(`${filename}: Final Cleaned sheet is required`);
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Final Cleaned"], { defval: null });
  sources.push({ filename, sheet: "Final Cleaned", rows: raw.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  for (const [index, row] of raw.entries()) {
    // Spreadsheet empty-string cells represent missing values, not numeric zero.
    for (const key of Object.keys(row)) if (row[key] === "") row[key] = null;
    sourceRows++;
    const name = String(row.food_name ?? "").trim();
    const slug = normalizeFoodName(name);
    if (!name || !slug) throw new Error(`${filename}:${index + 2}: invalid identity`);
    const previous = seen.get(slug);
    if (previous) {
      const differingFields = Object.keys(row).filter(k => k !== "food_code" && k !== "food_name" && row[k] !== previous.row[k]);
      duplicates.push({ slug, retained_code: previous.code, retained_source: previous.source, retained_source_row: previous.sourceRow, duplicate_code: row.food_code, duplicate_source: filename, source_row: index + 2, differing_fields: differingFields });
      continue;
    }
    seen.set(slug, { code: row.food_code, source: filename, sourceRow: index + 2, row });
    const cuisine = refineCuisine(name, row.cuisine_tags);
    counts[cuisine.status] = (counts[cuisine.status] ?? 0) + 1;
    for (const tag of cuisine.tags) counts[tag] = (counts[tag] ?? 0) + 1;
    const flags = [];
    if (cuisine.status !== "classified") flags.push(`cuisine_${cuisine.status}`);
    if (row.serving_grams === null) flags.push("missing_serving_grams");
    else if (typeof row.serving_grams !== "number" || !Number.isFinite(row.serving_grams) || row.serving_grams <= 0) flags.push("invalid_serving_grams");
    // No ingredients or certified dietary/allergen metadata are provided by these sources.
    flags.push("diet_and_allergen_metadata_unverified");
    for (const [key, value] of Object.entries(row)) {
      if (!/_(g|mg|ug|kcal)$/.test(key)) continue;
      if (value === null) {
        missing[key] = (missing[key] ?? 0) + 1;
        flags.push(`missing_${key}`);
      }
      else if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        negative[key] = (negative[key] ?? 0) + 1;
        flags.push(`invalid_${key}`);
      }
    }
    if (typeof row.energy_kcal === "number" && row.serving_grams === 100 && row.energy_kcal > 900) flags.push("energy_basis_or_unit_review");
    const refined = { ...row, cuisine_tags: cuisine.tags, cuisine_evidence: cuisine.evidence, cuisine_status: cuisine.status,
      refinement_tier: tier, refinement_source_file: filename, refinement_source_row: index + 2, refinement_rule_version: CUISINE_RULE_VERSION };
    rows.push(refined);
    reviews.push({ food_code: row.food_code, food_name: name, source: filename, source_row: index + 2, refinement_tier: tier, flags, cuisine_evidence: cuisine.evidence });
  }
}
if (rows.length !== 82073 || sourceRows !== 86928) throw new Error(`Baseline mismatch: ${sourceRows} source rows, ${rows.length} unique foods`);
const jsonl = (values: unknown[]) => values.map(v => JSON.stringify(v)).join("\n") + "\n";
writeFileSync(resolve(output, "foods-refined.jsonl"), jsonl(rows));
writeFileSync(resolve(output, "duplicate-review.jsonl"), jsonl(duplicates));
writeFileSync(resolve(output, "metadata-review.jsonl"), jsonl(reviews));
const qualityFlagCounts: Record<string, number> = {};
for (const review of reviews) for (const flag of review.flags as string[]) qualityFlagCounts[flag] = (qualityFlagCounts[flag] ?? 0) + 1;
const report = { qualityFlagCounts, ruleVersion: CUISINE_RULE_VERSION, sources, sourceRows, uniqueFoods: rows.length, duplicatesCollapsed: duplicates.length,
  conflictingDuplicates: duplicates.filter(d => (d.differing_fields as string[]).length > 0).length,
  cuisineCoverage: counts, missingNutrients: missing, invalidNutrients: negative,
  primary: rows.filter(r => r.refinement_tier === "primary").length,
  extended: rows.filter(r => r.refinement_tier === "extended").length,
  notes: ["All 49 original source columns retained; empty strings normalized to null. Numeric values are unchanged.", "Existing normalized-name deduplication and primary-first precedence preserved; conflicting duplicates retained in review output.", "Cuisine source-database guesses and partial-word matches removed. Unknown foods retained.", "Dataset membership is not proof of cuisine. Missing user preference defaults to Indian; missing food cuisine remains unknown.", "Diet and allergen certification cannot be inferred from food names; source metadata requires review."] };
writeFileSync(resolve(output, "refinement-audit.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
