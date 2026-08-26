import { resolve } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  webDistPath: string;
  secureCookies: boolean;
  trustProxy: boolean;
  logLevel: string;
  sessionTtlMs: number;
  scryptCost: number;
}

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected true or false, received ${value}`);
};

const parseInteger = (value: string | undefined, fallback: number, label: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
};

export const loadConfig = (
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ServerConfig => {
  const port = parseInteger(env.PORT, 4317, "PORT");
  if (port < 1 || port > 65_535) throw new Error("PORT must be between 1 and 65535");

  const scryptCost = parseInteger(env.QUOTALAB_SCRYPT_COST, 32_768, "QUOTALAB_SCRYPT_COST");
  if (scryptCost < 1_024 || (scryptCost & (scryptCost - 1)) !== 0) {
    throw new Error("QUOTALAB_SCRYPT_COST must be a power of two >= 1024");
  }

  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    databasePath: resolve(cwd, env.QUOTALAB_DB ?? "./data/quotalab.db"),
    webDistPath: resolve(cwd, env.QUOTALAB_WEB_DIST ?? "./apps/web/dist"),
    secureCookies: parseBoolean(env.QUOTALAB_SECURE_COOKIES, env.NODE_ENV === "production"),
    trustProxy: parseBoolean(env.QUOTALAB_TRUST_PROXY, false),
    logLevel: env.LOG_LEVEL ?? "info",
    sessionTtlMs: 7 * 24 * 60 * 60 * 1_000,
    scryptCost,
  };
};
