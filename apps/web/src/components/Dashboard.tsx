import type { BreakdownEntry, DashboardResponse } from "@quotalab/contracts";
import { useMemo, useState } from "react";

import { formatDuration, formatTokens } from "../format";
import { quotaAllocationColor } from "../quota-allocation";
import { DeviceDrawer } from "./DeviceDrawer";
import { DeviceRail } from "./DeviceRail";
import { DonutPanel, type DonutDatum } from "./DonutPanel";
import { DownloadIcon, LogOutIcon, RefreshIcon } from "./Icons";
import { QualityPlate } from "./QualityPlate";
import { QuotaHorizon } from "./QuotaHorizon";
import { UsageTimeline } from "./UsageTimeline";

interface DashboardProps {
  data: DashboardResponse;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onFocusLimit: (key: string) => Promise<void>;
  onLogout: () => Promise<void>;
}

const toDonut = (entries: BreakdownEntry[], attributedPoints?: number): DonutDatum[] =>
  entries.map((entry) => ({
    key: entry.key,
    label: entry.label,
    value: entry.tokens,
    displayValue:
      attributedPoints === undefined
        ? `${entry.percent.toFixed(1)}% tokens`
        : `${entry.percent.toFixed(1)}% tokens · ${((attributedPoints * entry.percent) / 100).toFixed(2)} pp 估算`,
    legendValue:
      attributedPoints === undefined
        ? `${entry.percent.toFixed(1)}%`
        : `${((attributedPoints * entry.percent) / 100).toFixed(2)} pp`,
  }));

export const Dashboard = ({
  data,
  refreshing,
  onRefresh,
  onFocusLimit,
  onLogout,
}: DashboardProps) => {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const focus = data.limits.find((limit) => limit.key === data.focusLimitKey);
  const attributedPoints = data.allocations
    .filter((allocation) => allocation.deviceId !== null)
    .reduce((sum, allocation) => sum + allocation.percentagePoints, 0);

  const deviceShare = useMemo<DonutDatum[]>(
    () =>
      data.allocations.map((allocation, index) => ({
        key: allocation.deviceId ?? "unattributed",
        label: allocation.label,
        value: allocation.percentagePoints,
        displayValue: `${allocation.percentagePoints.toFixed(2)} pp`,
        legendValue: `${allocation.percentagePoints.toFixed(2)} pp`,
        color: quotaAllocationColor(allocation, index),
      })),
    [data.allocations],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>QuotaLab</span>
          <em>BETA</em>
        </div>
        <div className="group-identity">
          <span>当前群组</span>
          <strong>{data.group.name}</strong>
          <code>{data.group.slug}</code>
        </div>
        <div className="topbar-actions">
          <button
            className="button-with-icon"
            disabled={refreshing}
            onClick={() => void onRefresh()}
            type="button"
          >
            <RefreshIcon className={refreshing ? "is-spinning" : ""} />
            <span>{refreshing ? "同步中" : "立即同步"}</span>
          </button>
          <a
            className="button-with-icon"
            href={`/api/export.csv${data.focusLimitKey ? `?limitKey=${encodeURIComponent(data.focusLimitKey)}` : ""}`}
            download
          >
            <DownloadIcon />
            <span>导出 CSV</span>
          </a>
          <button
            className="icon-button"
            onClick={() => void onLogout()}
            type="button"
            aria-label="退出群组"
          >
            <LogOutIcon />
          </button>
        </div>
      </header>

      <main className="workbench">
        <div className="hero-grid">
          <DeviceRail
            devices={data.devices}
            selectedId={selectedDeviceId}
            onSelect={setSelectedDeviceId}
          />
          <QuotaHorizon
            limits={data.limits}
            focusKey={data.focusLimitKey}
            allocations={data.allocations}
            onFocus={(key) => void onFocusLimit(key)}
          />
          <QualityPlate quality={data.dataQuality} focus={focus} generatedAt={data.generatedAt} />
        </div>

        <section className="mix-grid" aria-label="整体用量构成" data-testid="global-breakdowns">
          <DonutPanel
            eyebrow="04 / DEVICE SHARE"
            title="设备额度分摊"
            data={deviceShare}
            valueKind="percent"
            centerValue={focus ? `${focus.usedPercent.toFixed(1)}%` : "—"}
            centerLabel="官方总使用"
            emptyText="尚无可分摊的额度增量"
          />
          <DonutPanel
            eyebrow="05 / MODEL MIX"
            title="模型构成"
            data={toDonut(data.overall.models, attributedPoints)}
            evidenceLabel="本地 + 估算"
            centerValue={formatTokens(
              data.overall.models.reduce((sum, entry) => sum + entry.tokens, 0),
            )}
            footer="环形表示本地 token 占比；图例数字是对应的估算额度百分点。"
          />
          <DonutPanel
            eyebrow="06 / EFFORT MIX"
            title="推理强度"
            data={toDonut(data.overall.efforts, attributedPoints)}
            evidenceLabel="本地 + 估算"
          />
          <DonutPanel
            eyebrow="07 / PURPOSE MIX"
            title="用途粗分类"
            data={toDonut(data.overall.purposes, attributedPoints)}
            evidenceLabel="本地 + 估算"
          />
        </section>

        <UsageTimeline timeline={data.timeline} accountUsage={data.accountUsage} />

        <section className="surface-ledger" data-testid="device-time-share">
          <div>
            <span className="plate-index">DEVICE / TIME SHARE</span>
            <h2>设备活跃时间占比</h2>
          </div>
          <div className="surface-bars">
            {data.devices.some((device) => device.activeMs > 0) ? (
              [...data.devices]
                .sort((a, b) => b.activeMs - a.activeMs)
                .map((device) => (
                  <div className="surface-bar surface-bar--time" key={device.id}>
                    <span>
                      {device.label}
                      <small className="device-ip">
                        {device.privateIp ?? device.publicIp ?? "IP 未知"}
                      </small>
                    </span>
                    <i>
                      <b style={{ width: `${device.activeSharePercent}%` }} />
                    </i>
                    <strong>
                      {device.activeSharePercent.toFixed(1)}% · {formatDuration(device.activeMs)}
                    </strong>
                  </div>
                ))
            ) : (
              <p>还没有本地活跃时间记录。</p>
            )}
          </div>
          <p className="surface-note">
            按本窗口内各设备本地记录的活跃时长占比排序；IP
            取设备上报的内网地址，缺失时回退到观察到的公网地址。
          </p>
        </section>

        <section className="surface-ledger">
          <div>
            <span className="plate-index">09 / SURFACE COVERAGE</span>
            <h2>启动方式覆盖</h2>
          </div>
          <div className="surface-bars">
            {data.overall.surfaces.length ? (
              data.overall.surfaces.map((surface) => (
                <div className="surface-bar" key={surface.key}>
                  <span>{surface.label}</span>
                  <i>
                    <b style={{ width: `${surface.percent}%` }} />
                  </i>
                  <strong>{surface.percent.toFixed(1)}%</strong>
                </div>
              ))
            ) : (
              <p>还没有本地启动来源记录。</p>
            )}
          </div>
          <p className="surface-note">
            CLI、IDE 与 Codex App 的本地事件会参与明细；只有账户端可见的远程活动保留为“未归因”。
          </p>
        </section>
      </main>

      <DeviceDrawer
        deviceId={selectedDeviceId}
        focusKey={data.focusLimitKey}
        onClose={() => setSelectedDeviceId(null)}
        onUpdated={onRefresh}
      />
    </div>
  );
};
