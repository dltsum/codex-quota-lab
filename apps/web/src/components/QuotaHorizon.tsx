import type { QuotaLimitSummary } from "@quotalab/contracts";

import { formatCountdown, limitLabel } from "../format";

interface QuotaHorizonProps {
  limits: QuotaLimitSummary[];
  focusKey: string | null;
  onFocus: (key: string) => void;
}

const ringRadius = [132, 109, 86, 67];
const ringColors = ["var(--cobalt)", "var(--mint-strong)", "var(--violet)", "var(--coral)"];

export const QuotaHorizon = ({ limits, focusKey, onFocus }: QuotaHorizonProps) => {
  const focused = limits.find((limit) => limit.key === focusKey) ?? limits[0];
  const rings = limits.slice(0, 4);

  if (!focused) {
    return (
      <section className="horizon-plate horizon-plate--empty" data-testid="quota-horizon">
        <div className="plate-heading">
          <div>
            <span className="plate-index">02 / OFFICIAL QUOTA</span>
            <h2>额度地平线</h2>
          </div>
          <span className="evidence-chip evidence-chip--official">官方读数</span>
        </div>
        <div className="empty-instrument">
          <span className="empty-instrument__orbit" aria-hidden="true" />
          <strong>等待首个额度快照</strong>
          <p>在任一设备运行采集器后，这里会显示 Codex 的官方剩余比例与重置时间。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="horizon-plate" data-testid="quota-horizon">
      <div className="plate-heading">
        <div>
          <span className="plate-index">02 / OFFICIAL QUOTA</span>
          <h2>额度地平线</h2>
        </div>
        <span className="evidence-chip evidence-chip--official">官方读数</span>
      </div>

      <div className="horizon-body">
        <div className="horizon-dial">
          <svg role="img" aria-labelledby="horizon-title horizon-description" viewBox="0 0 320 320">
            <title id="horizon-title">Codex 官方额度使用比例</title>
            <desc id="horizon-description">
              当前选中窗口已使用 {focused.usedPercent.toFixed(1)}%，剩余{" "}
              {focused.remainingPercent.toFixed(1)}%。
            </desc>
            <g transform="rotate(-90 160 160)">
              {rings.map((limit, index) => {
                const radius = ringRadius[index] ?? 67;
                const circumference = Math.PI * 2 * radius;
                const dash = (circumference * limit.usedPercent) / 100;
                const isFocused = limit.key === focused.key;
                return (
                  <g key={limit.key}>
                    <circle
                      className="horizon-track"
                      cx="160"
                      cy="160"
                      fill="none"
                      r={radius}
                      strokeWidth={isFocused ? 13 : 9}
                    />
                    <circle
                      className="horizon-value"
                      cx="160"
                      cy="160"
                      fill="none"
                      r={radius}
                      stroke={ringColors[index]}
                      strokeDasharray={`${dash} ${Math.max(0, circumference - dash)}`}
                      strokeWidth={isFocused ? 13 : 9}
                    />
                    <circle
                      cx="160"
                      cy={160 - radius}
                      r={isFocused ? 5 : 3.5}
                      fill={ringColors[index]}
                    />
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="horizon-center" aria-hidden="true">
            <span>剩余</span>
            <strong>
              {focused.remainingPercent.toFixed(1)}
              <small>%</small>
            </strong>
            <i>{formatCountdown(focused.resetsAt)}</i>
          </div>
        </div>

        <div className="window-selector" aria-label="选择额度窗口">
          {limits.map((limit, index) => (
            <button
              type="button"
              className={limit.key === focused.key ? "window-row is-active" : "window-row"}
              key={limit.key}
              onClick={() => onFocus(limit.key)}
            >
              <span
                className="window-row__color"
                style={{ background: ringColors[index % ringColors.length] }}
              />
              <span className="window-row__label">
                <strong>{limitLabel(limit.windowDurationMins, limit.limitName)}</strong>
                <small>{limit.kind === "primary" ? "主窗口" : "次窗口"}</small>
              </span>
              <span className="window-row__value">
                <strong>{limit.usedPercent.toFixed(1)}%</strong>
                <small>已使用</small>
              </span>
            </button>
          ))}
          <p className="window-observed">
            最近采样：{new Date(focused.observedAt).toLocaleString("zh-CN", { hour12: false })}
          </p>
        </div>
      </div>
    </section>
  );
};
