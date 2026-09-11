import "./lib/load-env";
import app from "./app";
import { logger } from "./lib/logger";
import { seedFoodsIfEmpty } from "./lib/seed";
import { getAllFoodsForRecommendations } from "./lib/food-lookup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Seed the dataset, then pre-warm the in-memory food cache BEFORE accepting
// requests. Without this, the first request pays the full cost of loading and
// ranking 82k+ foods on the event loop (blocking all concurrent requests).
seedFoodsIfEmpty()
  .catch((err) => {
    logger.error({ err }, "Failed to seed foods table");
  })
  .then(() => getAllFoodsForRecommendations())
  .then((count) => {
    logger.info({ foodCacheCount: count }, "Food cache pre-warmed");
  })
  .catch((err) => {
    logger.error({ err }, "Failed to pre-warm food cache");
  })
  .finally(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
    });
  });
