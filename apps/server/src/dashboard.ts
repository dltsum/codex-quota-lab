import type {
  DashboardResponse,
  DeviceDetailResponse,
  DeviceSummary,
  QuotaLimitSummary,
  TimelinePoint,
} from "@quotalab/contracts";

import { aggregateBreakdowns, type AggregateSample } from "./aggregate.js";
import { attributeQuota, type AttributionSample, type AttributionSnapshot } from "./attribution.js";
import { ApiError } from "./errors.js";
import type { Repository } from "./repository.js";
import type { DeviceRow, QuotaSnapshotRow, UsageSampleRow } from "./storage-types.js";

const MAX_HISTORY_MS = 40 * 24 * 60 * 60 * 1_000;
const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1_000;
const OFFICIAL_FRESH_MS = 5 * 60 * 1_000;

const quotaKey = (snapshot: Pick<QuotaSnapshotRow, "limit_id" | "kind">): string =>
  `${snapshot.limit_id}:${snapshot.kind}`;

const deviceLabel = (device: DeviceRow): string => {
  if (device.name) return device.name;
  const ip = device.private_ip ?? device.public_ip ?? "IP 未知";
  return `${ip} · ${device.mac_address ? `MAC ${device.mac_address}` : "MAC 未知"}`;
};

const deviceStatus = (lastSeenAt: number, now: number): DeviceSummary["status"] => {
  const age = now - lastSeenAt;
  if (age <= 3 * 60 * 1_000) return "online";
  if (age <= 15 * 60 * 1_000) return "stale";
  return "offline";
};

const toAggregateSample = (sample: UsageSampleRow): AggregateSample => ({
  deviceId: sample.device_id,
  model: sample.model,
  reasoningEffort: sample.reasoning_effort,
  surface: sample.surface,
  totalTokens: sample.total_tokens,
  purposeContext: sample.purpose_context,
  purposeReasoning: sample.purpose_reasoning,
  purposeCode: sample.purpose_code,
  purposeTools: sample.purpose_tools,
  purposeConversation: sample.purpose_conversation,
});

const pickLatestLimits = (snapshots: QuotaSnapshotRow[]): QuotaSnapshotRow[] => {
  const latest = new Map<string, QuotaSnapshotRow>();
  for (const snapshot of snapshots) {
    const key = quotaKey(snapshot);
    const current = latest.get(key);
    if (!current || snapshot.observed_at >= current.observed_at) latest.set(key, snapshot);
  }
  return [...latest.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "primary" ? -1 : 1;
    return (
      (a.window_duration_mins ?? Number.MAX_SAFE_INTEGER) -
      (b.window_duration_mins ?? Number.MAX_SAFE_INTEGER)
    );
  });
};

const collapseTimeline = (snapshots: QuotaSnapshotRow[]): TimelinePoint[] => {
  const points: TimelinePoint[] = [];
  for (const snapshot of snapshots) {
    const previous = points.at(-1);
    if (previous && previous.usedPercent === snapshot.used_percent) {
      previous.observedAt = new Date(snapshot.observed_at).toISOString();
      continue;
    }
    points.push({
      observedAt: new Date(snapshot.observed_at).toISOString(),
      usedPercent: snapshot.used_percent,
      source: "official",
    });
  }
  if (points.length <= 240) return points;
  const stride = Math.ceil(points.length / 240);
  const sampled = points.filter((_, index) => index % stride === 0);
  const last = points.at(-1)!;
  if (sampled.at(-1)?.observedAt !== last.observedAt) sampled.push(last);
  return sampled;
};

const latestLimitsToResponse = (latest: QuotaSnapshotRow[]): QuotaLimitSummary[] =>
  latest.map((snapshot) => ({
    key: quotaKey(snapshot),
    limitId: snapshot.limit_id,
    limitName: snapshot.limit_name,
    kind: snapshot.kind,
    usedPercent: snapshot.used_percent,
    remainingPercent: Math.max(0, Math.round((100 - snapshot.used_percent) * 1_000) / 1_000),
    windowDurationMins: snapshot.window_duration_mins,
    resetsAt: snapshot.resets_at === null ? null : new Date(snapshot.resets_at).toISOString(),
    observedAt: new Date(snapshot.observed_at).toISOString(),
    planType: snapshot.plan_type,
    source: "official",
  }));

