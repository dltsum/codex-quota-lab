import type {
  AttributionConfidence,
  QuotaAllocation,
  QuotaLimitSummary,
} from "@quotalab/contracts";

import { formatCountdown, limitLabel } from "../format";
import { buildQuotaAllocationSegments } from "../quota-allocation";

interface QuotaHorizonProps {
  limits: QuotaLimitSummary[];
  focusKey: string | null;
  allocations: QuotaAllocation[];
  onFocus: (key: string) => void;
}

const ringRadius = [132, 109, 86, 67];
const ringColors = ["var(--cobalt)", "var(--mint-strong)", "var(--violet)", "var(--coral)"];
const confidenceLabels: Record<AttributionConfidence, string> = {
  high: "高置信度估算",
  medium: "并发 · 中置信度",
  low: "低置信度估算",
  unattributed: "未归因",
};

export const QuotaHorizon = ({ limits, focusKey, allocations, onFocus }: QuotaHorizonProps) => {
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

  const allocationSegments = buildQuotaAllocationSegments(allocations, focused.usedPercent);
  const allocationDescription = allocationSegments
    .map((segment) => `${segment.label} ${segment.percentagePoints.toFixed(1)}%`)
    .join("，");

  return (
    <section className="horizon-plate" data-testid="quota-horizon">
      <div className="plate-heading">
        <div>
          <span className="plate-index">02 / OFFICIAL QUOTA</span>
          <h2>额度地平线</h2>
        </div>
        <div className="evidence-chip-set">
          <span className="evidence-chip evidence-chip--official">总值 · 官方</span>
          <span className="evidence-chip evidence-chip--estimated">设备分段 · 估算</span>
        </div>
      </div>

      <div className="horizon-body">
        <div className="horizon-dial">
          <svg role="img" aria-labelledby="horizon-title horizon-description" viewBox="0 0 320 320">
            <title id="horizon-title">Codex 官方额度使用比例</title>
            <desc id="horizon-description">
              当前选中窗口已使用 {focused.usedPercent.toFixed(1)}%，剩余{" "}
              {focused.remainingPercent.toFixed(1)}%。设备估算构成为：{allocationDescription}。
            </desc>
            <g transform="rotate(-90 160 160)">
              {rings.map((limit, index) => {
                const radius = ringRadius[index] ?? 67;
                const circumference = Math.PI * 2 * radius;
                const dash = (circumference * limit.usedPercent) / 100;
                const isFocused = limit.key === focused.key;
                const showAllocation = isFocused && allocationSegments.length > 0;
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
                    {showAllocation ? (
                      allocationSegments.map((segment) => {
                        const segmentLength = (circumference * segment.percentagePoints) / 100;
                        const segmentOffset = -(circumference * segment.startPercent) / 100;
                        return (
                          <circle
                            aria-label={`${segment.label}，估算占周期额度 ${segment.percentagePoints.toFixed(1)}%`}
                            className="horizon-allocation-segment"
                            cx="160"
                            cy="160"
                            data-percentage={segment.percentagePoints}
                            data-testid={`quota-segment-${segment.deviceId ?? "unattributed"}`}
                            fill="none"
                            key={segment.deviceId ?? "unattributed"}
                            r={radius}
                            stroke={segment.color}
                            strokeDasharray={`${segmentLength} ${Math.max(0, circumference - segmentLength)}`}
                            strokeDashoffset={segmentOffset}
                            strokeWidth={13}
                          />
                        );
                      })
                    ) : (
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
                    )}
                    <circle
                      cx="160"
                      cy={160 - radius}
                      r={isFocused ? 5 : 3.5}
                      fill={showAllocation ? allocationSegments[0]!.color : ringColors[index]}
                    />
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="horizon-center" aria-hidden="true">
            <span>官方已用</span>
            <strong>
              {focused.usedPercent.toFixed(1)}
              <small>%</small>
            </strong>
            <i>
              <span>剩余 {focused.remainingPercent.toFixed(1)}%</span>
              <span>{formatCountdown(focused.resetsAt)}</span>
            </i>
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
          <div
            aria-label={`官方已用 ${focused.usedPercent.toFixed(1)}%。设备估算：${allocationDescription}`}
            className="quota-allocation"
            data-testid="quota-allocation-breakdown"
            role="group"
          >
            <div className="quota-allocation__heading">
              <span>当前已用构成</span>
              <strong>{focused.usedPercent.toFixed(1)}% 官方总值</strong>
            </div>
            <div className="quota-allocation__meter" aria-hidden="true">
              {allocationSegments.map((segment) => (
                <i
                  key={segment.deviceId ?? "unattributed"}
                  style={{ background: segment.color, width: `${segment.percentagePoints}%` }}
                />
              ))}
            </div>
            <ul>
              {allocationSegments.map((segment) => (
                <li key={segment.deviceId ?? "unattributed"}>
                  <span
                    className="quota-allocation__swatch"
                    style={{ background: segment.color }}
                  />
                  <span className="quota-allocation__device">
                    <strong>{segment.label}</strong>
                    <small>{confidenceLabels[segment.confidence]}</small>
                  </span>
                  <strong className="quota-allocation__value">
                    {segment.percentagePoints.toFixed(1)}
                    <small>%</small>
                  </strong>
                </li>
              ))}
            </ul>
            <p>设备数字为整个周期额度的估算百分比，分段合计对应官方已用值。</p>
          </div>
          <p className="window-observed">
            最近采样：{new Date(focused.observedAt).toLocaleString("zh-CN", { hour12: false })}
          </p>
        </div>
      </div>
    </section>
  );
};
