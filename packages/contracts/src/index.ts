import { z } from "zod";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalNullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();
const nonNegativeInteger = z.number().int().nonnegative();

export const SurfaceSchema = z.enum(["cli", "ide", "desktop", "cloud", "subagent", "unknown"]);
export type Surface = z.infer<typeof SurfaceSchema>;

export const AttributionConfidenceSchema = z.enum(["high", "medium", "low", "unattributed"]);
export type AttributionConfidence = z.infer<typeof AttributionConfidenceSchema>;

export const TokenBreakdownSchema = z
  .object({
    input: nonNegativeInteger,
    cachedInput: nonNegativeInteger,
    cacheWriteInput: nonNegativeInteger,
    output: nonNegativeInteger,
    reasoningOutput: nonNegativeInteger,
    total: nonNegativeInteger,
  })
  .strict();
export type TokenBreakdown = z.infer<typeof TokenBreakdownSchema>;

export const PurposeBreakdownSchema = z
  .object({
    context: nonNegativeInteger,
    reasoning: nonNegativeInteger,
    code: nonNegativeInteger,
    tools: nonNegativeInteger,
    conversation: nonNegativeInteger,
  })
  .strict();
export type PurposeBreakdown = z.infer<typeof PurposeBreakdownSchema>;

export const QuotaWindowObservationSchema = z
  .object({
    kind: z.enum(["primary", "secondary"]),
    usedPercent: z.number().min(0).max(100),
    windowDurationMins: z
      .number()
      .int()
      .positive()
      .max(60 * 24 * 366)
      .nullable(),
    resetsAt: z.number().int().positive().nullable(),
  })
  .strict();
export type QuotaWindowObservation = z.infer<typeof QuotaWindowObservationSchema>;

export const QuotaBucketObservationSchema = z
  .object({
    limitId: boundedText(128),
    limitName: optionalNullableText(160),
    planType: optionalNullableText(64),
    windows: z.array(QuotaWindowObservationSchema).min(1).max(2),
  })
  .strict();
export type QuotaBucketObservation = z.infer<typeof QuotaBucketObservationSchema>;

export const AccountUsageObservationSchema = z
  .object({
    lifetimeTokens: nonNegativeInteger.nullable(),
    peakDailyTokens: nonNegativeInteger.nullable(),
    longestRunningTurnSec: nonNegativeInteger.nullable(),
    currentStreakDays: nonNegativeInteger.nullable(),
    longestStreakDays: nonNegativeInteger.nullable(),
    dailyUsageBuckets: z
      .array(
        z
          .object({
            startDate: z.iso.date(),
            tokens: nonNegativeInteger,
          })
          .strict(),
      )
      .max(400)
      .nullable(),
  })
  .strict();
export type AccountUsageObservation = z.infer<typeof AccountUsageObservationSchema>;

export const UsageSliceSchema = z
  .object({
    sampleId: z.string().regex(/^[a-f0-9]{64}$/),
    sessionKey: z.string().regex(/^[a-f0-9]{64}$/),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    surface: SurfaceSchema,
    model: boundedText(128),
    reasoningEffort: boundedText(32),
    tokens: TokenBreakdownSchema,
    purposes: PurposeBreakdownSchema,
    activity: z
      .object({
        toolCalls: nonNegativeInteger,
        fileChanges: nonNegativeInteger,
        activeMs: nonNegativeInteger,
      })
      .strict(),
    measurement: z.literal("local"),
    purposeMethod: z.literal("event-envelope-v1"),
  })
  .strict();
export type UsageSlice = z.infer<typeof UsageSliceSchema>;

export const ScannerHealthSchema = z
  .object({
    filesSeen: nonNegativeInteger,
    filesUpdated: nonNegativeInteger,
    bytesRead: nonNegativeInteger,
    recordsRead: nonNegativeInteger,
    malformedRecords: nonNegativeInteger,
    truncatedFiles: nonNegativeInteger,
    backlogBytes: nonNegativeInteger,
  })
  .strict();
export type ScannerHealth = z.infer<typeof ScannerHealthSchema>;

