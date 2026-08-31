import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "./app.js";
import type { ServerConfig } from "./config.js";

const baseMs = Date.parse("2026-08-27T00:00:00.000Z");
const groupKey = "a-long-unique-lab-key";
let clock = baseMs;
const temporaryRoots: string[] = [];

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 4317,
  databasePath: ":memory:",
  webDistPath: "Z:/definitely-not-present",
  secureCookies: false,
  trustProxy: false,
  logLevel: "silent",
  sessionTtlMs: 7 * 24 * 60 * 60 * 1_000,
  scryptCost: 1_024,
};

const cookieValue = (header: string | string[] | undefined): string => {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("missing session cookie");
  return value.split(";", 1)[0]!;
};

const usageSlice = (device: string, total: number, startOffset: number, activeMs = 20_000) => ({
  sampleId: (device === "home" ? "a" : "b").repeat(64),
  sessionKey: (device === "home" ? "c" : "d").repeat(64),
  startedAt: new Date(baseMs + startOffset).toISOString(),
  endedAt: new Date(baseMs + startOffset + 20_000).toISOString(),
  surface: device === "home" ? "ide" : "cli",
  model: device === "home" ? "gpt-5.6-sol" : "gpt-5.6-terra",
  reasoningEffort: device === "home" ? "high" : "low",
  tokens: {
    input: total - 20,
    cachedInput: 10,
    cacheWriteInput: 0,
    output: 20,
    reasoningOutput: 10,
    total,
  },
  purposes: {
    context: total - 20,
    reasoning: 10,
    code: 5,
    tools: 3,
    conversation: 2,
  },
  activity: { toolCalls: 1, fileChanges: 1, activeMs },
  measurement: "local",
  purposeMethod: "event-envelope-v1",
});

const ingestBody = (
  device: "home" | "lab",
  batchId: string,
  observedOffset: number,
  usedPercent: number,
  totalTokens: number,
) => ({
  batchId,
  observedAt: new Date(baseMs + observedOffset).toISOString(),
  agentVersion: "0.1.0",
  platform: "win32-x64",
  network: {
    privateIp: device === "home" ? "192.168.1.8" : "10.0.0.9",
    macAddress: device === "home" ? "AA:BB:CC:DD:EE:01" : "AA:BB:CC:DD:EE:02",
  },
  quotaBuckets: [
    {
      limitId: "codex",
      limitName: "5 hour",
      planType: "plus",
      windows: [
        {
          kind: "primary",
          usedPercent,
          windowDurationMins: 300,
          resetsAt: Math.floor((baseMs + 300 * 60_000) / 1_000),
        },
      ],
    },
  ],
  accountUsage: {
    lifetimeTokens: 100_000 + totalTokens,
    peakDailyTokens: 50_000,
    longestRunningTurnSec: 120,
    currentStreakDays: 4,
    longestStreakDays: 8,
    dailyUsageBuckets: [{ startDate: "2026-08-27", tokens: totalTokens }],
  },
  usageSlices: [usageSlice(device, totalTokens, 70_000, device === "home" ? 60_000 : 120_000)],
  collector: { appServer: "ok", errorCode: null },
  scanner: {
    filesSeen: 2,
    filesUpdated: 1,
    bytesRead: 4_096,
    recordsRead: 10,
    malformedRecords: 0,
    truncatedFiles: 0,
    backlogBytes: 0,
  },
});

