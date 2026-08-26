import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const testDataRoot = resolve(projectRoot, "apps/web/test-results/runtime");

rmSync(testDataRoot, { recursive: true, force: true });
mkdirSync(testDataRoot, { recursive: true });
process.chdir(projectRoot);
process.env.HOST = "127.0.0.1";
process.env.PORT = "4318";
process.env.LOG_LEVEL = "silent";
process.env.QUOTALAB_DB = resolve(testDataRoot, "quotalab-e2e.db");
process.env.QUOTALAB_WEB_DIST = resolve(projectRoot, "apps/web/dist");
process.env.QUOTALAB_SECURE_COOKIES = "false";
process.env.QUOTALAB_SCRYPT_COST = "1024";

await import("../../server/dist/index.js");
