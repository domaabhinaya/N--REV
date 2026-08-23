import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { dirname } from "path";
import { fileURLToPath } from "url";

// Get the absolute path to the project root
const currentFile = fileURLToPath(import.meta.url);
const libDbDir = dirname(currentFile);
const libDir = dirname(libDbDir);
const rootDir = dirname(libDir);

// Load .env from the project root
config({ path: `${rootDir}/.env` });

if (!process.env.DATABASE_URL) {
  throw new Error(
    `DATABASE_URL not found. Looked in: ${rootDir}/.env\n` +
    `Please ensure .env exists with DATABASE_URL set.`
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