const cycleStartFor = (snapshot: QuotaSnapshotRow | undefined, now: number): number => {
  if (snapshot?.resets_at && snapshot.window_duration_mins) {
    return snapshot.resets_at - snapshot.window_duration_mins * 60 * 1_000;
  }
  return now - DEFAULT_RANGE_MS;
};

export const buildDashboard = (
  repository: Repository,
  groupId: string,
  requestedFocusKey: string | undefined,
  now: number = Date.now(),
): DashboardResponse => {
  const group = repository.getGroupById(groupId);
  if (!group) throw new ApiError(404, "GROUP_NOT_FOUND", "群组不存在。 ");

  const allSnapshots = repository.listQuotaSnapshots(groupId, now - MAX_HISTORY_MS);
  const latestSnapshots = pickLatestLimits(allSnapshots);
  const focus =
    latestSnapshots.find((snapshot) => quotaKey(snapshot) === requestedFocusKey) ??
    latestSnapshots[0];
  const focusKey = focus ? quotaKey(focus) : null;
  const cycleStart = cycleStartFor(focus, now);
  const usageRows = repository.listUsageSamples(groupId, cycleStart);
  const aggregateRows = usageRows.map(toAggregateSample);
  const devices = repository.listDevices(groupId);
  const labels = new Map(devices.map((device) => [device.id, deviceLabel(device)]));

  const focusSnapshots = focus
    ? allSnapshots.filter(
        (snapshot) =>
          quotaKey(snapshot) === focusKey &&
          snapshot.observed_at >= cycleStart &&
          (focus.resets_at === null || snapshot.resets_at === focus.resets_at),
      )
    : [];
  const attribution = attributeQuota(
    focusSnapshots.map<AttributionSnapshot>((snapshot) => ({
      observedAt: snapshot.observed_at,
      usedPercent: snapshot.used_percent,
      resetsAt: snapshot.resets_at,
      windowDurationMins: snapshot.window_duration_mins,
    })),
    usageRows.map<AttributionSample>((sample) => ({
      deviceId: sample.device_id,
      startedAt: sample.started_at,
      endedAt: sample.ended_at,
      totalTokens: sample.total_tokens,
    })),
    labels,
  );
  const allocationByDevice = new Map(
    attribution.allocations
      .filter((entry) => entry.deviceId !== null)
      .map((entry) => [entry.deviceId!, entry]),
  );

  const deviceResponses = devices.map<DeviceSummary>((device) => {
    const ownRows = usageRows.filter((sample) => sample.device_id === device.id);
    const allocation = allocationByDevice.get(device.id);
    return {
      id: device.id,
      publicId: device.public_id,
      label: deviceLabel(device),
      registered: device.name !== null,
      privateIp: device.private_ip,
      publicIp: device.public_ip,
      macAddress: device.mac_address,
      platform: device.platform,
      agentVersion: device.agent_version,
      lastSeenAt: new Date(device.last_seen_at).toISOString(),
      status: deviceStatus(device.last_seen_at, now),
      softBudgetPercent: device.soft_budget_percent,
      tokenTotal: ownRows.reduce((sum, sample) => sum + sample.total_tokens, 0),
      activeMs: ownRows.reduce((sum, sample) => sum + sample.active_ms, 0),
      estimatedQuotaPercent: allocation?.percentagePoints ?? 0,
      attributionConfidence: allocation?.confidence ?? "low",
      breakdowns: aggregateBreakdowns(aggregateRows, device.id),
    };
  });

  const currentUsed = focus?.used_percent ?? 0;
  const localCoveragePercent =
    currentUsed <= 0
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            Math.round((attribution.attributedPercentagePoints / currentUsed) * 10_000) / 100,
          ),
        );
  const latestObservedAt = focus?.observed_at ?? 0;
  const officialSnapshotFresh = latestObservedAt > 0 && now - latestObservedAt <= OFFICIAL_FRESH_MS;
  const malformed = repository.scannerMalformedSince(groupId, cycleStart);

  let note = "设备分摊依据本地 token 活动估算；总体百分比来自官方额度接口。";
  if (!focus) note = "尚未收到官方额度快照，请先运行任一设备采集器。";
  else if (!officialSnapshotFresh) note = "官方额度快照已过期；当前状态可能已经变化。";
  else if (attribution.unattributedPercentagePoints > 0) {
    note = "存在无法由本地事件解释的额度消耗，已保留为未归因。";
  }

  return {
    group: { id: group.id, name: group.name, slug: group.slug },
    generatedAt: new Date(now).toISOString(),
    limits: latestLimitsToResponse(latestSnapshots),
    focusLimitKey: focusKey,
    allocations: attribution.allocations,
    devices: deviceResponses,
    overall: aggregateBreakdowns(aggregateRows),
    timeline: collapseTimeline(focusSnapshots),
    accountUsage: repository.getLatestAccountUsage(groupId),
    dataQuality: {
      officialSnapshotFresh,
      localCoveragePercent,
      unattributedPercentagePoints: attribution.unattributedPercentagePoints,
      scannerMalformedRecords: malformed,
      note,
    },
  };
};

