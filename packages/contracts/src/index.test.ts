import { describe, expect, it } from "vitest";

import { AgentIngestRequestSchema, CreateGroupRequestSchema, UsageSliceSchema } from "./index.js";

const validSlice = {
  sampleId: "a".repeat(64),
  sessionKey: "b".repeat(64),
  startedAt: "2026-08-27T00:00:00.000Z",
  endedAt: "2026-08-27T00:00:01.000Z",
  surface: "ide",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  tokens: {
    input: 100,
    cachedInput: 20,
    cacheWriteInput: 0,
    output: 30,
    reasoningOutput: 10,
    total: 130,
  },
  purposes: { context: 100, reasoning: 10, code: 10, tools: 5, conversation: 5 },
  activity: { toolCalls: 2, fileChanges: 1, activeMs: 1_000 },
  measurement: "local",
  purposeMethod: "event-envelope-v1",
} as const;

describe("privacy-safe contracts", () => {
  it("accepts a bounded aggregate usage slice", () => {
    expect(UsageSliceSchema.parse(validSlice)).toEqual(validSlice);
  });

  it("rejects content-bearing fields instead of silently stripping them", () => {
    expect(() => UsageSliceSchema.parse({ ...validSlice, prompt: "private" })).toThrow();
    expect(() => UsageSliceSchema.parse({ ...validSlice, command: "private" })).toThrow();
  });

  it("rejects an ingestion envelope containing an unknown raw event field", () => {
    const request = {
      batchId: "3d6f0a43-4c87-47da-b97d-1ebadc489609",
      observedAt: "2026-08-27T00:00:01.000Z",
      agentVersion: "0.1.0",
      platform: "win32-x64",
      network: { privateIp: "192.168.1.2", macAddress: null },
      quotaBuckets: [],
      accountUsage: null,
      usageSlices: [validSlice],
      collector: { appServer: "ok", errorCode: null },
      scanner: {
        filesSeen: 1,
        filesUpdated: 1,
        bytesRead: 100,
        recordsRead: 2,
        malformedRecords: 0,
        truncatedFiles: 0,
        backlogBytes: 0,
      },
      rawSession: "must never pass",
    };

    expect(() => AgentIngestRequestSchema.parse(request)).toThrow();
  });

  it("requires a non-trivial group key", () => {
    expect(
      CreateGroupRequestSchema.safeParse({ groupName: "Lab", groupKey: "short" }).success,
    ).toBe(false);
  });
});
