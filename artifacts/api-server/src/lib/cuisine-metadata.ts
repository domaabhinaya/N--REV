/** Dataset classifications are evidence, never the user's default preference. */
export const CUISINE_RULE_VERSION = 1;
const RULES: Array<[string, string[]]> = [
  ["south_indian", ["south indian", "sambar", "rasam", "dosa", "idli", "pongal", "avial"]],
  ["north_indian", ["north indian", "tandoori", "naan", "paratha", "butter chicken", "paneer", "rajma", "chole", "dal makhani", "roti", "chapati"]],
  ["indian", ["indian", "moong dal", "masoor dal", "toor dal", "biryani", "khichdi", "garam chai", "garam masala", "amchur", "besan", "ladoo", "burfi", "jalebi", "poha", "upma", "pulao", "chutney"]],
  ["asian", ["asian", "thai", "chinese", "japanese", "korean", "vietnamese", "ramen", "sushi", "stir fry", "teriyaki", "miso", "hoisin", "char siu", "kimchi", "bibimbap", "pad thai"]],
  ["western", ["american", "italian", "mexican", "french", "greek", "mediterranean", "burger", "pizza", "pasta", "taco", "burrito", "quesadilla", "enchilada", "bagel", "pancake", "waffle"]],
];
export function normalizeCuisineTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;|]/) : [];
  const allowed = new Set(["indian", "north_indian", "south_indian", "asian", "western", "global"]);
  return [...new Set(values.filter((v): v is string => typeof v === "string").map(v => {
    const key = v.toLowerCase().trim().replace(/[\s-]+/g, "_").replace(/_(food|cuisine)$/, "");
    return key === "india" ? "indian" : key;
  }).filter(v => allowed.has(v)))].sort();
}
export function refineCuisine(name: string, explicit?: unknown) {
  const tags = normalizeCuisineTags(explicit);
  if (tags.length) return { tags, evidence: "explicit cuisine metadata", status: "classified" };
  const normalized = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const hits = RULES.flatMap(([tag, words]) => words.filter(w => normalized.includes(` ${w} `)).map(word => ({ tag, word })));
  const families = new Set(hits.map(h => h.tag.includes("indian") ? "indian" : h.tag));
  if (families.size > 1) return { tags: [] as string[], evidence: hits.map(h => h.word).join("; "), status: "ambiguous" };
  if (!hits.length) return { tags: [] as string[], evidence: "no cuisine-specific evidence", status: "needs_review" };
  return { tags: [...new Set(hits.map(h => h.tag))].sort(), evidence: hits.map(h => h.word).join("; "), status: "classified" };
}
export function belongsToCuisine(food: { name: string; cuisineTags?: string[] }, cuisine: string): boolean {
  // Persisted classifications are authoritative; never override them with names.
  const tags = food.cuisineTags?.length ? normalizeCuisineTags(food.cuisineTags) : refineCuisine(food.name).tags;
  const key = cuisine.toLowerCase().replace(/ /g, "_");
  return key === "indian" ? tags.some(t => t === "indian" || t === "north_indian" || t === "south_indian") : tags.includes(key);
}
