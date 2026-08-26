import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

import type {
  AccountUsageObservation,
  CollectorHealth,
  QuotaBucketObservation,
} from "@quotalab/contracts";

const execFile = promisify(execFileCallback);

export interface CodexAccountCollection {
  quotaBuckets: QuotaBucketObservation[];
  accountUsage: AccountUsageObservation | null;
  collector: CollectorHealth;
}

interface JsonRpcMessage {
  id?: number;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const nonNegativeIntegerOrNull = (value: unknown): number | null => {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? Math.floor(number) : null;
};

const normalizeWindow = (
  kind: "primary" | "secondary",
  value: unknown,
): QuotaBucketObservation["windows"][number] | null => {
  const object = asObject(value);
  const usedPercent = finiteNumber(object?.usedPercent);
  if (!object || usedPercent === null || usedPercent < 0 || usedPercent > 100) return null;
  return {
    kind,
    usedPercent,
    windowDurationMins: nonNegativeIntegerOrNull(object.windowDurationMins),
    resetsAt: nonNegativeIntegerOrNull(object.resetsAt),
  };
};

export const normalizeRateLimits = (
  value: unknown,
  fallbackPlanType: string | null,
): QuotaBucketObservation[] => {
  const result = asObject(value);
  if (!result) return [];
  const multi = asObject(result.rateLimitsByLimitId);
  const entries: Array<[string, unknown]> = multi
    ? Object.entries(multi)
    : result.rateLimits
      ? [[String(asObject(result.rateLimits)?.limitId ?? "codex"), result.rateLimits]]
      : [];

  const buckets: QuotaBucketObservation[] = [];
  for (const [mapKey, rawBucket] of entries) {
    const bucket = asObject(rawBucket);
    if (!bucket) continue;
    const windows = [
      normalizeWindow("primary", bucket.primary),
      normalizeWindow("secondary", bucket.secondary),
    ].filter((window): window is NonNullable<typeof window> => window !== null);
    if (windows.length === 0) continue;
    buckets.push({
      limitId: String(bucket.limitId ?? mapKey).slice(0, 128),
      limitName:
        typeof bucket.limitName === "string" && bucket.limitName.trim()
          ? bucket.limitName.trim().slice(0, 160)
          : null,
      planType:
        typeof bucket.planType === "string" && bucket.planType.trim()
          ? bucket.planType.trim().slice(0, 64)
          : fallbackPlanType,
      windows,
    });
  }
  return buckets;
};

export const normalizeAccountUsage = (value: unknown): AccountUsageObservation | null => {
  const result = asObject(value);
  const summary = asObject(result?.summary);
  if (!result || !summary) return null;
  const buckets = Array.isArray(result.dailyUsageBuckets)
    ? result.dailyUsageBuckets.flatMap((entry) => {
        const object = asObject(entry);
        const startDate = typeof object?.startDate === "string" ? object.startDate : null;
        const tokens = nonNegativeIntegerOrNull(object?.tokens);
        return startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && tokens !== null
          ? [{ startDate, tokens }]
          : [];
      })
    : null;
  return {
    lifetimeTokens: nonNegativeIntegerOrNull(summary.lifetimeTokens),
    peakDailyTokens: nonNegativeIntegerOrNull(summary.peakDailyTokens),
    longestRunningTurnSec: nonNegativeIntegerOrNull(summary.longestRunningTurnSec),
    currentStreakDays: nonNegativeIntegerOrNull(summary.currentStreakDays),
    longestStreakDays: nonNegativeIntegerOrNull(summary.longestStreakDays),
    dailyUsageBuckets: buckets,
  };
};

const commandExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const resolveCodexCommand = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> => {
  if (env.CODEX_BINARY && (await commandExists(env.CODEX_BINARY))) return env.CODEX_BINARY;
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFile("where.exe", ["codex"], { windowsHide: true });
      const candidates = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      return (
        candidates.find((candidate) => candidate.toLowerCase().endsWith(".exe")) ??
        candidates.find((candidate) => candidate.toLowerCase().endsWith(".cmd")) ??
        candidates[0] ??
        null
      );
    }
    const { stdout } = await execFile("sh", ["-lc", "command -v codex"], { windowsHide: true });
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

export const collectCodexAccount = async (
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs: number = 20_000,
): Promise<CodexAccountCollection> => {
  const command = await resolveCodexCommand(env);
  if (!command) {
    return {
      quotaBuckets: [],
      accountUsage: null,
      collector: { appServer: "unavailable", errorCode: "CODEX_NOT_FOUND" },
    };
  }

  return new Promise((resolve) => {
    const requiresShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const processHandle = spawn(command, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: requiresShell,
      env,
    });
    processHandle.stderr.resume();
    const lines = createInterface({ input: processHandle.stdout });
    let initialized = false;
    let finished = false;
    let accountResult: unknown;
    let rateLimitResult: unknown;
    let usageResult: unknown;
    let protocolError: string | null = null;
    const pending = new Set([1, 2, 3]);

    const finish = (forced?: CollectorHealth): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      processHandle.stdin.end();
      setTimeout(() => {
        if (processHandle.exitCode === null) processHandle.kill();
      }, 250).unref();

      const account = asObject(asObject(accountResult)?.account);
      const planType = typeof account?.planType === "string" ? account.planType.slice(0, 64) : null;
      const authenticated = account !== null;
      const health =
        forced ??
        (protocolError
          ? { appServer: "error" as const, errorCode: protocolError }
          : authenticated
            ? { appServer: "ok" as const, errorCode: null }
            : { appServer: "unauthenticated" as const, errorCode: "CODEX_LOGIN_REQUIRED" });
      resolve({
        quotaBuckets: normalizeRateLimits(rateLimitResult, planType),
        accountUsage: normalizeAccountUsage(usageResult),
        collector: health,
      });
    };

    const timer = setTimeout(
      () =>
        finish({
          appServer: "error",
          errorCode: initialized ? "APP_SERVER_TIMEOUT" : "INIT_TIMEOUT",
        }),
      timeoutMs,
    );

    const send = (message: unknown): void => {
      if (!finished && processHandle.stdin.writable) {
        processHandle.stdin.write(`${JSON.stringify(message)}\n`);
      }
    };

    lines.on("line", (line) => {
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        protocolError = "INVALID_JSON_RPC";
        return;
      }
      if (message.id === 0) {
        if (message.error) {
          finish({ appServer: "error", errorCode: "INITIALIZE_REJECTED" });
          return;
        }
        initialized = true;
        send({ method: "initialized", params: {} });
        send({ method: "account/read", id: 1, params: { refreshToken: false } });
        send({ method: "account/rateLimits/read", id: 2, params: {} });
        send({ method: "account/usage/read", id: 3, params: {} });
        return;
      }
      if (!message.id || !pending.has(message.id)) return;
      pending.delete(message.id);
      if (message.error) {
        protocolError = `RPC_${message.id}_FAILED`;
      } else if (message.id === 1) accountResult = message.result;
      else if (message.id === 2) rateLimitResult = message.result;
      else if (message.id === 3) usageResult = message.result;
      if (pending.size === 0) finish();
    });

    processHandle.once("error", () => {
      finish({ appServer: "unavailable", errorCode: "APP_SERVER_SPAWN_FAILED" });
    });
    processHandle.once("exit", (code) => {
      if (!finished) {
        finish({
          appServer: "error",
          errorCode: code === 0 ? "APP_SERVER_EARLY_EXIT" : "APP_SERVER_EXIT",
        });
      }
    });

    send({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "quotalab_agent",
          title: "QuotaLab Agent",
          version: "0.1.0",
        },
      },
    });
  });
};
