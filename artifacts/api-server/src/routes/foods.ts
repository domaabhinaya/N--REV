import { Router, type IRouter } from "express";
import { db, foodsTable } from "@workspace/db";
import { ListFoodsQueryParams } from "@workspace/api-zod";
import { eq, and, or, ilike, desc, asc, sql } from "drizzle-orm";
import { getAllCountries, getRegionsByCountry, getFoodsByCountry } from "../lib/food-lookup";

const router: IRouter = Router();

function parsePagination(
  query: Record<string, unknown>,
): { limit: number; offset: number; search: string | null } {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);
  const search = typeof query.search === "string" ? query.search.trim() : null;

  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 50,
    offset:
      Number.isFinite(rawOffset) && rawOffset >= 0
        ? Math.floor(rawOffset)
        : 0,
    search: search && search.length > 0 ? search : null,
  };
}

router.get("/foods", async (req, res): Promise<void> => {
  const query = ListFoodsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { limit, offset, search } = parsePagination(req.query as Record<string, unknown>);

  const conditions: (ReturnType<typeof eq> | ReturnType<typeof ilike>)[] = [];

  if (query.data.tier) {
    conditions.push(eq(foodsTable.tier, query.data.tier));
  }

  if (search) {
    conditions.push(ilike(foodsTable.name, `%${search}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total matching rows
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(foodsTable)
    .where(whereClause);
  const total = Number(countResult[0]?.count ?? 0);

  // Primary-before-Extended ordering: tier ASC NULLS LAST, then name ASC
  const rows = await db
    .select()
    .from(foodsTable)
    .where(whereClause)
    .orderBy(asc(foodsTable.tier), asc(foodsTable.name))
    .limit(limit)
    .offset(offset);

  const filtered = query.data.dietType
    ? rows.filter((f) => f.dietTags.length === 0 || f.dietTags.includes(query.data.dietType as string))
    : rows;

  res.json({
    items: filtered,
    total,
    limit,
    offset,
    hasMore: offset + filtered.length < total,
  });
});

/**
 * GET /foods/countries
 * Get all unique countries available in the food database
 */
router.get("/foods/countries", async (req, res): Promise<void> => {
  try {
    const countries = await getAllCountries();
    res.json({ countries });
  } catch (error) {
    console.error("Error fetching countries:", error);
    res.status(500).json({ error: "Failed to fetch countries" });
  }
});

/**
 * GET /foods/regions/:country
 * Get all regions for a specific country
 */
router.get("/foods/regions/:country", async (req, res): Promise<void> => {
  const { country } = req.params;
  if (!country) {
    res.status(400).json({ error: "Country parameter is required" });
    return;
  }

  try {
    const regions = await getRegionsByCountry(decodeURIComponent(country));
    res.json({ country, regions });
  } catch (error) {
    console.error("Error fetching regions:", error);
    res.status(500).json({ error: "Failed to fetch regions" });
  }
});

/**
 * GET /foods/by-country
 * Get foods filtered by country and optional region
 * Query params: country (required), region (optional), limit, offset
 */
router.get("/foods/by-country", async (req, res): Promise<void> => {
  const { country, region, limit: rawLimit, offset: rawOffset } = req.query;

  if (!country || typeof country !== "string") {
    res.status(400).json({ error: "Country query parameter is required" });
    return;
  }

  const { limit, offset } = parsePagination({
    limit: rawLimit,
    offset: rawOffset,
    search: null,
  } as Record<string, unknown>);

  try {
    const foods = await getFoodsByCountry(
      decodeURIComponent(country),
      region ? decodeURIComponent(region as string) : undefined
    );

    // Paginate results
    const total = foods.length;
    const items = foods.slice(offset, offset + limit);

    res.json({
      country,
      region: region || null,
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    });
  } catch (error) {
    console.error("Error fetching foods by country:", error);
    res.status(500).json({ error: "Failed to fetch foods by country" });
  }
});

export default router;
