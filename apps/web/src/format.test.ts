import { describe, expect, it } from "vitest";

import { formatCountdown, formatDuration, formatTokens, limitLabel } from "./format.js";

describe("dashboard formatting", () => {
  it("formats compact tokens and durations", () => {
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatDuration(3_900_000)).toBe("1 小时 5 分");
  });

  it("derives quota labels and countdowns from official window metadata", () => {
    expect(limitLabel(300, null)).toBe("5 小时窗口");
    expect(limitLabel(10_080, null)).toBe("1 周窗口");
    expect(
      formatCountdown("2026-08-27T03:30:00.000Z", Date.parse("2026-08-27T01:00:00.000Z")),
    ).toBe("2 小时 30 分后重置");
  });
});
