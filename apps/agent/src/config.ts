import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

import type { AgentIngestRequest } from "@quotalab/contracts";
import type { ScannerState } from "./scanner.js";

const AgentConfigSchema = z
  .object({
    version: z.literal(1),
    serverUrl: z.url(),
    groupSlug: z.string().min(5).max(80),
    deviceToken: z.string().min(32),
    devicePublicId: z.uuid(),
    deviceId: z.string().regex(/^[a-f0-9]{32}$/),
    deviceName: z.string().min(1).max(80).nullable(),
    codexHome: z.string().min(1),
    pollIntervalSeconds: z.number().int().min(30).max(3_600),
    lookbackDays: z.number().int().min(1).max(40),
    maxBytesPerScan: z
      .number()
      .int()
      .min(256 * 1024)
      .max(256 * 1024 * 1024),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export interface PendingOutbox {
  version: 1;
  payload: AgentIngestRequest;
  nextScannerState: ScannerState;
}

export interface AgentPaths {
  root: string;
  config: string;
  scannerState: string;
  outbox: string;
}

export const defaultAgentRoot = (env: NodeJS.ProcessEnv = process.env): string => {
  if (env.QUOTALAB_HOME) return resolve(env.QUOTALAB_HOME);
  if (platform() === "win32")
    return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "QuotaLab");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "QuotaLab");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "quotalab");
};

export const agentPaths = (root: string = defaultAgentRoot()): AgentPaths => ({
  root,
  config: join(root, "config.json"),
  scannerState: join(root, "scanner-state.json"),
  outbox: join(root, "outbox.json"),
});

const atomicJsonWrite = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
};

const readJsonIfPresent = async (path: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

export const loadAgentConfig = async (paths: AgentPaths = agentPaths()): Promise<AgentConfig> => {
  const value = await readJsonIfPresent(paths.config);
  if (value === null) throw new Error("AGENT_NOT_CONFIGURED");
  return AgentConfigSchema.parse(value);
};

export const saveAgentConfig = async (
  config: AgentConfig,
  paths: AgentPaths = agentPaths(),
): Promise<void> => atomicJsonWrite(paths.config, AgentConfigSchema.parse(config));

export const loadScannerState = async (paths: AgentPaths = agentPaths()): Promise<ScannerState> => {
  const value = await readJsonIfPresent(paths.scannerState);
  if (value === null) return { version: 1, files: {} };
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { version?: unknown }).version !== 1 ||
    typeof (value as { files?: unknown }).files !== "object"
  ) {
    throw new Error("SCANNER_STATE_INVALID");
  }
  return value as ScannerState;
};

export const saveScannerState = async (
  state: ScannerState,
  paths: AgentPaths = agentPaths(),
): Promise<void> => atomicJsonWrite(paths.scannerState, state);

export const loadOutbox = async (
  paths: AgentPaths = agentPaths(),
): Promise<PendingOutbox | null> => {
  const value = await readJsonIfPresent(paths.outbox);
  if (value === null) return null;
  const candidate = value as Partial<PendingOutbox>;
  if (candidate.version !== 1 || !candidate.payload || !candidate.nextScannerState) {
    throw new Error("OUTBOX_INVALID");
  }
  return candidate as PendingOutbox;
};

export const saveOutbox = async (
  outbox: PendingOutbox,
  paths: AgentPaths = agentPaths(),
): Promise<void> => atomicJsonWrite(paths.outbox, outbox);

export const clearOutbox = async (paths: AgentPaths = agentPaths()): Promise<void> => {
  await rm(paths.outbox, { force: true });
};

export const defaultCodexHome = (env: NodeJS.ProcessEnv = process.env): string =>
  resolve(env.CODEX_HOME ?? join(homedir(), ".codex"));
