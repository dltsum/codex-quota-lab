import { randomUUID } from "node:crypto";

import { AgentIngestRequestSchema, type AgentIngestRequest } from "@quotalab/contracts";

import { ingestBatch } from "./api-client.js";
import { collectCodexAccount } from "./codex-client.js";
import {
  agentPaths,
  clearOutbox,
  loadOutbox,
  loadScannerState,
  saveOutbox,
  saveScannerState,
  type AgentConfig,
  type AgentPaths,
} from "./config.js";
import { getNetworkIdentity, platformLabel } from "./network.js";
import { scanCodexSessions } from "./scanner.js";

export interface CollectionReceipt {
  batchId: string;
  duplicate: boolean;
  acceptedSamples: number;
  appServerStatus: string;
  scannedRecords: number;
  backlogBytes: number;
  resumedOutbox: boolean;
}

export const collectAndUploadOnce = async (
  config: AgentConfig,
  paths: AgentPaths = agentPaths(),
): Promise<CollectionReceipt> => {
  const pending = await loadOutbox(paths);
  if (pending) {
    const response = await ingestBatch(config.serverUrl, config.deviceToken, pending.payload);
    await saveScannerState(pending.nextScannerState, paths);
    await clearOutbox(paths);
    return {
      batchId: pending.payload.batchId,
      duplicate: response.duplicate,
      acceptedSamples: response.acceptedSamples,
      appServerStatus: pending.payload.collector.appServer,
      scannedRecords: pending.payload.scanner.recordsRead,
      backlogBytes: pending.payload.scanner.backlogBytes,
      resumedOutbox: true,
    };
  }

  const previousState = await loadScannerState(paths);
  const now = new Date();
  const [account, scan] = await Promise.all([
    collectCodexAccount(),
    scanCodexSessions({
      codexHome: config.codexHome,
      previousState,
      now,
      lookbackDays: config.lookbackDays,
      maxBytes: config.maxBytesPerScan,
    }),
  ]);
  const network = getNetworkIdentity();
  if (config.deviceName) network.macAddress = null;
  const payload: AgentIngestRequest = AgentIngestRequestSchema.parse({
    batchId: randomUUID(),
    observedAt: now.toISOString(),
    agentVersion: "0.1.0",
    platform: platformLabel(),
    network,
    quotaBuckets: account.quotaBuckets,
    accountUsage: account.accountUsage,
    usageSlices: scan.usageSlices,
    collector: account.collector,
    scanner: scan.health,
  });
  await saveOutbox({ version: 1, payload, nextScannerState: scan.nextState }, paths);
  const response = await ingestBatch(config.serverUrl, config.deviceToken, payload);
  await saveScannerState(scan.nextState, paths);
  await clearOutbox(paths);
  return {
    batchId: payload.batchId,
    duplicate: response.duplicate,
    acceptedSamples: response.acceptedSamples,
    appServerStatus: payload.collector.appServer,
    scannedRecords: payload.scanner.recordsRead,
    backlogBytes: payload.scanner.backlogBytes,
    resumedOutbox: false,
  };
};

export const runDaemon = async (
  config: AgentConfig,
  onReceipt: (receipt: CollectionReceipt) => void,
  onError: (error: Error, retrySeconds: number) => void,
): Promise<void> => {
  let stopping = false;
  let failures = 0;
  const stop = (): void => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    while (!stopping) {
      try {
        const receipt = await collectAndUploadOnce(config);
        failures = 0;
        onReceipt(receipt);
      } catch (error) {
        failures += 1;
        const retrySeconds = Math.min(config.pollIntervalSeconds * 8, 15 * 60, 2 ** failures * 5);
        onError(error as Error, retrySeconds);
        await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1_000));
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalSeconds * 1_000));
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
};
