import type { QuotaAllocation } from "@quotalab/contracts";

const DEVICE_COLORS = ["#3157ff", "#8fd5c1", "#8c6cff", "#e8b44b", "#59758f", "#ff9a7f"];
const UNATTRIBUTED_COLOR = "#ff6b52";

export interface QuotaAllocationSegment extends QuotaAllocation {
  color: string;
  startPercent: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const quotaAllocationColor = (
  allocation: Pick<QuotaAllocation, "deviceId">,
  index: number,
): string =>
  allocation.deviceId === null ? UNATTRIBUTED_COLOR : DEVICE_COLORS[index % DEVICE_COLORS.length]!;

export const buildQuotaAllocationSegments = (
  allocations: QuotaAllocation[],
  officialUsedPercent: number,
): QuotaAllocationSegment[] => {
  const usedPercent = clamp(officialUsedPercent, 0, 100);
  if (usedPercent === 0) return [];

  const normalized = allocations
    .filter((allocation) => allocation.percentagePoints > 0)
    .map((allocation) => ({ ...allocation }));
  const reportedTotal = normalized.reduce(
    (sum, allocation) => sum + allocation.percentagePoints,
    0,
  );

  if (reportedTotal < usedPercent) {
    const missing = usedPercent - reportedTotal;
    const unattributed = normalized.find((allocation) => allocation.deviceId === null);
    if (unattributed) unattributed.percentagePoints += missing;
    else {
      normalized.push({
        deviceId: null,
        label: "未归因",
        percentagePoints: missing,
        confidence: "unattributed",
      });
    }
  } else if (reportedTotal > usedPercent) {
    const scale = usedPercent / reportedTotal;
    for (const allocation of normalized) allocation.percentagePoints *= scale;
  }

  let cursor = 0;
  return normalized.map((allocation, index) => {
    const segment = {
      ...allocation,
      percentagePoints: clamp(allocation.percentagePoints, 0, usedPercent - cursor),
      startPercent: cursor,
      color: quotaAllocationColor(allocation, index),
    };
    cursor += segment.percentagePoints;
    return segment;
  });
};
