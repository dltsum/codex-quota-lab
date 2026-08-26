import type { DeviceSummary } from "@quotalab/contracts";

import { formatRelative, formatTokens } from "../format";
import { ChevronIcon } from "./Icons";

interface DeviceRailProps {
  devices: DeviceSummary[];
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
}

const statusLabel: Record<DeviceSummary["status"], string> = {
  online: "在线",
  stale: "采样延迟",
  offline: "离线",
};

export const DeviceRail = ({ devices, selectedId, onSelect }: DeviceRailProps) => (
  <aside className="device-rail" aria-labelledby="device-rail-title">
    <div className="rail-heading">
      <div>
        <span className="plate-index">01 / DEVICES</span>
        <h2 id="device-rail-title">设备席位</h2>
      </div>
      <span className="device-count">{devices.length}</span>
    </div>

    <div className="device-list">
      {devices.length === 0 ? (
        <div className="device-empty">
          <span>NO SIGNAL</span>
          <p>尚未注册设备。请在电脑上运行 QuotaLab agent setup。</p>
        </div>
      ) : (
        devices.map((device, index) => {
          const overBudget =
            device.softBudgetPercent !== null &&
            device.estimatedQuotaPercent >= device.softBudgetPercent;
          return (
            <button
              className={selectedId === device.id ? "device-row is-selected" : "device-row"}
              data-testid={`device-${device.id}`}
              key={device.id}
              onClick={() => onSelect(device.id)}
              type="button"
            >
              <span className="device-index">{String(index + 1).padStart(2, "0")}</span>
              <span
                className={`status-dot status-dot--${device.status}`}
                aria-label={statusLabel[device.status]}
              />
              <span className="device-copy">
                <strong title={device.label}>{device.label}</strong>
                <small>
                  {formatTokens(device.tokenTotal)} · {formatRelative(device.lastSeenAt)}
                </small>
                {overBudget ? <em>已达软预算</em> : null}
              </span>
              <span className="device-quota">
                <strong>{device.estimatedQuotaPercent.toFixed(1)}</strong>
                <small>估算 pp</small>
              </span>
              <ChevronIcon />
            </button>
          );
        })
      )}
    </div>

    <div className="rail-legend">
      <span>
        <i className="status-dot status-dot--online" />
        在线
      </span>
      <span>
        <i className="status-dot status-dot--stale" />
        延迟
      </span>
      <span>
        <i className="status-dot status-dot--offline" />
        离线
      </span>
    </div>
  </aside>
);
