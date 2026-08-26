import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type {
  PurposeBreakdown,
  ScannerHealth,
  Surface,
  TokenBreakdown,
  UsageSlice,
} from "@quotalab/contracts";

const READ_BLOCK_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const UNKNOWN_MODEL = "unknown";
const UNKNOWN_EFFORT = "unknown";

interface ActivityState {
  toolCalls: number;
  fileChanges: number;
  codeBytes: number;
  toolBytes: number;
  messageBytes: number;
}

export interface FileScannerState {
  offset: number;
  sessionKey: string;
  surface: Surface;
  model: string;
  reasoningEffort: string;
  currentTurnId: string | null;
  turnStartedAt: string | null;
  lastSampleAt: string | null;
  totals: TokenBreakdown | null;
  activity: ActivityState;
  discardingOversize: boolean;
  lastSeenAt: string;
  lastReadAt: string | null;
}

export interface ScannerState {
  version: 1;
  files: Record<string, FileScannerState>;
}

export interface ScanOptions {
  codexHome: string;
  previousState: ScannerState;
  now?: Date;
  lookbackDays?: number;
  maxBytes?: number;
}

export interface ScanResult {
  usageSlices: UsageSlice[];
  nextState: ScannerState;
  health: ScannerHealth;
}

interface CandidateFile {
  path: string;
  key: string;
  size: number;
  modifiedAt: number;
}

interface ReadResult {
  nextOffset: number;
  bytesRead: number;
  recordsRead: number;
  malformedRecords: number;
  discardingOversize: boolean;
}

const zeroActivity = (): ActivityState => ({
  toolCalls: 0,
  fileChanges: 0,
  codeBytes: 0,
  toolBytes: 0,
  messageBytes: 0,
});

const zeroTokens = (): TokenBreakdown => ({
  input: 0,
  cachedInput: 0,
  cacheWriteInput: 0,
  output: 0,
  reasoningOutput: 0,
  total: 0,
});

const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asText = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asNonNegativeInteger = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

const safeIsoTime = (value: unknown, fallback: Date): string => {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return fallback.toISOString();
};

const estimateBytes = (
  value: unknown,
  depth: number = 0,
  seen: Set<unknown> = new Set(),
): number => {
  if (depth > 12 || value === null || value === undefined) return 0;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + estimateBytes(item, depth + 1, seen), 0);
  }
  return Object.entries(value as Record<string, unknown>).reduce(
    (sum, [key, item]) =>
      sum + Buffer.byteLength(key, "utf8") + estimateBytes(item, depth + 1, seen),
    0,
  );
};

const isSubagentSource = (threadSource: unknown): boolean => {
  if (typeof threadSource === "string") return threadSource.toLowerCase().includes("subagent");
  const object = asObject(threadSource);
  return (
    object !== null && Object.keys(object).some((key) => key.toLowerCase().includes("subagent"))
  );
};

export const classifySurface = (
  source: unknown,
  originator: unknown,
  threadSource: unknown,
): Surface => {
  if (isSubagentSource(threadSource)) return "subagent";
  const sourceText = String(source ?? "").toLowerCase();
  const originText = String(originator ?? "").toLowerCase();
  if (
    sourceText.includes("cloud") ||
    sourceText.includes("remote") ||
    originText.includes("cloud")
  ) {
    return "cloud";
  }
  if (originText.includes("desktop") || sourceText.includes("desktop") || sourceText === "app") {
    return "desktop";
  }
  if (
    sourceText.includes("vscode") ||
    originText.includes("vscode") ||
    sourceText.includes("ide")
  ) {
    return "ide";
  }
  if (
    sourceText.includes("exec") ||
    sourceText.includes("cli") ||
    originText.includes("exec") ||
    originText.includes("cli") ||
    originText.includes("terminal")
  ) {
    return "cli";
  }
  return "unknown";
};

