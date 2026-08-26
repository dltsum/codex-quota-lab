import type { AttributionConfidence, QuotaAllocation } from "@quotalab/contracts";

export interface AttributionSnapshot {
  observedAt: number;
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

export interface AttributionSample {
  deviceId: string;
  startedAt: number;
  endedAt: number;
  totalTokens: number;
}

export interface AttributionResult {
  allocations: QuotaAllocation[];
  attributedPercentagePoints: number;
  unattributedPercentagePoints: number;
}

const confidenceRank: Record<AttributionConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
  unattributed: 3,
};

const lowerConfidence = (
  current: AttributionConfidence | undefined,
  candidate: AttributionConfidence,
): AttributionConfidence => {
  if (current === undefined) return candidate;
  return confidenceRank[candidate] > confidenceRank[current] ? candidate : current;
};

const round = (value: number): number => Math.round(value * 1_000) / 1_000;

export const attributeQuota = (
  snapshots: AttributionSnapshot[],
  samples: AttributionSample[],
  deviceLabels: ReadonlyMap<string, string>,
): AttributionResult => {
  if (snapshots.length === 0) {
    return { allocations: [], attributedPercentagePoints: 0, unattributedPercentagePoints: 0 };
  }

  const ordered = [...snapshots].sort((a, b) => a.observedAt - b.observedAt);
  const latest = ordered.at(-1)!;
  const currentPercent = Math.max(0, Math.min(100, latest.usedPercent));
  const amounts = new Map<string, number>();
  const confidences = new Map<string, AttributionConfidence>();
  let unattributed = Math.max(0, ordered[0]!.usedPercent);
  let previousPercent = ordered[0]!.usedPercent;
  let previousTime = ordered[0]!.observedAt;

  for (const snapshot of ordered.slice(1)) {
    if (snapshot.observedAt <= previousTime) continue;
    const delta = snapshot.usedPercent - previousPercent;
    if (delta > 0) {
      const weights = new Map<string, number>();
      for (const sample of samples) {
        if (sample.totalTokens <= 0) continue;
        if (sample.endedAt <= previousTime || sample.startedAt > snapshot.observedAt) continue;
        weights.set(sample.deviceId, (weights.get(sample.deviceId) ?? 0) + sample.totalTokens);
      }

      const totalWeight = [...weights.values()].reduce((sum, value) => sum + value, 0);
      if (totalWeight === 0) {
        unattributed += delta;
      } else {
        const confidence: AttributionConfidence = weights.size === 1 ? "high" : "medium";
        for (const [deviceId, weight] of weights) {
          const share = delta * (weight / totalWeight);
          amounts.set(deviceId, (amounts.get(deviceId) ?? 0) + share);
          confidences.set(deviceId, lowerConfidence(confidences.get(deviceId), confidence));
        }
      }
    }

    previousPercent = snapshot.usedPercent;
    previousTime = snapshot.observedAt;
  }

  const rawTotal = unattributed + [...amounts.values()].reduce((sum, value) => sum + value, 0);
  const scale = rawTotal > 0 ? currentPercent / rawTotal : 0;
  unattributed *= scale;
  for (const [deviceId, amount] of amounts) amounts.set(deviceId, amount * scale);

  const allocations: QuotaAllocation[] = [...amounts.entries()]
    .filter(([, value]) => value > 0.0005)
    .sort((a, b) => b[1] - a[1])
    .map(([deviceId, percentagePoints]) => ({
      deviceId,
      label: deviceLabels.get(deviceId) ?? "未知设备",
      percentagePoints: round(percentagePoints),
      confidence: confidences.get(deviceId) ?? "low",
    }));

  if (unattributed > 0.0005 || (allocations.length === 0 && currentPercent > 0)) {
    allocations.push({
      deviceId: null,
      label: "未归因",
      percentagePoints: round(unattributed || currentPercent),
      confidence: "unattributed",
    });
  }

  const unattributedRounded = round(
    unattributed || (allocations.length === 0 ? currentPercent : 0),
  );
  return {
    allocations,
    attributedPercentagePoints: round(Math.max(0, currentPercent - unattributedRounded)),
    unattributedPercentagePoints: unattributedRounded,
  };
};