export const buildDeviceDetail = (
  repository: Repository,
  groupId: string,
  deviceId: string,
  focusKey: string | undefined,
  now: number = Date.now(),
): DeviceDetailResponse => {
  if (!repository.getDevice(groupId, deviceId)) {
    throw new ApiError(404, "DEVICE_NOT_FOUND", "没有找到这台设备。 ");
  }
  const dashboard = buildDashboard(repository, groupId, focusKey, now);
  const device = dashboard.devices.find((candidate) => candidate.id === deviceId);
  if (!device) throw new ApiError(404, "DEVICE_NOT_FOUND", "没有找到这台设备。 ");

  const focus = dashboard.limits.find((limit) => limit.key === dashboard.focusLimitKey);
  const since =
    focus?.resetsAt && focus.windowDurationMins
      ? Date.parse(focus.resetsAt) - focus.windowDurationMins * 60 * 1_000
      : now - DEFAULT_RANGE_MS;
  const rows = repository
    .listUsageSamples(groupId, since)
    .filter((sample) => sample.device_id === deviceId);
  const hourlyMap = new Map<string, { tokens: number; activeMs: number }>();
  for (const row of rows) {
    const date = new Date(row.ended_at);
    date.setUTCMinutes(0, 0, 0);
    const hour = date.toISOString();
    const current = hourlyMap.get(hour) ?? { tokens: 0, activeMs: 0 };
    current.tokens += row.total_tokens;
    current.activeMs += row.active_ms;
    hourlyMap.set(hour, current);
  }

  return {
    device,
    hourly: [...hourlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, values]) => ({ hour, ...values })),
  };
};

const csvCell = (value: string | number | null): string => {
  if (typeof value === "number") return String(value);
  const raw = value ?? "";
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const dashboardCsv = (dashboard: DashboardResponse): string => {
  const headers = [
    "device",
    "status",
    "estimated_quota_percentage_points",
    "confidence",
    "tokens",
    "active_minutes",
    "soft_budget_percent",
    "last_seen_at",
  ];
  const lines = [headers.join(",")];
  for (const device of dashboard.devices) {
    lines.push(
      [
        device.label,
        device.status,
        device.estimatedQuotaPercent,
        device.attributionConfidence,
        device.tokenTotal,
        Math.round((device.activeMs / 60_000) * 100) / 100,
        device.softBudgetPercent,
        device.lastSeenAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
};
