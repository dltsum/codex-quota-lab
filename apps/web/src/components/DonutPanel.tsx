import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatTokens } from "../format";

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  displayValue?: string;
  legendValue?: string;
  color?: string;
}

interface DonutPanelProps {
  title: string;
  eyebrow: string;
  data: DonutDatum[];
  centerValue?: string;
  centerLabel?: string;
  emptyText?: string;
  footer?: ReactNode;
  valueKind?: "tokens" | "percent";
  evidenceLabel?: string;
  compact?: boolean;
}

const COLORS = ["#3157ff", "#8fd5c1", "#ff6b52", "#8c6cff", "#e8b44b", "#59758f"];

const TooltipContent = ({
  active,
  payload,
  valueKind,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: DonutDatum }>;
  valueKind: "tokens" | "percent";
}) => {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  const value =
    datum.displayValue ??
    (valueKind === "percent"
      ? `${datum.value.toFixed(2)} 个百分点`
      : `${formatTokens(datum.value)} tokens`);
  return (
    <div className="chart-tooltip">
      <strong>{datum.label}</strong>
      <span>{value}</span>
    </div>
  );
};

export const DonutPanel = ({
  title,
  eyebrow,
  data,
  centerValue,
  centerLabel,
  emptyText = "暂无本地活动",
  footer,
  valueKind = "tokens",
  evidenceLabel,
  compact = false,
}: DonutPanelProps) => {
  const visible = data.filter((entry) => entry.value > 0);
  const total = visible.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <section className={compact ? "mix-plate mix-plate--compact" : "mix-plate"}>
      <div className="mix-heading">
        <div>
          <span className="plate-index">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <span
          className={
            valueKind === "percent" || evidenceLabel
              ? "evidence-chip evidence-chip--estimated"
              : "evidence-chip evidence-chip--local"
          }
        >
          {evidenceLabel ?? (valueKind === "percent" ? "估算" : "本地测量")}
        </span>
      </div>

      {total > 0 ? (
        <>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={visible}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={compact ? "57%" : "61%"}
                  outerRadius={compact ? "82%" : "88%"}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {visible.map((entry, index) => (
                    <Cell key={entry.key} fill={entry.color ?? COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={(properties) => (
                    <TooltipContent
                      active={properties.active}
                      payload={
                        properties.payload as unknown as ReadonlyArray<{ payload?: DonutDatum }>
                      }
                      valueKind={valueKind}
                    />
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <strong>
                {centerValue ??
                  (valueKind === "tokens" ? formatTokens(total) : `${total.toFixed(1)}%`)}
              </strong>
              <span>{centerLabel ?? (valueKind === "tokens" ? "tokens" : "百分点")}</span>
            </div>
          </div>
          <div className="legend-list">
            {visible.slice(0, compact ? 4 : 5).map((entry, index) => (
              <div className="legend-row" key={entry.key}>
                <span
                  className="legend-swatch"
                  style={{ background: entry.color ?? COLORS[index % COLORS.length] }}
                />
                <span className="legend-label" title={entry.label}>
                  {entry.label}
                </span>
                <strong>
                  {entry.legendValue ??
                    entry.displayValue ??
                    (valueKind === "percent"
                      ? `${entry.value.toFixed(2)} pp`
                      : formatTokens(entry.value))}
                </strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mix-empty">
          <span aria-hidden="true" />
          <p>{emptyText}</p>
        </div>
      )}
      {footer ? <div className="mix-footer">{footer}</div> : null}
    </section>
  );
};
