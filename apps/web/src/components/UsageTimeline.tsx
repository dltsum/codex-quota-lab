import type { DashboardResponse } from "@quotalab/contracts";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface UsageTimelineProps {
  timeline: DashboardResponse["timeline"];
  accountUsage: DashboardResponse["accountUsage"];
}

const TimelineTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: number }>;
  label?: string;
}) => {
  if (!active || !payload?.[0]) return null;
  return (
    <div className="chart-tooltip">
      <strong>
        {typeof label === "string"
          ? new Date(label).toLocaleString("zh-CN", { hour12: false })
          : ""}
      </strong>
      <span>官方已使用 {Number(payload[0].value ?? 0).toFixed(1)}%</span>
    </div>
  );
};

export const UsageTimeline = ({ timeline, accountUsage }: UsageTimelineProps) => {
  const chartData = timeline.map((point) => ({ ...point, time: point.observedAt }));
  const formatTick = (iso: string) =>
    new Date(iso).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  return (
    <section className="timeline-plate" data-testid="usage-timeline">
      <div className="timeline-heading">
        <div>
          <span className="plate-index">08 / WINDOW TRACE</span>
          <h2>官方额度轨迹</h2>
        </div>
        <div className="account-stats">
          {accountUsage?.lifetimeTokens !== null && accountUsage?.lifetimeTokens !== undefined ? (
            <span>
              <small>账户累计</small>
              <strong>
                {new Intl.NumberFormat("zh-CN", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format(accountUsage.lifetimeTokens)}
              </strong>
            </span>
          ) : null}
          {accountUsage?.currentStreakDays !== null &&
          accountUsage?.currentStreakDays !== undefined ? (
            <span>
              <small>连续活跃</small>
              <strong>{accountUsage.currentStreakDays} 天</strong>
            </span>
          ) : null}
        </div>
      </div>

      {chartData.length > 0 ? (
        <div className="timeline-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: 12, bottom: 2, left: -18 }}>
              <CartesianGrid
                vertical={false}
                stroke="rgba(22, 35, 56, 0.09)"
                strokeDasharray="3 5"
              />
              <XAxis
                axisLine={false}
                dataKey="time"
                minTickGap={36}
                tick={{ fill: "#697586", fontFamily: "IBM Plex Mono", fontSize: 10 }}
                tickFormatter={formatTick}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                domain={[0, 100]}
                tick={{ fill: "#697586", fontFamily: "IBM Plex Mono", fontSize: 10 }}
                tickFormatter={(value: number) => `${value}%`}
                tickLine={false}
                width={48}
              />
              <Tooltip
                content={(properties) => (
                  <TimelineTooltip
                    active={properties.active}
                    payload={properties.payload as unknown as ReadonlyArray<{ value?: number }>}
                    label={properties.label as string}
                  />
                )}
              />
              <Area
                type="monotone"
                dataKey="usedPercent"
                stroke="#3157ff"
                strokeWidth={2.5}
                fill="#3157ff"
                fillOpacity={0.12}
                isAnimationActive={false}
                activeDot={{ r: 5, fill: "#3157ff", stroke: "#fff", strokeWidth: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="timeline-empty">
          <span aria-hidden="true" />
          <p>窗口内还没有可绘制的官方百分比变化。</p>
        </div>
      )}
    </section>
  );
};
