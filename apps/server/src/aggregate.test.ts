import { describe, expect, it } from "vitest";

import { aggregateBreakdowns } from "./aggregate.js";

describe("breakdown aggregation", () => {
  it("keeps model, effort, purpose, and surface denominators separate", () => {
    const result = aggregateBreakdowns([
      {
        deviceId: "home",
        model: "gpt-a",
        reasoningEffort: "high",
        surface: "ide",
        totalTokens: 100,
        purposeContext: 60,
        purposeReasoning: 20,
        purposeCode: 10,
        purposeTools: 5,
        purposeConversation: 5,
      },
      {
        deviceId: "lab",
        model: "gpt-b",
        reasoningEffort: "low",
        surface: "cli",
        totalTokens: 100,
        purposeContext: 40,
        purposeReasoning: 10,
        purposeCode: 30,
        purposeTools: 10,
        purposeConversation: 10,
      },
    ]);

    expect(result.models.map((entry) => entry.percent)).toEqual([50, 50]);
    expect(result.purposes.reduce((sum, entry) => sum + entry.percent, 0)).toBe(100);
    expect(result.surfaces.map((entry) => entry.label)).toEqual(["IDE 插件", "CLI"]);
  });
});
