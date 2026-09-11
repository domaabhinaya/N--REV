import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { importFoodDatasets, buildFoodDatasets } from "./src/lib/seed";
import { pool } from "@workspace/db";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

// Run explicitly after reviewing data/refinement-audit.json and configuring DATABASE_URL.
const preview = buildFoodDatasets();
if (preview.foods.length !== 82073) throw new Error("Expected 82,073 unique foods before import");
if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL in the local environment before importing");
try {
  await pool.query("ALTER TABLE foods ALTER COLUMN protein DROP NOT NULL, ALTER COLUMN iron DROP NOT NULL, ALTER COLUMN calcium DROP NOT NULL, ALTER COLUMN vitamin_d DROP NOT NULL");
  const report = await importFoodDatasets();
  const { rows } = await pool.query("SELECT count(*)::int AS total, count(DISTINCT slug)::int AS unique_slugs FROM foods");
  console.log(JSON.stringify({ report, database: rows[0] }, null, 2));
  if (rows[0].total !== 82073 || rows[0].unique_slugs !== 82073) throw new Error("Post-import food count differs from the baseline; no rows were deleted");
} finally {
  await pool.end();
}
