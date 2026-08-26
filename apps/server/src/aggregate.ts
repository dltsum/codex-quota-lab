import type { BreakdownEntry, BreakdownSet } from "@quotalab/contracts";

export interface AggregateSample {
  deviceId: string;
  model: string;
  reasoningEffort: string;
  surface: string;
  totalTokens: number;
  purposeContext: number;
  purposeReasoning: number;
  purposeCode: number;
  purposeTools: number;
  purposeConversation: number;
}

const labels: Record<string, string> = {
  cli: "CLI",
  ide: "IDE 插件",
  desktop: "桌面 App",
  cloud: "云端",
  subagent: "子代理",
  unknown: "未知入口",
  context: "上下文 / 输入",
  reasoning: "推理",
  code: "代码编写",
  tools: "工具编排",
  conversation: "解释与对话",
};

const entries = (values: Map<string, number>): BreakdownEntry[] => {
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return [...values.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, tokens]) => ({
      key,
      label: labels[key] ?? key,
      tokens,
      percent: Math.round((tokens / total) * 10_000) / 100,
    }));
};

const add = (map: Map<string, number>, key: string, value: number): void => {
  if (value <= 0) return;
  map.set(key, (map.get(key) ?? 0) + value);
};

export const aggregateBreakdowns = (
  samples: AggregateSample[],
  deviceId?: string,
): BreakdownSet => {
  const models = new Map<string, number>();
  const efforts = new Map<string, number>();
  const surfaces = new Map<string, number>();
  const purposes = new Map<string, number>();

  for (const sample of samples) {
    if (deviceId !== undefined && sample.deviceId !== deviceId) continue;
    add(models, sample.model, sample.totalTokens);
    add(efforts, sample.reasoningEffort, sample.totalTokens);
    add(surfaces, sample.surface, sample.totalTokens);
    add(purposes, "context", sample.purposeContext);
    add(purposes, "reasoning", sample.purposeReasoning);
    add(purposes, "code", sample.purposeCode);
    add(purposes, "tools", sample.purposeTools);
    add(purposes, "conversation", sample.purposeConversation);
  }

  return {
    models: entries(models),
    efforts: entries(efforts),
    purposes: entries(purposes),
    surfaces: entries(surfaces),
  };
};