export const CollectorHealthSchema = z
  .object({
    appServer: z.enum(["ok", "unavailable", "unauthenticated", "error"]),
    errorCode: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();
export type CollectorHealth = z.infer<typeof CollectorHealthSchema>;

export const NetworkIdentitySchema = z
  .object({
    privateIp: z.string().trim().max(64).nullable(),
    macAddress: z
      .string()
      .trim()
      .regex(/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/)
      .nullable(),
  })
  .strict();
export type NetworkIdentity = z.infer<typeof NetworkIdentitySchema>;

export const CreateGroupRequestSchema = z
  .object({
    groupName: boundedText(80),
    groupKey: z.string().min(12).max(256),
  })
  .strict();
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;

export const LoginRequestSchema = z
  .object({
    groupSlug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{4,79}$/),
    groupKey: z.string().min(12).max(256),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const EnrollDeviceRequestSchema = z
  .object({
    groupSlug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{4,79}$/),
    groupKey: z.string().min(12).max(256),
    devicePublicId: z.uuid(),
    deviceName: optionalNullableText(80),
    platform: boundedText(64),
    agentVersion: boundedText(32),
    network: NetworkIdentitySchema,
  })
  .strict();
export type EnrollDeviceRequest = z.infer<typeof EnrollDeviceRequestSchema>;

export const AgentIngestRequestSchema = z
  .object({
    batchId: z.uuid(),
    observedAt: z.iso.datetime({ offset: true }),
    agentVersion: boundedText(32),
    platform: boundedText(64),
    network: NetworkIdentitySchema,
    quotaBuckets: z.array(QuotaBucketObservationSchema).max(16),
    accountUsage: AccountUsageObservationSchema.nullable(),
    usageSlices: z.array(UsageSliceSchema).max(2_000),
    collector: CollectorHealthSchema,
    scanner: ScannerHealthSchema,
  })
  .strict();
export type AgentIngestRequest = z.infer<typeof AgentIngestRequestSchema>;

export const UpdateDeviceRequestSchema = z
  .object({
    name: optionalNullableText(80),
    softBudgetPercent: z.number().min(0).max(100).nullable().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.softBudgetPercent !== undefined, {
    message: "At least one device field is required",
  });
export type UpdateDeviceRequest = z.infer<typeof UpdateDeviceRequestSchema>;

export interface BreakdownEntry {
  key: string;
  label: string;
  tokens: number;
  percent: number;
}

export interface BreakdownSet {
  models: BreakdownEntry[];
  efforts: BreakdownEntry[];
  purposes: BreakdownEntry[];
  surfaces: BreakdownEntry[];
}

export interface QuotaAllocation {
  deviceId: string | null;
  label: string;
  percentagePoints: number;
  confidence: AttributionConfidence;
}

export interface QuotaLimitSummary {
  key: string;
  limitId: string;
  limitName: string | null;
  kind: "primary" | "secondary";
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: string | null;
  observedAt: string;
  planType: string | null;
  source: "official";
}

export interface DeviceSummary {
  id: string;
  publicId: string;
  label: string;
  registered: boolean;
  privateIp: string | null;
  publicIp: string | null;
  macAddress: string | null;
  platform: string;
  agentVersion: string;
  lastSeenAt: string;
  status: "online" | "stale" | "offline";
  softBudgetPercent: number | null;
  tokenTotal: number;
  activeMs: number;
  estimatedQuotaPercent: number;
  attributionConfidence: AttributionConfidence;
  breakdowns: BreakdownSet;
}

export interface TimelinePoint {
  observedAt: string;
  usedPercent: number;
  source: "official";
}

export interface DashboardResponse {
  group: { id: string; name: string; slug: string };
  generatedAt: string;
  limits: QuotaLimitSummary[];
  focusLimitKey: string | null;
  allocations: QuotaAllocation[];
  devices: DeviceSummary[];
  overall: BreakdownSet;
  timeline: TimelinePoint[];
  accountUsage: AccountUsageObservation | null;
  dataQuality: {
    officialSnapshotFresh: boolean;
    localCoveragePercent: number;
    unattributedPercentagePoints: number;
    scannerMalformedRecords: number;
    note: string;
  };
}

export interface DeviceDetailResponse {
  device: DeviceSummary;
  hourly: Array<{
    hour: string;
    tokens: number;
    activeMs: number;
  }>;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
