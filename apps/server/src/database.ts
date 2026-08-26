import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;

const migrationV1 = `
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE browser_sessions (
  token_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX browser_sessions_expiry_idx ON browser_sessions(expires_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  public_id TEXT NOT NULL,
  name TEXT,
  private_ip TEXT,
  public_ip TEXT,
  mac_address TEXT,
  platform TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  soft_budget_percent REAL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(group_id, public_id)
);
CREATE INDEX devices_group_idx ON devices(group_id, last_seen_at DESC);

CREATE TABLE device_tokens (
  token_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX device_tokens_device_idx ON device_tokens(device_id);

CREATE TABLE ingestion_batches (
  batch_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(batch_id, device_id)
);

CREATE TABLE quota_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  observed_at INTEGER NOT NULL,
  limit_id TEXT NOT NULL,
  limit_name TEXT,
  plan_type TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('primary', 'secondary')),
  used_percent REAL NOT NULL CHECK(used_percent >= 0 AND used_percent <= 100),
  window_duration_mins INTEGER,
  resets_at INTEGER,
  UNIQUE(device_id, observed_at, limit_id, kind)
);
CREATE INDEX quota_snapshots_group_window_idx
  ON quota_snapshots(group_id, limit_id, kind, observed_at);

CREATE TABLE account_usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  observed_at INTEGER NOT NULL,
  lifetime_tokens INTEGER,
  peak_daily_tokens INTEGER,
  longest_running_turn_sec INTEGER,
  current_streak_days INTEGER,
  longest_streak_days INTEGER,
  daily_usage_json TEXT,
  UNIQUE(device_id, observed_at)
);
CREATE INDEX account_usage_group_idx ON account_usage_snapshots(group_id, observed_at DESC);

CREATE TABLE usage_samples (
  sample_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  surface TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  cached_input_tokens INTEGER NOT NULL,
  cache_write_input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  purpose_context INTEGER NOT NULL,
  purpose_reasoning INTEGER NOT NULL,
  purpose_code INTEGER NOT NULL,
  purpose_tools INTEGER NOT NULL,
  purpose_conversation INTEGER NOT NULL,
  tool_calls INTEGER NOT NULL,
  file_changes INTEGER NOT NULL,
  active_ms INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(device_id, sample_id)
);
CREATE INDEX usage_samples_group_time_idx ON usage_samples(group_id, ended_at);
CREATE INDEX usage_samples_device_time_idx ON usage_samples(device_id, ended_at);

CREATE TABLE scanner_reports (
  batch_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  observed_at INTEGER NOT NULL,
  app_server_status TEXT NOT NULL,
  app_server_error_code TEXT,
  files_seen INTEGER NOT NULL,
  files_updated INTEGER NOT NULL,
  bytes_read INTEGER NOT NULL,
  records_read INTEGER NOT NULL,
  malformed_records INTEGER NOT NULL,
  truncated_files INTEGER NOT NULL,
  backlog_bytes INTEGER NOT NULL,
  PRIMARY KEY(batch_id, device_id)
);
CREATE INDEX scanner_reports_device_time_idx ON scanner_reports(device_id, observed_at DESC);
`;

export const openDatabase = (path: string): DatabaseSync => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL");

  const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (version > SCHEMA_VERSION) {
    database.close();
    throw new Error(`Database schema ${version} is newer than supported ${SCHEMA_VERSION}`);
  }
  if (version === 0) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migrationV1);
      database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      database.close();
      throw error;
    }
  }
  return database;
};

export const inTransaction = <T>(database: DatabaseSync, operation: () => T): T => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};
