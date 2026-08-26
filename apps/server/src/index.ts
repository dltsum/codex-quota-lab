import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
if (
  process.env.NODE_ENV === "production" &&
  !loopbackHosts.has(config.host) &&
  !config.secureCookies
) {
  throw new Error(
    "Production non-loopback deployments require QUOTALAB_SECURE_COOKIES=true behind HTTPS.",
  );
}

const app = await buildApp({ config });

const close = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