describe("QuotaLab HTTP integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    clock = baseMs;
    app = await buildApp({ config, now: () => clock });
  });

  afterEach(async () => {
    await app.close();
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("creates, authenticates, enrolls, ingests, attributes, and renames devices", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/groups",
      payload: { groupName: "研究小组", groupKey },
    });
    expect(created.statusCode).toBe(201);
    const { group } = created.json<{ group: { slug: string } }>();
    const browserCookie = cookieValue(created.headers["set-cookie"]);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { groupSlug: group.slug, groupKey: `${groupKey}-wrong` },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("GROUP_LOGIN_FAILED");

    const homeEnrollment = await app.inject({
      method: "POST",
      url: "/api/agent/enroll",
      remoteAddress: "203.0.113.8",
      payload: {
        groupSlug: group.slug,
        groupKey,
        devicePublicId: "1fd135ba-8079-40bd-bb08-bd6ef985ea67",
        deviceName: null,
        platform: "win32-x64",
        agentVersion: "0.1.0",
        network: { privateIp: "192.168.1.8", macAddress: "AA:BB:CC:DD:EE:01" },
      },
    });
    const home = homeEnrollment.json<{
      device: { id: string };
      deviceToken: string;
    }>();
    expect(homeEnrollment.statusCode).toBe(201);

    const labEnrollment = await app.inject({
      method: "POST",
      url: "/api/agent/enroll",
      payload: {
        groupSlug: group.slug,
        groupKey,
        devicePublicId: "6cb6ab20-5145-4427-9b19-41d14f03333c",
        deviceName: "实验室主机",
        platform: "linux-x64",
        agentVersion: "0.1.0",
        network: { privateIp: "10.0.0.9", macAddress: "AA:BB:CC:DD:EE:02" },
      },
    });
    const lab = labEnrollment.json<{ device: { id: string }; deviceToken: string }>();

    clock = baseMs + 60_000;
    const homeIngest = await app.inject({
      method: "POST",
      url: "/api/agent/ingest",
      headers: { authorization: `Bearer ${home.deviceToken}` },
      payload: ingestBody("home", "a10b6d72-8a62-4ad0-814f-d5a273682d34", 60_000, 0, 300),
    });
    expect(homeIngest.statusCode).toBe(202);

    clock = baseMs + 120_000;
    const labIngest = await app.inject({
      method: "POST",
      url: "/api/agent/ingest",
      headers: { authorization: `Bearer ${lab.deviceToken}` },
      payload: ingestBody("lab", "9f7c9f6c-55eb-4ed4-945f-c18f30be6b5b", 120_000, 12, 100),
    });
    expect(labIngest.statusCode).toBe(202);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/agent/ingest",
      headers: { authorization: `Bearer ${lab.deviceToken}` },
      payload: ingestBody("lab", "9f7c9f6c-55eb-4ed4-945f-c18f30be6b5b", 120_000, 12, 100),
    });
    expect(duplicate.json().duplicate).toBe(true);

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie: browserCookie },
    });
    expect(dashboard.statusCode).toBe(200);
    const body = dashboard.json();
    expect(body.limits[0].usedPercent).toBe(12);
    expect(body.limits[0].source).toBe("official");
    expect(body.devices).toHaveLength(2);
    expect(body.devices.find((device: any) => device.id === home.device.id).label).toContain(
      "192.168.1.8",
    );
    const homeSummary = body.devices.find((device: any) => device.id === home.device.id);
    const labSummary = body.devices.find((device: any) => device.id === lab.device.id);
    expect(homeSummary.activeSharePercent).toBeCloseTo(33.33, 2);
    expect(labSummary.activeSharePercent).toBeCloseTo(66.67, 2);
    expect(homeSummary.activeSharePercent + labSummary.activeSharePercent).toBeCloseTo(100, 1);
    expect(body.allocations.every((allocation: any) => allocation.confidence !== "exact")).toBe(
      true,
    );

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/devices/${home.device.id}`,
      headers: { cookie: browserCookie },
      payload: { name: "家中电脑", softBudgetPercent: 35 },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().device).toMatchObject({
      label: "家中电脑",
      registered: true,
      macAddress: null,
      softBudgetPercent: 35,
    });

    const formulaName = await app.inject({
      method: "PATCH",
      url: `/api/devices/${home.device.id}`,
      headers: { cookie: browserCookie },
      payload: { name: '=HYPERLINK("https://invalid.example")' },
    });
    expect(formulaName.statusCode).toBe(200);
    const exported = await app.inject({
      method: "GET",
      url: "/api/export.csv",
      headers: { cookie: browserCookie },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain("'=HYPERLINK");
    expect(exported.body).not.toMatch(/(?:^|\r\n)=HYPERLINK/);
    expect(exported.body.split("\r\n", 1)[0]).toContain("active_share_percent");
  });

  it("fails closed for private APIs and rejects content-bearing ingestion", async () => {
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    expect(dashboard.statusCode).toBe(401);

    const created = await app.inject({
      method: "POST",
      url: "/api/groups",
      payload: { groupName: "Lab", groupKey },
    });
    const { group } = created.json<{ group: { slug: string } }>();
    const enrolled = await app.inject({
      method: "POST",
      url: "/api/agent/enroll",
      payload: {
        groupSlug: group.slug,
        groupKey,
        devicePublicId: "25615bb9-f843-42bc-9135-9df4ff8ed940",
        deviceName: "Desk",
        platform: "win32-x64",
        agentVersion: "0.1.0",
        network: { privateIp: null, macAddress: null },
      },
    });
    const { deviceToken } = enrolled.json<{ deviceToken: string }>();
    const payload = {
      ...ingestBody("home", "85355134-6183-461c-b380-ed0560b0e40f", 1, 1, 50),
      prompt: "secret",
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/ingest",
      headers: { authorization: `Bearer ${deviceToken}` },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
    expect(response.body).not.toContain("secret");
  });

  it("serves the dashboard root without exposing sibling files through traversal paths", async () => {
    await app.close();
    const root = await mkdtemp(join(tmpdir(), "quotalab-static-"));
    temporaryRoots.push(root);
    const webRoot = join(root, "web");
    await mkdir(webRoot);
    await writeFile(join(webRoot, "index.html"), "<main>QuotaLab dashboard</main>");
    await writeFile(join(webRoot, "app.js"), "globalThis.QUOTALAB_SAFE = true;");
    await writeFile(join(root, "outside.txt"), "must-not-be-served");
    app = await buildApp({ config: { ...config, webDistPath: webRoot }, now: () => clock });

    const asset = await app.inject({ method: "GET", url: "/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("QUOTALAB_SAFE");

    for (const url of [
      "/assets/../../outside.txt",
      "/assets/%2e%2e/%2e%2e/outside.txt",
      "/foo/..%2Foutside.txt",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.body).not.toContain("must-not-be-served");
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
  });
});
