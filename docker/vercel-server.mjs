import app from "../artifacts/api-server/dist/app.mjs";

const rawPort = process.env.PORT ?? "80";
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, "0.0.0.0", () => {
  console.info(`N-REV container listening on port ${port}`);
});
