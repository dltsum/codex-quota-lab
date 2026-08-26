import type { DashboardResponse, QuotaLimitSummary } from "@quotalab/contracts";

import { formatCountdown, formatRelative } from "../format";

interface QualityPlateProps {
  quality: DashboardResponse["dataQuality"];
  focus: QuotaLimitSummary | undefined;
  generatedAt: string;
}

export const QualityPlate = ({ quality, focus, generatedAt }: QualityPlateProps) => {
  const coverage = Math.max(0, Math.min(100, quality.localCoveragePercent));
  return (
    <aside className="quality-plate" aria-labelledby="quality-title">
      <div className="plate-heading plate-heading--compact">
        <div>
          <span className="plate-index">03 / CONFIDENCE</span>
          <h2 id="quality-title">数据质量</h2>
        </div>
        <span className={quality.officialSnapshotFresh ? "fresh-light" : "fresh-light is-stale"}>
          {quality.officialSnapshotFresh ? "LIVE" : "STALE"}
        </span>
      </div>

      <div className="quality-reset">
        <span>当前窗口</span>
        <strong>{formatCountdown(focus?.resetsAt ?? null)}</strong>
        <small>面板更新于 {formatRelative(generatedAt)}</small>
      </div>

      <div className="coverage-meter">
        <div className="coverage-meter__head">
          <span>本地解释覆盖</span>
          <strong>{coverage.toFixed(0)}%</strong>
        </div>
        <span className="coverage-meter__track">
          <i style={{ width: `${coverage}%` }} />
        </span>
      </div>

      <dl className="quality-list">
        <div>
          <dt>未归因消耗</dt>
          <dd className={quality.unattributedPercentagePoints > 0 ? "is-warning" : ""}>
            {quality.unattributedPercentagePoints.toFixed(2)} pp
          </dd>
        </div>
        <div>
          <dt>解析异常记录</dt>
          <dd>{quality.scannerMalformedRecords}</dd>
        </div>
      </dl>

      <p className="quality-note">{quality.note}</p>
    </aside>
  );
};
