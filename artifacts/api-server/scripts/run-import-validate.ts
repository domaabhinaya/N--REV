import { importFoodDatasets } from "../src/lib/seed";
import { db } from "@workspace/db";
import { foodsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  const before = await db.select({ n: sql<number>`count(*)::int` }).from(foodsTable);
  console.log("rows_before_import:", before[0]?.n ?? 0);

  const report = await importFoodDatasets();
  console.log("IMPORT_REPORT:", JSON.stringify(report, null, 2));

  const after = await db.select({ n: sql<number>`count(*)::int` }).from(foodsTable);
  const byTier = await db
    .select({ tier: foodsTable.tier, n: sql<number>`count(*)::int` })
    .from(foodsTable)
    .groupBy(foodsTable.tier);
  const tagged = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(foodsTable)
    .where(sql`jsonb_array_length(${foodsTable.cuisineTags}) > 0`);
  const complete = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(foodsTable)
    .where(sql`${foodsTable.magnesium} is not null and ${foodsTable.vitaminA} is not null and ${foodsTable.vitaminC} is not null and ${foodsTable.vitaminB7} is not null and ${foodsTable.vitaminE} is not null and ${foodsTable.vitaminK} is not null`);

  console.log("rows_after_import:", after[0]?.n ?? 0);
  console.log("by_tier:", JSON.stringify(byTier));
  console.log("cuisine_tagged:", tagged[0]?.n ?? 0);
  console.log("complete_optional_nutrients:", complete[0]?.n ?? 0);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
