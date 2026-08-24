// Vercel function entrypoint. The Express application intentionally has no
// listener or startup seeding; those remain in artifacts/api-server/src/index.ts
// for local development only.
import app from "../artifacts/api-server/src/app";

export default app;
