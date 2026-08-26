export interface GroupRow {
  id: string;
  slug: string;
  name: string;
  key_hash: string;
  created_at: number;
}

export interface DeviceRow {
  id: string;
  group_id: string;
  public_id: string;
  name: string | null;
  private_ip: string | null;
  public_ip: string | null;
  mac_address: string | null;
  platform: string;
  agent_version: string;
  soft_budget_percent: number | null;
  created_at: number;
  last_seen_at: number;
}

export interface QuotaSnapshotRow {
  device_id: string;
  observed_at: number;
  limit_id: string;
  limit_name: string | null;
  plan_type: string | null;
  kind: "primary" | "secondary";
  used_percent: number;
  window_duration_mins: number | null;
  resets_at: number | null;
}

export interface UsageSampleRow {
  device_id: string;
  started_at: number;
  ended_at: number;
  surface: string;
  model: string;
  reasoning_effort: string;
  total_tokens: number;
  active_ms: number;
  purpose_context: number;
  purpose_reasoning: number;
  purpose_code: number;
  purpose_tools: number;
  purpose_conversation: number;
}

export interface AccountUsageRow {
  observed_at: number;
  lifetime_tokens: number | null;
  peak_daily_tokens: number | null;
  longest_running_turn_sec: number | null;
  current_streak_days: number | null;
  longest_streak_days: number | null;
  daily_usage_json: string | null;
}
