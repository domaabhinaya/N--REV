import express, { type Express } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Dockerfile.vercel sets this to the built Vite output so the container can
// serve the SPA and its same-origin /api routes from one HTTP server. It is
// intentionally unset for the local API process and Vercel's function runtime.
const staticDir = process.env.NREV_STATIC_DIR;
if (staticDir) {
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" ||
      req.path === "/api" ||
      req.path.startsWith("/api/")
    ) {
      next();
      return;
    }
    res.sendFile("index.html", { root: staticDir });
  });
}

// Global error handler: never drop the connection. Any rejected route handler
// (e.g. a DB/connection error on Vercel) becomes a structured JSON 500 so the
// frontend shows an actionable error + retry instead of a hung/broken request.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ): void => {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[api] unhandled error:", message);
    res.status(500).json({ error: "Internal server error", detail: message });
  },
);

export default app;
