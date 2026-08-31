import type { BreakdownEntry, DeviceDetailResponse } from "@quotalab/contracts";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { BrowserApiError, getDevice, updateDevice } from "../api";
import { formatDuration, formatRelative, formatTokens } from "../format";
import { CloseIcon } from "./Icons";
import { DonutPanel, type DonutDatum } from "./DonutPanel";

interface DeviceDrawerProps {
  deviceId: string | null;
  focusKey: string | null;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}

const toDonut = (entries: BreakdownEntry[], attributedPoints: number): DonutDatum[] =>
  entries.map((entry) => ({
    key: entry.key,
    label: entry.label,
    value: entry.tokens,
    displayValue: `${entry.percent.toFixed(1)}% tokens · ${((attributedPoints * entry.percent) / 100).toFixed(2)} pp 估算`,
    legendValue: `${((attributedPoints * entry.percent) / 100).toFixed(2)} pp`,
  }));

const confidenceLabel = {
  high: "高置信估算",
  medium: "中等置信估算",
  low: "低置信估算",
  unattributed: "未归因",
} as const;

export const DeviceDrawer = ({ deviceId, focusKey, onClose, onUpdated }: DeviceDrawerProps) => {
  const [detail, setDetail] = useState<DeviceDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");

  useEffect(() => {
    if (!deviceId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getDevice(deviceId, focusKey ?? undefined)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setName(next.device.registered ? next.device.label : "");
        setBudget(next.device.softBudgetPercent?.toString() ?? "");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "设备明细加载失败。 ");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, focusKey]);

  useEffect(() => {
    if (!deviceId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [deviceId, onClose]);

  const hourly = useMemo(
    () =>
      detail?.hourly.map((point) => ({
        ...point,
        label: new Date(point.hour).toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          hour12: false,
        }),
      })) ?? [],
    [detail],
  );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!deviceId) return;
    const parsedBudget = budget.trim() === "" ? null : Number(budget);
    if (
      parsedBudget !== null &&
      (!Number.isFinite(parsedBudget) || parsedBudget < 0 || parsedBudget > 100)
    ) {
      setError("软预算应是 0 到 100 之间的百分比。 ");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await updateDevice(deviceId, {
        name: name.trim() || null,
        softBudgetPercent: parsedBudget,
      });
      setDetail(next);
      await onUpdated();
    } catch (caught) {
      setError(caught instanceof BrowserApiError ? caught.message : "设备设置保存失败。 ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        className={deviceId ? "drawer-scrim is-open" : "drawer-scrim"}
        aria-label="关闭设备明细"
        onClick={onClose}
        tabIndex={deviceId ? 0 : -1}
        type="button"
      />
      <aside
        aria-hidden={!deviceId}
        aria-labelledby="drawer-title"
        className={deviceId ? "device-drawer is-open" : "device-drawer"}
        data-testid="device-drawer"
      >
        <div className="drawer-topbar">
          <span className="plate-index">DEVICE DETAIL / LOCAL</span>
          <button className="icon-button" onClick={onClose} type="button" aria-label="关闭设备明细">
            <CloseIcon />
          </button>
        </div>

        {loading ? <div className="drawer-loading">正在读取设备仪表…</div> : null}
        {error ? (
          <p className="drawer-error" role="alert">
            {error}
          </p>
        ) : null}

        {detail ? (
          <div className="drawer-content">
            <header className="drawer-device-heading">
              <div>
                <span className={`status-dot status-dot--${detail.device.status}`} />
                <span>
                  {detail.device.status === "online"
                    ? "在线"
                    : detail.device.status === "stale"
                      ? "采样延迟"
                      : "离线"}
                </span>
              </div>
              <h2 id="drawer-title">{detail.device.label}</h2>
              <p>
                {detail.device.platform} · Agent {detail.device.agentVersion} ·{" "}
                {formatRelative(detail.device.lastSeenAt)}
              </p>
              <p>
                {detail.device.privateIp ?? detail.device.publicIp ?? "IP 未知"} · 时间占比{" "}
                {detail.device.activeSharePercent.toFixed(1)}%
              </p>
            </header>

            <div className="drawer-kpis">
              <div>
                <span>本窗口估算消耗</span>
                <strong>
                  {detail.device.estimatedQuotaPercent.toFixed(2)}
                  <small> pp</small>
                </strong>
                <em>{confidenceLabel[detail.device.attributionConfidence]}</em>
              </div>
              <div>
                <span>本地记录 token</span>
                <strong>{formatTokens(detail.device.tokenTotal)}</strong>
                <em>{formatDuration(detail.device.activeMs)} 活跃</em>
              </div>
            </div>

            <section className="drawer-section">
              <div className="drawer-section-heading">
                <span className="plate-index">ACTIVITY / HOURLY</span>
                <h3>使用时间与强度</h3>
              </div>
              {hourly.length ? (
                <div className="device-timeline">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={hourly} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                      <CartesianGrid
                        vertical={false}
                        stroke="rgba(22,35,56,.08)"
                        strokeDasharray="3 5"
                      />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        minTickGap={28}
                        tick={{ fill: "#697586", fontSize: 9, fontFamily: "IBM Plex Mono" }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#697586", fontSize: 9, fontFamily: "IBM Plex Mono" }}
                        tickFormatter={(value: number) => formatTokens(value)}
                      />
                      <Tooltip
                        formatter={(value) => [`${formatTokens(Number(value))} tokens`, "本地活动"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="tokens"
                        stroke="#3157ff"
                        fill="#3157ff22"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="drawer-no-data">暂无逐小时活动。</p>
              )}
            </section>

            <div className="drawer-mixes" data-testid="device-breakdowns">
              <DonutPanel
                compact
                eyebrow="MODEL"
                title="模型"
                data={toDonut(detail.device.breakdowns.models, detail.device.estimatedQuotaPercent)}
                evidenceLabel="本地 + 估算"
              />
              <DonutPanel
                compact
                eyebrow="EFFORT"
                title="推理强度"
                data={toDonut(
                  detail.device.breakdowns.efforts,
                  detail.device.estimatedQuotaPercent,
                )}
                evidenceLabel="本地 + 估算"
              />
              <DonutPanel
                compact
                eyebrow="PURPOSE"
                title="用途"
                data={toDonut(
                  detail.device.breakdowns.purposes,
                  detail.device.estimatedQuotaPercent,
                )}
                evidenceLabel="本地 + 估算"
              />
            </div>

            <form className="device-settings" onSubmit={save}>
              <div className="drawer-section-heading">
                <span className="plate-index">CONTROL / SOFT LIMIT</span>
                <h3>设备标识与提醒线</h3>
              </div>
              <label className="field">
                <span>设备名称</span>
                <input
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="留空则显示 IP / MAC"
                />
              </label>
              <label className="field">
                <span>本窗口软预算（百分点）</span>
                <input
                  min="0"
                  max="100"
                  step="0.1"
                  type="number"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  placeholder="例如 20"
                />
                <small>这是提醒线。QuotaLab 不会强行中断 Codex 客户端。</small>
              </label>
              <button className="secondary-action" disabled={saving} type="submit">
                {saving ? "正在保存…" : "保存设备设置"}
              </button>
            </form>
          </div>
        ) : null}
      </aside>
    </>
  );
};