const normalizeTokens = (value: unknown): TokenBreakdown => {
  const object = asObject(value) ?? {};
  return {
    input: asNonNegativeInteger(object.input_tokens ?? object.inputTokens),
    cachedInput: asNonNegativeInteger(object.cached_input_tokens ?? object.cachedInputTokens),
    cacheWriteInput: asNonNegativeInteger(
      object.cache_write_input_tokens ?? object.cacheWriteInputTokens,
    ),
    output: asNonNegativeInteger(object.output_tokens ?? object.outputTokens),
    reasoningOutput: asNonNegativeInteger(
      object.reasoning_output_tokens ?? object.reasoningOutputTokens,
    ),
    total: asNonNegativeInteger(object.total_tokens ?? object.totalTokens),
  };
};

const subtractTokens = (
  current: TokenBreakdown,
  previous: TokenBreakdown | null,
  last: TokenBreakdown,
): TokenBreakdown => {
  if (!previous || current.total < previous.total) return last.total > 0 ? last : current;
  return {
    input: Math.max(0, current.input - previous.input),
    cachedInput: Math.max(0, current.cachedInput - previous.cachedInput),
    cacheWriteInput: Math.max(0, current.cacheWriteInput - previous.cacheWriteInput),
    output: Math.max(0, current.output - previous.output),
    reasoningOutput: Math.max(0, current.reasoningOutput - previous.reasoningOutput),
    total: Math.max(0, current.total - previous.total),
  };
};

const splitInteger = (
  total: number,
  weights: Array<{ key: "code" | "tools" | "conversation"; value: number }>,
): Pick<PurposeBreakdown, "code" | "tools" | "conversation"> => {
  const result = { code: 0, tools: 0, conversation: 0 };
  if (total <= 0) return result;
  const positive = weights.filter((weight) => weight.value > 0);
  if (positive.length === 0) {
    result.conversation = total;
    return result;
  }
  const denominator = positive.reduce((sum, weight) => sum + weight.value, 0);
  const ranked = positive
    .map((weight) => {
      const exact = (total * weight.value) / denominator;
      const floor = Math.floor(exact);
      result[weight.key] = floor;
      return { key: weight.key, fraction: exact - floor };
    })
    .sort((a, b) => b.fraction - a.fraction);
  let remainder = total - result.code - result.tools - result.conversation;
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    result[ranked[index % ranked.length]!.key] += 1;
  }
  return result;
};

const purposesFor = (tokens: TokenBreakdown, activity: ActivityState): PurposeBreakdown => {
  const total = tokens.total;
  const context = Math.min(total, tokens.input);
  const outputBudget = Math.max(0, total - context);
  const reasoning = Math.min(outputBudget, tokens.reasoningOutput);
  const visible = Math.max(0, outputBudget - reasoning);
  const visibleParts = splitInteger(visible, [
    { key: "code", value: activity.codeBytes },
    { key: "tools", value: activity.toolBytes },
    { key: "conversation", value: activity.messageBytes },
  ]);
  return { context, reasoning, ...visibleParts };
};

const deltaHasTokens = (tokens: TokenBreakdown): boolean =>
  tokens.total > 0 || tokens.input > 0 || tokens.output > 0 || tokens.reasoningOutput > 0;

const validEndAfterStart = (start: string, end: string): { start: string; end: string } =>
  Date.parse(end) >= Date.parse(start) ? { start, end } : { start: end, end };

const tokenSlice = (
  state: FileScannerState,
  tokens: TokenBreakdown,
  timestamp: string,
  byteOffset: number,
): UsageSlice => {
  const times = validEndAfterStart(
    state.lastSampleAt ?? state.turnStartedAt ?? timestamp,
    timestamp,
  );
  return {
    sampleId: hash(
      `${state.sessionKey}:${state.currentTurnId ?? "turn"}:${byteOffset}:${tokens.total}:${tokens.output}`,
    ),
    sessionKey: state.sessionKey,
    startedAt: times.start,
    endedAt: times.end,
    surface: state.surface,
    model: state.model || UNKNOWN_MODEL,
    reasoningEffort: state.reasoningEffort || UNKNOWN_EFFORT,
    tokens,
    purposes: purposesFor(tokens, state.activity),
    activity: {
      toolCalls: state.activity.toolCalls,
      fileChanges: state.activity.fileChanges,
      activeMs: 0,
    },
    measurement: "local",
    purposeMethod: "event-envelope-v1",
  };
};

