import { describe, expect, it } from "vitest";

import { buildQuotaAllocationSegments, quotaAllocationColor } from "./quota-allocation.js";

describe("quota allocation visuals", () => {
  it("places device estimates directly inside the official used percentage", () => {
    const segments = buildQuotaAllocationSegments(
      [
        {
          deviceId: "lab",
          label: "实验室",
          percentagePoints: 18.4,
          confidence: "medium",
        },
        {
          deviceId: "home",
          label: "家中",
          percentagePoints: 16.4,
          confidence: "medium",
        },
      ],
      34.8,
    );

    expect(segments).toMatchObject([
      { deviceId: "lab", percentagePoints: 18.4, startPercent: 0 },
      { deviceId: "home", percentagePoints: 16.4, startPercent: 18.4 },
    ]);
  });

  it("keeps unexplained official usage visible as unattributed", () => {
    const segments = buildQuotaAllocationSegments(
      [
        {
          deviceId: "home",
          label: "家中",
          percentagePoints: 7,
          confidence: "high",
        },
      ],
      10,
    );

    expect(segments.at(-1)).toMatchObject({
      deviceId: null,
      label: "未归因",
      percentagePoints: 3,
      startPercent: 7,
      confidence: "unattributed",
    });
  });

  it("uses a dedicated warning color for unattributed usage", () => {
    expect(quotaAllocationColor({ deviceId: null }, 0)).toBe("#ff6b52");
    expect(quotaAllocationColor({ deviceId: "home" }, 0)).toBe("#3157ff");
  });
});
