import type {
  AccountUsageObservation,
  AgentIngestRequest,
  EnrollDeviceRequest,
  UpdateDeviceRequest,
} from "@quotalab/contracts";
import type { DatabaseSync } from "node:sqlite";

import { inTransaction } from "./database.js";
import { ApiError } from "./errors.js";
import {
  createOpaqueToken,
  createSlug,
  hashGroupKey,
  hashOpaqueToken,
  randomId,
  verifyGroupKey,
} from "./security.js";
import type {
  AccountUsageRow,
  DeviceRow,
  GroupRow,
  QuotaSnapshotRow,
  UsageSampleRow,
} from "./storage-types.js";

const asRow = <T>(value: unknown): T | undefined => value as T | undefined;
const asRows = <T>(value: unknown[]): T[] => value as T[];

export interface EnrolledDevice {
  group: Pick<GroupRow, "id" | "name" | "slug">;
  device: DeviceRow;
  token: string;
}

export interface AuthenticatedDevice {
  group: Pick<GroupRow, "id" | "name" | "slug">;
  device: DeviceRow;
}

export class Repository {
  readonly #dummyHash: Promise<string>;

  constructor(
    readonly database: DatabaseSync,
    private readonly scryptCost: number,
  ) {
    this.#dummyHash = hashGroupKey("quotalab-invalid-group-key-timing-pad", scryptCost);
  }

  close(): void {
    this.database.close();
  }

  async createGroup(name: string, key: string, now: number): Promise<GroupRow> {
    const keyHash = await hashGroupKey(key, this.scryptCost);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const row: GroupRow = {
        id: randomId(),
        slug: createSlug(name),
        name,
        key_hash: keyHash,
        created_at: now,
      };
      try {
        this.database
          .prepare(
            "INSERT INTO groups(id, slug, name, key_hash, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(row.id, row.slug, row.name, row.key_hash, row.created_at);
        return row;
      } catch (error) {
        if (!String(error).includes("UNIQUE constraint failed: groups.slug")) throw error;
      }
    }
    throw new ApiError(503, "SLUG_EXHAUSTED", "暂时无法生成群组标识，请重试。 ");
  }

  getGroupById(groupId: string): GroupRow | undefined {
    return asRow<GroupRow>(this.database.prepare("SELECT * FROM groups WHERE id = ?").get(groupId));
  }