const durationSlice = (
  state: FileScannerState,
  timestamp: string,
  durationMs: number,
): UsageSlice => {
  const start = state.turnStartedAt ?? new Date(Date.parse(timestamp) - durationMs).toISOString();
  return {
    sampleId: hash(
      `${state.sessionKey}:${state.currentTurnId ?? "turn"}:duration:${durationMs}:${timestamp}`,
    ),
    sessionKey: state.sessionKey,
    startedAt: validEndAfterStart(start, timestamp).start,
    endedAt: timestamp,
    surface: state.surface,
    model: state.model || UNKNOWN_MODEL,
    reasoningEffort: state.reasoningEffort || UNKNOWN_EFFORT,
    tokens: zeroTokens(),
    purposes: { context: 0, reasoning: 0, code: 0, tools: 0, conversation: 0 },
    activity: { toolCalls: 0, fileChanges: 0, activeMs: durationMs },
    measurement: "local",
    purposeMethod: "event-envelope-v1",
  };
};

const processRecord = (
  parsed: unknown,
  byteOffset: number,
  state: FileScannerState,
  slices: UsageSlice[],
  lastSliceByTurn: Map<string, number>,
  now: Date,
): void => {
  const record = asObject(parsed);
  if (!record) return;
  const outerType = asText(record.type) ?? "";
  const payload = asObject(record.payload) ?? {};
  const innerType = asText(payload.type) ?? "";
  const timestamp = safeIsoTime(record.timestamp ?? payload.timestamp, now);

  if (outerType === "session_meta") {
    const rawSessionId = asText(payload.session_id ?? payload.id);
    if (rawSessionId) state.sessionKey = hash(rawSessionId);
    state.surface = classifySurface(payload.source, payload.originator, payload.thread_source);
    return;
  }

  if (outerType === "turn_context") {
    state.currentTurnId = asText(payload.turn_id) ?? state.currentTurnId;
    state.model = asText(payload.model) ?? state.model;
    state.reasoningEffort =
      asText(payload.effort ?? payload.reasoning_effort) ?? state.reasoningEffort;
    return;
  }

  if (outerType === "event_msg" && innerType === "task_started") {
    state.currentTurnId = asText(payload.turn_id) ?? state.currentTurnId;
    state.turnStartedAt = safeIsoTime(payload.started_at, new Date(timestamp));
    state.lastSampleAt = state.turnStartedAt;
    state.activity = zeroActivity();
    return;
  }

  if (
    outerType === "response_item" &&
    ["function_call", "custom_tool_call", "mcp_tool_call", "dynamic_tool_call"].includes(innerType)
  ) {
    const name = (asText(payload.name ?? payload.tool) ?? "").toLowerCase();
    const bytes = estimateBytes(payload.arguments ?? payload.input);
    state.activity.toolCalls += 1;
    if (/apply[_-]?patch|write[_-]?file|create[_-]?file|file[_-]?change/.test(name)) {
      state.activity.fileChanges += 1;
      state.activity.codeBytes += Math.max(1, bytes);
    } else {
      state.activity.toolBytes += Math.max(1, bytes);
    }
    return;
  }

  if (outerType === "response_item" && innerType === "message") {
    if (asText(payload.role) === "assistant") {
      state.activity.messageBytes += Math.max(1, estimateBytes(payload.content));
    }
    return;
  }

  if (
    (outerType === "event_msg" && innerType === "patch_apply_end") ||
    (outerType === "response_item" && ["file_change", "fileChange"].includes(innerType))
  ) {
    state.activity.fileChanges += 1;
    state.activity.codeBytes += Math.max(1, estimateBytes(payload.changes));
    return;
  }

  if (outerType === "event_msg" && innerType === "token_count") {
    const info = asObject(payload.info) ?? {};
    const totals = normalizeTokens(info.total_token_usage ?? info.totalTokenUsage);
    const last = normalizeTokens(info.last_token_usage ?? info.lastTokenUsage);
    const delta = subtractTokens(totals, state.totals, last);
    state.totals = totals;
    if (deltaHasTokens(delta)) {
      const slice = tokenSlice(state, delta, timestamp, byteOffset);
      const index = slices.push(slice) - 1;
      if (state.currentTurnId) lastSliceByTurn.set(state.currentTurnId, index);
      state.lastSampleAt = timestamp;
    }
    state.activity = zeroActivity();
    return;
  }

  if (outerType === "event_msg" && innerType === "task_complete") {
    const end = safeIsoTime(payload.completed_at, new Date(timestamp));
    const durationMs = asNonNegativeInteger(payload.duration_ms);
    const turnId = asText(payload.turn_id) ?? state.currentTurnId;
    const priorIndex = turnId ? lastSliceByTurn.get(turnId) : undefined;
    if (priorIndex !== undefined && slices[priorIndex]) {
      slices[priorIndex].activity.activeMs += durationMs;
      slices[priorIndex].endedAt = end;
    } else if (durationMs > 0) {
      slices.push(durationSlice(state, end, durationMs));
    }
    state.turnStartedAt = null;
    state.lastSampleAt = end;
  }
};

