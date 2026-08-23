import { db, foodsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

/**
 * Cuisine tag mappings to country and region
 */
const CUISINE_MAPPINGS: Record<string, { country: string; region?: string }> = {
  north_indian: { country: "India", region: "North India" },
  south_indian: { country: "India", region: "South India" },
  east_indian: { country: "India", region: "East India" },
  west_indian: { country: "India", region: "West India" },

  // You can expand this mapping as needed
  general: { country: "International" },
};

/**
 * Populate country and region fields based on cuisineTags
 * This should be run once after the schema migration
 */
export async function populateCountryRegion() {
  try {
    console.log("Starting to populate country/region data...");

    // Get all foods with null country
    const foods = await db
      .select()
      .from(foodsTable)
      .where(sql`${foodsTable.country} IS NULL`);

    console.log(`Found ${foods.length} foods without country/region data`);

    let updated = 0;
    for (const food of foods) {
      if (!food.cuisineTags || food.cuisineTags.length === 0) {
        continue;
      }

      // Find first matching cuisine tag
      let country = "International";
      let region: string | null = null;

      for (const tag of food.cuisineTags) {
        const mapping = CUISINE_MAPPINGS[tag];
        if (mapping) {
          country = mapping.country;
          region = mapping.region || null;
          break;
        }
      }

      // Update the food record
      await db
        .update(foodsTable)
        .set({
          country,
          region,
        })
        .where(eq(foodsTable.id, food.id));

      updated++;

      if (updated % 100 === 0) {
        console.log(`Updated ${updated}/${foods.length} foods`);
      }
    }

    console.log(`✓ Successfully updated ${updated} foods with country/region data`);
    return { success: true, updated };
  } catch (error) {
    console.error("Error populating country/region data:", error);
    throw error;
  }
}

// Run if called directly (can be used for manual migration)
// import { populateCountryRegion } from "./populate-country-region";
// await populateCountryRegion();