  async authenticateGroup(slug: string, key: string): Promise<GroupRow | undefined> {
    const group = asRow<GroupRow>(
      this.database.prepare("SELECT * FROM groups WHERE slug = ?").get(slug),
    );
    const encoded = group?.key_hash ?? (await this.#dummyHash);
    const valid = await verifyGroupKey(key, encoded);
    return valid ? group : undefined;
  }

  createBrowserSession(groupId: string, now: number, ttlMs: number): string {
    this.database.prepare("DELETE FROM browser_sessions WHERE expires_at <= ?").run(now);
    const token = createOpaqueToken();
    this.database
      .prepare(
        "INSERT INTO browser_sessions(token_hash, group_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(hashOpaqueToken(token), groupId, now, now + ttlMs);
    return token;
  }

  resolveBrowserSession(token: string, now: number): GroupRow | undefined {
    return asRow<GroupRow>(
      this.database
        .prepare(
          `SELECT g.* FROM browser_sessions s
           JOIN groups g ON g.id = s.group_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(hashOpaqueToken(token), now),
    );
  }

  deleteBrowserSession(token: string): void {
    this.database
      .prepare("DELETE FROM browser_sessions WHERE token_hash = ?")
      .run(hashOpaqueToken(token));
  }

  async enrollDevice(
    request: EnrollDeviceRequest,
    publicIp: string | null,
    now: number,
  ): Promise<EnrolledDevice | undefined> {
    const group = await this.authenticateGroup(request.groupSlug, request.groupKey);
    if (!group) return undefined;

    return inTransaction(this.database, () => {
      const existing = asRow<DeviceRow>(
        this.database
          .prepare("SELECT * FROM devices WHERE group_id = ? AND public_id = ?")
          .get(group.id, request.devicePublicId),
      );
      const name = request.deviceName ?? existing?.name ?? null;
      const macAddress = name
        ? null
        : (request.network.macAddress ?? existing?.mac_address ?? null);
      const deviceId = existing?.id ?? randomId();

      if (existing) {
        this.database
          .prepare(
            `UPDATE devices SET name = ?, private_ip = ?, public_ip = ?, mac_address = ?,
              platform = ?, agent_version = ?, last_seen_at = ? WHERE id = ?`,
          )
          .run(
            name,
            request.network.privateIp,
            publicIp,
            macAddress,
            request.platform,
            request.agentVersion,
            now,
            deviceId,
          );
        this.database
          .prepare(
            "UPDATE device_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL",
          )
          .run(now, deviceId);
      } else {
        this.database
          .prepare(
            `INSERT INTO devices(
              id, group_id, public_id, name, private_ip, public_ip, mac_address,
              platform, agent_version, soft_budget_percent, created_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(
            deviceId,
            group.id,
            request.devicePublicId,
            name,
            request.network.privateIp,
            publicIp,
            macAddress,
            request.platform,
            request.agentVersion,
            now,
            now,
          );
      }

      const token = createOpaqueToken();
      this.database
        .prepare("INSERT INTO device_tokens(token_hash, device_id, created_at) VALUES (?, ?, ?)")
        .run(hashOpaqueToken(token), deviceId, now);
      const device = asRow<DeviceRow>(
        this.database.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId),
      )!;
      return {
        group: { id: group.id, name: group.name, slug: group.slug },
        device,
        token,
      };
    });
  }

  authenticateDevice(token: string): AuthenticatedDevice | undefined {
    const row = asRow<DeviceRow & { group_name: string; group_slug: string }>(
      this.database
        .prepare(
          `SELECT d.*, g.name AS group_name, g.slug AS group_slug
           FROM device_tokens t
           JOIN devices d ON d.id = t.device_id
           JOIN groups g ON g.id = d.group_id
           WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
        )
        .get(hashOpaqueToken(token)),
    );
    if (!row) return undefined;
    return {
      group: { id: row.group_id, name: row.group_name, slug: row.group_slug },
      device: row,
    };
  }

  ingest(
    auth: AuthenticatedDevice,
    request: AgentIngestRequest,
    publicIp: string | null,
    receivedAt: number,
  ): { duplicate: boolean; acceptedSamples: number } {
    const observedAt = Date.parse(request.observedAt);
    return inTransaction(this.database, () => {
      this.database
        .prepare(
          `UPDATE devices SET private_ip = ?, public_ip = ?,
            mac_address = CASE WHEN name IS NULL AND ? IS NOT NULL THEN ? ELSE mac_address END,
            platform = ?, agent_version = ?, last_seen_at = ? WHERE id = ?`,
        )
        .run(
          request.network.privateIp,
          publicIp,
          request.network.macAddress,
          request.network.macAddress,
          request.platform,
          request.agentVersion,
          receivedAt,
          auth.device.id,
        );

      const batch = this.database
        .prepare(
          "INSERT OR IGNORE INTO ingestion_batches(batch_id, device_id, received_at) VALUES (?, ?, ?)",
        )
        .run(request.batchId, auth.device.id, receivedAt);
      if (batch.changes === 0) return { duplicate: true, acceptedSamples: 0 };

      const insertQuota = this.database.prepare(
        `INSERT OR IGNORE INTO quota_snapshots(
          group_id, device_id, observed_at, limit_id, limit_name, plan_type, kind,
          used_percent, window_duration_mins, resets_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const bucket of request.quotaBuckets) {
        for (const window of bucket.windows) {
          insertQuota.run(
            auth.group.id,
            auth.device.id,
            observedAt,
            bucket.limitId,
            bucket.limitName ?? null,
            bucket.planType ?? null,
            window.kind,
            window.usedPercent,
            window.windowDurationMins,
            window.resetsAt === null ? null : window.resetsAt * 1_000,
          );
        }
      }

      if (request.accountUsage) {
        this.database
          .prepare(
            `INSERT OR IGNORE INTO account_usage_snapshots(
              group_id, device_id, observed_at, lifetime_tokens, peak_daily_tokens,
              longest_running_turn_sec, current_streak_days, longest_streak_days, daily_usage_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            auth.group.id,
            auth.device.id,
            observedAt,
            request.accountUsage.lifetimeTokens,
            request.accountUsage.peakDailyTokens,
            request.accountUsage.longestRunningTurnSec,
            request.accountUsage.currentStreakDays,
            request.accountUsage.longestStreakDays,
            request.accountUsage.dailyUsageBuckets === null
              ? null
              : JSON.stringify(request.accountUsage.dailyUsageBuckets),
          );
      }

      const insertSample = this.database.prepare(
        `INSERT OR IGNORE INTO usage_samples(
          sample_id, group_id, device_id, session_key, started_at, ended_at,
          surface, model, reasoning_effort, input_tokens, cached_input_tokens,
          cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
          purpose_context, purpose_reasoning, purpose_code, purpose_tools, purpose_conversation,
          tool_calls, file_changes, active_ms, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let acceptedSamples = 0;
      for (const sample of request.usageSlices) {
        const result = insertSample.run(
          sample.sampleId,
          auth.group.id,
          auth.device.id,
          sample.sessionKey,
          Date.parse(sample.startedAt),
          Date.parse(sample.endedAt),
          sample.surface,
          sample.model,
          sample.reasoningEffort,
          sample.tokens.input,
          sample.tokens.cachedInput,
          sample.tokens.cacheWriteInput,
          sample.tokens.output,
          sample.tokens.reasoningOutput,
          sample.tokens.total,
          sample.purposes.context,
          sample.purposes.reasoning,
          sample.purposes.code,
          sample.purposes.tools,
          sample.purposes.conversation,
          sample.activity.toolCalls,
          sample.activity.fileChanges,
          sample.activity.activeMs,
          receivedAt,
        );
        acceptedSamples += Number(result.changes);
      }

      this.database
        .prepare(
          `INSERT INTO scanner_reports(
            batch_id, device_id, observed_at, app_server_status, app_server_error_code,
            files_seen, files_updated, bytes_read, records_read, malformed_records,
            truncated_files, backlog_bytes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.batchId,
          auth.device.id,
          observedAt,
          request.collector.appServer,
          request.collector.errorCode,
          request.scanner.filesSeen,
          request.scanner.filesUpdated,
          request.scanner.bytesRead,
          request.scanner.recordsRead,
          request.scanner.malformedRecords,
          request.scanner.truncatedFiles,
          request.scanner.backlogBytes,
        );

      return { duplicate: false, acceptedSamples };
    });
  }

  listDevices(groupId: string): DeviceRow[] {
    return asRows<DeviceRow>(
      this.database
        .prepare("SELECT * FROM devices WHERE group_id = ? ORDER BY last_seen_at DESC")
        .all(groupId),
    );
  }

  listQuotaSnapshots(groupId: string, since: number): QuotaSnapshotRow[] {
    return asRows<QuotaSnapshotRow>(
      this.database
        .prepare(
          `SELECT device_id, observed_at, limit_id, limit_name, plan_type, kind,
             used_percent, window_duration_mins, resets_at
           FROM quota_snapshots WHERE group_id = ? AND observed_at >= ?
           ORDER BY observed_at ASC, id ASC`,
        )
        .all(groupId, since),
    );
  }

  listUsageSamples(groupId: string, since: number): UsageSampleRow[] {
    return asRows<UsageSampleRow>(
      this.database
        .prepare(
          `SELECT device_id, started_at, ended_at, surface, model, reasoning_effort,
             total_tokens, active_ms, purpose_context, purpose_reasoning,
             purpose_code, purpose_tools, purpose_conversation
           FROM usage_samples WHERE group_id = ? AND ended_at >= ?
           ORDER BY ended_at ASC`,
        )
        .all(groupId, since),
    );
  }

  getLatestAccountUsage(groupId: string): AccountUsageObservation | null {
    const row = asRow<AccountUsageRow>(
      this.database
        .prepare(
          `SELECT observed_at, lifetime_tokens, peak_daily_tokens, longest_running_turn_sec,
             current_streak_days, longest_streak_days, daily_usage_json
           FROM account_usage_snapshots WHERE group_id = ? ORDER BY observed_at DESC LIMIT 1`,
        )
        .get(groupId),
    );
    if (!row) return null;
    return {
      lifetimeTokens: row.lifetime_tokens,
      peakDailyTokens: row.peak_daily_tokens,
      longestRunningTurnSec: row.longest_running_turn_sec,
      currentStreakDays: row.current_streak_days,
      longestStreakDays: row.longest_streak_days,
      dailyUsageBuckets:
        row.daily_usage_json === null
          ? null
          : (JSON.parse(row.daily_usage_json) as AccountUsageObservation["dailyUsageBuckets"]),
    };
  }

  scannerMalformedSince(groupId: string, since: number): number {
    const row = this.database
      .prepare(
        `SELECT COALESCE(SUM(r.malformed_records), 0) AS total
         FROM scanner_reports r JOIN devices d ON d.id = r.device_id
         WHERE d.group_id = ? AND r.observed_at >= ?`,
      )
      .get(groupId, since) as { total: number } | undefined;
    return Number(row?.total ?? 0);
  }

  updateDevice(groupId: string, deviceId: string, request: UpdateDeviceRequest): DeviceRow {
    const current = asRow<DeviceRow>(
      this.database
        .prepare("SELECT * FROM devices WHERE id = ? AND group_id = ?")
        .get(deviceId, groupId),
    );
    if (!current) throw new ApiError(404, "DEVICE_NOT_FOUND", "没有找到这台设备。 ");
    const name = request.name === undefined ? current.name : request.name;
    const budget =
      request.softBudgetPercent === undefined
        ? current.soft_budget_percent
        : request.softBudgetPercent;
    this.database
      .prepare(
        `UPDATE devices SET name = ?, soft_budget_percent = ?,
           mac_address = CASE WHEN ? IS NOT NULL THEN NULL ELSE mac_address END
         WHERE id = ? AND group_id = ?`,
      )
      .run(name, budget, name, deviceId, groupId);
    return asRow<DeviceRow>(
      this.database.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId),
    )!;
  }

  getDevice(groupId: string, deviceId: string): DeviceRow | undefined {
    return asRow<DeviceRow>(
      this.database
        .prepare("SELECT * FROM devices WHERE id = ? AND group_id = ?")
        .get(deviceId, groupId),
    );
  }
}