const walkJsonl = async (
  root: string,
  baseRoot: string,
  prefix: string,
  output: CandidateFile[],
): Promise<void> => {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return walkJsonl(path, baseRoot, prefix, output);
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
      const metadata = await stat(path);
      output.push({
        path,
        key: hash(`${prefix}:${relative(baseRoot, path).replaceAll("\\", "/")}`),
        size: metadata.size,
        modifiedAt: metadata.mtimeMs,
      });
    }),
  );
};

const candidateFiles = async (codexHome: string): Promise<CandidateFile[]> => {
  const output: CandidateFile[] = [];
  const sessionsRoot = join(codexHome, "sessions");
  const archivedRoot = join(codexHome, "archived_sessions");
  await walkJsonl(sessionsRoot, sessionsRoot, "active", output);
  await walkJsonl(archivedRoot, archivedRoot, "archived", output);
  return output;
};

const readRecords = async (
  candidate: CandidateFile,
  startOffset: number,
  budget: number,
  discardingOversize: boolean,
  onRecord: (record: unknown, byteOffset: number) => void,
): Promise<ReadResult> => {
  const file = await open(candidate.path, "r");
  let position = startOffset;
  let committedOffset = startOffset;
  let lineStartOffset = startOffset;
  let bytesRead = 0;
  let recordsRead = 0;
  let malformedRecords = 0;
  let discarding = discardingOversize;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  try {
    while (position < candidate.size) {
      const softLimit = pendingBytes > 0 && !discarding ? budget + MAX_RECORD_BYTES : budget;
      if (bytesRead >= softLimit) break;
      const length = Math.min(READ_BLOCK_BYTES, candidate.size - position, softLimit - bytesRead);
      if (length <= 0) break;
      const buffer = Buffer.allocUnsafe(length);
      const read = await file.read(buffer, 0, length, position);
      if (read.bytesRead <= 0) break;
      const chunk = buffer.subarray(0, read.bytesRead);
      const chunkStart = position;
      position += read.bytesRead;
      bytesRead += read.bytesRead;

      let segmentStart = 0;
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== 0x0a) continue;
        const segment = chunk.subarray(segmentStart, index);
        if (!discarding) {
          pending.push(segment);
          pendingBytes += segment.length;
          if (pendingBytes <= MAX_RECORD_BYTES) {
            let line = Buffer.concat(pending, pendingBytes);
            if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
            if (line.length > 0) {
              try {
                onRecord(JSON.parse(line.toString("utf8")) as unknown, lineStartOffset);
                recordsRead += 1;
              } catch {
                malformedRecords += 1;
              }
            }
          } else {
            malformedRecords += 1;
          }
        }
        discarding = false;
        pending = [];
        pendingBytes = 0;
        committedOffset = chunkStart + index + 1;
        lineStartOffset = committedOffset;
        segmentStart = index + 1;
      }

      const tail = chunk.subarray(segmentStart);
      if (discarding) {
        committedOffset = position;
      } else if (tail.length > 0) {
        pending.push(tail);
        pendingBytes += tail.length;
        if (pendingBytes > MAX_RECORD_BYTES) {
          malformedRecords += 1;
          pending = [];
          pendingBytes = 0;
          discarding = true;
          committedOffset = position;
        }
      }
    }
  } finally {
    await file.close();
  }

  return {
    nextOffset: discarding ? position : committedOffset,
    bytesRead,
    recordsRead,
    malformedRecords,
    discardingOversize: discarding,
  };
};

