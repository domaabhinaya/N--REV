/**
 * cuisine.ts
 *
 * AUTHORITATIVE, permanent cuisine-resolution rule for N-REV.
 *
 * - `Indian` is the permanent default cuisine. Whenever the user has not chosen
 *   a cuisine, or the value is null / undefined / empty string / whitespace /
 *   otherwise invalid, it permanently resolves to `Indian`.
 * - A VALID user-selected cuisine (e.g. `Asian`, `North Indian`, ...) is never
 *   silently replaced with `Indian`.
 *
 * This is backend-enforced: every recovery-plan and food-recommendation path
 * must resolve the cuisine through `resolveCuisine()` (directly, or indirectly
 * via the plan generators in `meal-planner.ts`). That way even an older frontend
 * that sends no cuisine still yields an Indian-cuisine plan.
 */

/** The permanent default cuisine. */
export const DEFAULT_CUISINE = "Indian" as const;

/**
 * Canonical supported cuisines. This is the application's supported set:
 * the documented cuisines (Indian, South Indian, North Indian, Asian, Western,
 * Global) plus the legacy values the planner already recognises
 * (Mediterranean, Mexican), so a previously-valid selection is never dropped.
 */
export const SUPPORTED_CUISINES = [
  "Indian",
  "North Indian",
  "South Indian",
  "Asian",
  "Western",
  "Global",
  "Mediterranean",
  "Mexican",
] as const;

export type SupportedCuisine = (typeof SUPPORTED_CUISINES)[number];

/**
 * Normalise any cuisine value to a lowercase, separator-normalised key so that
 * "IndiaN", "asian", "North_Indian", "  ASIAN  " all compare cleanly.
 */
export function normalizeCuisine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CANONICAL_BY_NORMALIZED: Record<string, SupportedCuisine> = Object.fromEntries(
  SUPPORTED_CUISINES.map((cuisine) => [normalizeCuisine(cuisine), cuisine]),
);

/**
 * The single authoritative resolver: returns the validated selected cuisine, or
 * DEFAULT_CUISINE ("Indian") when no valid cuisine is supplied.
 */
export function resolveCuisine(value: unknown): SupportedCuisine {
  if (typeof value !== "string") return DEFAULT_CUISINE;
  const canonical = CANONICAL_BY_NORMALIZED[normalizeCuisine(value)];
  return canonical ?? DEFAULT_CUISINE;
}

/** True when the value is a recognised supported cuisine (validation helper). */
export function isSupportedCuisine(value: unknown): boolean {
  return (
    typeof value === "string" && CANONICAL_BY_NORMALIZED[normalizeCuisine(value)] !== undefined
  );
}

/**
 * Canonical, persistable cuisine value used by the profile store.
 *
 * Returns the resolved supported cuisine when the user EXPLICITLY selected a
 * valid cuisine, otherwise `null` to represent "no cuisine selected".
 *
 * This is REQUIRED so the profile row can preserve the distinction the two
 * dataset-selection modes depend on:
 * This keeps the profile row able to distinguish the two recovery modes:
 *   - `null`  → MODE 1: no explicit cuisine → full imported pool, no cuisine filter.
 *   - a value → MODE 2: explicit cuisine   → full imported pool filtered to it.
 *
 * A missing / undefined / null / empty / whitespace / otherwise invalid cuisine
 * always yields `null` (="no cuisine selected"), so the secondary dataset can
 * never enter the recovery path merely because a cuisine was left unset.
 */
export function canonicalCuisine(value: unknown): SupportedCuisine | null {
  return isSupportedCuisine(value) ? resolveCuisine(value) : null;
}

/**
 * True only when the user has EXPLICITLY selected a supported cuisine.
 *
 * Every other value is treated as "no cuisine selected":
 *   - undefined / null
 *   - "" (empty string)
 *   - whitespace-only string ("   ", " \t\n ")
 *   - a missing cuisine field / a cuisine that was never chosen
 *   - an otherwise invalid / unsupported value
 *
 * IMPORTANT: an absent cuisine is NOT "all cuisines" and NOT a free pass to
 * ignore eligibility. The backend keeps the distinction so that recovery can
 * use the full pool without a cuisine filter (MODE 1) vs. filtering the full
 * pool to the selected cuisine (MODE 2).
 */
export function hasExplicitCuisine(value: unknown): boolean {
  return isSupportedCuisine(value);
}

/**
 * The authoritatively chosen food dataset that is eligible for a recovery-plan
 * request.
 *
 * This is the SINGLE decision point for "which dataset feeds this recovery
 * plan?" shared by every recovery-plan code path. It centralises the rule so a
 * frontend check, an API check, and a planner check can never disagree.
 */
/**
 * The authoritatively chosen recovery-plan candidate dataset & filter mode.
 *
 * PERMANENT BUSINESS RULE — two recovery modes:
 *
 * MODE 1 (NO CUISINE):
 *   When the user has NOT explicitly selected a cuisine (undefined / null /
 *   empty string / whitespace / missing / invalid), the recovery pool is the
 *   FULL imported food dataset. No cuisine filter is activated.
 *
 * MODE 2 (EXPLICIT CUISINE):
 *   When the user HAS explicitly selected a valid, supported cuisine, the FULL
 *   imported dataset is first filtered to the resolved cuisine, then the
 *   existing diet / allergy / meal / nutrient filters and ranking run
 *   downstream. A selected cuisine is never silently replaced with the default.
 */
export type RecoveryDatasetSource = "full-pool" | "cuisine-filtered";

/**
 * Whether a recovery request applies an explicit-cuisine filter to the FULL
 * imported food dataset.
 *
 * PERMANENT BUSINESS RULE — two recovery modes:
 *
 * MODE 1 (NO CUISINE):
 *   When the user has NOT explicitly selected a cuisine (undefined / null /
 *   empty string / whitespace / missing / unrecognised), the FULL imported
 *   dataset is eligible and no cuisine filter is applied.
 *
 * MODE 2 (EXPLICIT CUISINE):
 *   When the user HAS explicitly selected a valid supported cuisine, the FULL
 *   imported dataset is filtered to the resolved cuisine before the existing
 *   diet / allergy / meal / nutrient filters and ranking run.
 */
export function selectRecoveryDatasetSource(cuisine: unknown): RecoveryDatasetSource {
  if (!hasExplicitCuisine(cuisine)) {
    // MODE 1 — no cuisine selected => full pool, no cuisine filter.
    return "full-pool";
  }
  // MODE 2 — explicit cuisine => full pool filtered to the selected cuisine.
  return "cuisine-filtered";
}

/**
 * Human/LLM-facing statement embedding the RESOLVED cuisine. Feed this to any AI
 * generator so it clearly follows the resolved cuisine and never picks unrelated
 * foods for that cuisine.
 */
export function cuisineStatement(cuisine: SupportedCuisine): string {
  return `Resolved cuisine: ${cuisine}. All food recommendations must follow this cuisine.`;
}