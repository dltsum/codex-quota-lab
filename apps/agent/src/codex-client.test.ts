import { describe, expect, it } from "vitest";

import { normalizeAccountUsage, normalizeRateLimits } from "./codex-client.js";

describe("Codex App Server response normalization", () => {
  it("normalizes the official multi-bucket quota view", () => {
    const buckets = normalizeRateLimits(
      {
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            limitName: null,
            primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
            secondary: { usedPercent: 42, windowDurationMins: 10_080, resetsAt: 1_800_500_000 },
          },
        },
      },
      "plus",
    );

    expect(buckets).toEqual([
      {
        limitId: "codex",
        limitName: null,
        planType: "plus",
        windows: [
          { kind: "primary", usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          {
            kind: "secondary",
            usedPercent: 42,
            windowDurationMins: 10_080,
            resetsAt: 1_800_500_000,
          },
        ],
      },
    ]);
  });

  it("keeps only numeric account usage and never account identity", () => {
    const usage = normalizeAccountUsage({
      summary: {
        lifetimeTokens: 1_234,
        peakDailyTokens: 500,
        longestRunningTurnSec: 20,
        currentStreakDays: 2,
        longestStreakDays: 4,
        email: "must-not-pass@example.com",
      },
      dailyUsageBuckets: [{ startDate: "2026-08-27", tokens: 80 }],
    });
    expect(usage?.lifetimeTokens).toBe(1_234);
    expect(JSON.stringify(usage)).not.toContain("example.com");
  });
});
