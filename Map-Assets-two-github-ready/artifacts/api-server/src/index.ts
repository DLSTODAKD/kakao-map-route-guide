import app from "./app";
import { logger } from "./lib/logger";

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

// Listen on 0.0.0.0 so Replit's reverse proxy can reach the server
app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});
