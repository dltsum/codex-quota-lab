import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { classifySurface, scanCodexSessions } from "./scanner.js";

const temporaryRoots: string[] = [];

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

const tokenEvent = (
  timestamp: string,
  total: number,
  input: number,
  output: number,
  reasoning: number,
) => ({
  timestamp,
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: input,
        cached_input_tokens: 10,
        cache_write_input_tokens: 0,
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: total,
      },
      last_token_usage: {
        input_tokens: input,
        cached_input_tokens: 10,
        cache_write_input_tokens: 0,
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: total,
      },
    },
  },
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("launch surface classification", () => {
  it.each([
    ["vscode", "codex_vscode", "user", "ide"],
    ["vscode", "Codex Desktop", "user", "desktop"],
    ["exec", "codex_exec", "user", "cli"],
    ["remote", "codex_cloud", "user", "cloud"],
    ["vscode", "codex_vscode", { subagent: "worker" }, "subagent"],
    [null, null, null, "unknown"],
  ])("maps %s / %s / %o to %s", (source, originator, threadSource, expected) => {
    expect(classifySurface(source, originator, threadSource)).toBe(expected);
  });
});

describe("privacy-safe incremental scanner", () => {
  it("reads a live JSONL incrementally without returning event content or paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "quotalab-scanner-"));
    temporaryRoots.push(root);
    const directory = join(root, "sessions", "2026", "08", "27");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "rollout-private-project.jsonl");
    const timestamp = "2026-08-27T01:00:00.000Z";
    const secret = "TOP_SECRET_PROMPT_AND_CODE";
    const initial = [
      {
        timestamp,
        type: "session_meta",
        payload: {
          session_id: "session-private-id",
          source: "vscode",
          originator: "codex_vscode",
          thread_source: "user",
          cwd: "C:/private/repository",
        },
      },
      {
        timestamp,
        type: "turn_context",
        payload: { turn_id: "turn-1", model: "gpt-5.6-sol", effort: "high" },
      },
      {
        timestamp,
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1", started_at: timestamp },
      },
      {
        timestamp,
        type: "response_item",
        payload: {
          type: "function_call",
          name: "apply_patch",
          arguments: `*** patch ${secret}`,
        },
      },
      tokenEvent("2026-08-27T01:00:04.000Z", 100, 80, 20, 10),
      {
        timestamp: "2026-08-27T01:00:05.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          completed_at: "2026-08-27T01:00:05.000Z",
          duration_ms: 5_000,
        },
      },
    ]
      .map(line)
      .join("");
    await writeFile(path, `${initial}{malformed-json\n`, "utf8");

    const heldOpen = await open(path, "a");
    try {
      const first = await scanCodexSessions({
        codexHome: root,
        previousState: { version: 1, files: {} },
        now: new Date("2026-08-27T01:01:00.000Z"),
        lookbackDays: 8,
        maxBytes: 4 * 1024 * 1024,
      });
      expect(first.usageSlices).toHaveLength(1);
      expect(first.usageSlices[0]).toMatchObject({
        surface: "ide",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        tokens: { total: 100 },
        activity: { activeMs: 5_000 },
      });
      expect(
        Object.values(first.usageSlices[0]!.purposes).reduce((sum, value) => sum + value, 0),
      ).toBe(100);
      expect(first.health.malformedRecords).toBe(1);
      const serialized = JSON.stringify(first);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("private/repository");
      expect(serialized).not.toContain("rollout-private-project");
      expect(first.usageSlices[0]!.sessionKey).toBe(
        createHash("sha256").update("session-private-id").digest("hex"),
      );

      const unchanged = await scanCodexSessions({
        codexHome: root,
        previousState: first.nextState,
        now: new Date("2026-08-27T01:02:00.000Z"),
        lookbackDays: 8,
        maxBytes: 4 * 1024 * 1024,
      });
      expect(unchanged.usageSlices).toHaveLength(0);

      const appended = [
        {
          timestamp: "2026-08-27T01:02:01.000Z",
          type: "turn_context",
          payload: { turn_id: "turn-2", model: "gpt-5.6-terra", effort: "low" },
        },
        {
          timestamp: "2026-08-27T01:02:01.000Z",
          type: "event_msg",
          payload: {
            type: "task_started",
            turn_id: "turn-2",
            started_at: "2026-08-27T01:02:01.000Z",
          },
        },
        {
          timestamp: "2026-08-27T01:02:02.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "shell_command",
            arguments: `do-not-upload-${secret}`,
          },
        },
        tokenEvent("2026-08-27T01:02:03.000Z", 180, 140, 40, 15),
      ]
        .map(line)
        .join("");
      await heldOpen.write(appended);
      await heldOpen.sync();
      const second = await scanCodexSessions({
        codexHome: root,
        previousState: unchanged.nextState,
        now: new Date("2026-08-27T01:03:00.000Z"),
        lookbackDays: 8,
        maxBytes: 4 * 1024 * 1024,
      });
      expect(second.usageSlices).toHaveLength(1);
      expect(second.usageSlices[0]).toMatchObject({
        model: "gpt-5.6-terra",
        reasoningEffort: "low",
        tokens: { total: 80 },
        activity: { toolCalls: 1 },
      });
      expect(JSON.stringify(second)).not.toContain(secret);
      expect(second.usageSlices[0]!.sampleId).not.toBe(first.usageSlices[0]!.sampleId);
    } finally {
      await heldOpen.close();
    }
  });

  it("detects truncation and resets cumulative totals without a negative delta", async () => {
    const root = await mkdtemp(join(tmpdir(), "quotalab-truncate-"));
    temporaryRoots.push(root);
    const directory = join(root, "sessions");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "rollout.jsonl");
    await writeFile(path, line(tokenEvent("2026-08-27T01:00:00.000Z", 500, 400, 100, 40)), "utf8");
    const first = await scanCodexSessions({
      codexHome: root,
      previousState: { version: 1, files: {} },
      now: new Date("2026-08-27T01:00:01.000Z"),
    });
    expect(first.usageSlices[0]!.tokens.total).toBe(500);

    await writeFile(path, line(tokenEvent("2026-08-27T01:01:00.000Z", 20, 15, 5, 2)), "utf8");
    const second = await scanCodexSessions({
      codexHome: root,
      previousState: first.nextState,
      now: new Date("2026-08-27T01:01:01.000Z"),
    });
    expect(second.health.truncatedFiles).toBe(1);
    expect(second.usageSlices[0]!.tokens.total).toBe(20);
    expect(second.usageSlices[0]!.tokens.total).toBeGreaterThanOrEqual(0);
  });
});