const newFileState = (key: string, now: Date): FileScannerState => ({
  offset: 0,
  sessionKey: hash(`file:${key}`),
  surface: "unknown",
  model: UNKNOWN_MODEL,
  reasoningEffort: UNKNOWN_EFFORT,
  currentTurnId: null,
  turnStartedAt: null,
  lastSampleAt: null,
  totals: null,
  activity: zeroActivity(),
  discardingOversize: false,
  lastSeenAt: now.toISOString(),
  lastReadAt: null,
});

const cloneState = (state: ScannerState): ScannerState =>
  JSON.parse(JSON.stringify(state)) as ScannerState;

export const scanCodexSessions = async (options: ScanOptions): Promise<ScanResult> => {
  const now = options.now ?? new Date();
  const lookbackDays = options.lookbackDays ?? 8;
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1_000;
  const state = cloneState(options.previousState);
  const files = await candidateFiles(options.codexHome);
  const eligible = files
    .filter((file) => file.modifiedAt >= cutoff || state.files[file.key] !== undefined)
    .sort((a, b) => {
      const aRead = state.files[a.key]?.lastReadAt ?? "";
      const bRead = state.files[b.key]?.lastReadAt ?? "";
      if (aRead !== bRead) return aRead.localeCompare(bRead);
      return b.modifiedAt - a.modifiedAt;
    });

  const usageSlices: UsageSlice[] = [];
  const health: ScannerHealth = {
    filesSeen: eligible.length,
    filesUpdated: 0,
    bytesRead: 0,
    recordsRead: 0,
    malformedRecords: 0,
    truncatedFiles: 0,
    backlogBytes: 0,
  };
  let remaining = maxBytes;

  for (const candidate of eligible) {
    const fileState = state.files[candidate.key] ?? newFileState(candidate.key, now);
    fileState.lastSeenAt = now.toISOString();
    if (candidate.size < fileState.offset) {
      fileState.offset = 0;
      fileState.totals = null;
      fileState.discardingOversize = false;
      health.truncatedFiles += 1;
    }
    state.files[candidate.key] = fileState;
    if (candidate.size <= fileState.offset || remaining <= 0) continue;

    const lastSliceByTurn = new Map<string, number>();
    const result = await readRecords(
      candidate,
      fileState.offset,
      remaining,
      fileState.discardingOversize,
      (record, byteOffset) =>
        processRecord(record, byteOffset, fileState, usageSlices, lastSliceByTurn, now),
    );
    fileState.offset = result.nextOffset;
    fileState.discardingOversize = result.discardingOversize;
    fileState.lastReadAt = now.toISOString();
    health.bytesRead += result.bytesRead;
    health.recordsRead += result.recordsRead;
    health.malformedRecords += result.malformedRecords;
    if (result.bytesRead > 0) health.filesUpdated += 1;
    remaining = Math.max(0, remaining - result.bytesRead);
  }

  const fileByKey = new Map(files.map((file) => [file.key, file]));
  for (const [key, fileState] of Object.entries(state.files)) {
    const file = fileByKey.get(key);
    if (file) health.backlogBytes += Math.max(0, file.size - fileState.offset);
    else if (Date.parse(fileState.lastSeenAt) < cutoff) delete state.files[key];
  }

  return { usageSlices, nextState: state, health };
};
