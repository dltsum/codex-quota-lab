import { describe, expect, it } from "vitest";

import { attributeQuota } from "./attribution.js";

const labels = new Map([
  ["home", "家中电脑"],
  ["lab", "实验室电脑"],
]);

describe("quota attribution", () => {
  it("keeps the first non-zero observation unattributed", () => {
    const result = attributeQuota(
      [{ observedAt: 100, usedPercent: 22, resetsAt: 1_000, windowDurationMins: 60 }],
      [{ deviceId: "home", startedAt: 1, endedAt: 90, totalTokens: 50_000 }],
      labels,
    );

    expect(result.allocations).toEqual([
      {
        deviceId: null,
        label: "未归因",
        percentagePoints: 22,
        confidence: "unattributed",
      },
    ]);
  });

  it("assigns a positive interval delta to the only active device", () => {
    const result = attributeQuota(
      [
        { observedAt: 100, usedPercent: 20, resetsAt: 1_000, windowDurationMins: 60 },
        { observedAt: 200, usedPercent: 30, resetsAt: 1_000, windowDurationMins: 60 },
      ],
      [{ deviceId: "home", startedAt: 120, endedAt: 180, totalTokens: 100 }],
      labels,
    );

    expect(result.allocations).toContainEqual({
      deviceId: "home",
      label: "家中电脑",
      percentagePoints: 10,
      confidence: "high",
    });
    expect(result.unattributedPercentagePoints).toBe(20);
  });

  it("splits concurrent activity by local tokens and lowers confidence", () => {
    const result = attributeQuota(
      [
        { observedAt: 100, usedPercent: 0, resetsAt: 1_000, windowDurationMins: 60 },
        { observedAt: 200, usedPercent: 12, resetsAt: 1_000, windowDurationMins: 60 },
      ],
      [
        { deviceId: "home", startedAt: 120, endedAt: 180, totalTokens: 3_000 },
        { deviceId: "lab", startedAt: 130, endedAt: 190, totalTokens: 1_000 },
      ],
      labels,
    );

    expect(result.allocations).toEqual([
      {
        deviceId: "home",
        label: "家中电脑",
        percentagePoints: 9,
        confidence: "medium",
      },
      {
        deviceId: "lab",
        label: "实验室电脑",
        percentagePoints: 3,
        confidence: "medium",
      },
    ]);
  });

  it("never creates a negative device charge after a correction", () => {
    const result = attributeQuota(
      [
        { observedAt: 100, usedPercent: 0, resetsAt: 1_000, windowDurationMins: 60 },
        { observedAt: 200, usedPercent: 20, resetsAt: 1_000, windowDurationMins: 60 },
        { observedAt: 300, usedPercent: 18, resetsAt: 1_000, windowDurationMins: 60 },
      ],
      [{ deviceId: "home", startedAt: 120, endedAt: 180, totalTokens: 1_000 }],
      labels,
    );

    expect(result.allocations[0]?.percentagePoints).toBe(18);
    expect(result.allocations.every((entry) => entry.percentagePoints >= 0)).toBe(true);
  });
});
