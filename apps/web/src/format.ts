export const formatTokens = (value: number): string => {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("zh-CN").format(value);
};

export const formatDuration = (milliseconds: number): string => {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 1) return `${Math.round(milliseconds / 1_000)} 秒`;
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
};

export const formatRelative = (iso: string, now: number = Date.now()): string => {
  const delta = Math.max(0, now - Date.parse(iso));
  if (delta < 60_000) return "刚刚";
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
};

export const formatCountdown = (iso: string | null, now: number = Date.now()): string => {
  if (!iso) return "重置时间未知";
  const remaining = Date.parse(iso) - now;
  if (remaining <= 0) return "正在重置";
  const totalMinutes = Math.ceil(remaining / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} 天 ${hours} 小时后重置`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分后重置`;
  return `${minutes} 分钟后重置`;
};

export const limitLabel = (durationMinutes: number | null, name: string | null): string => {
  if (name && !/^codex(_other)?$/i.test(name)) return name;
  if (!durationMinutes) return "额度窗口";
  if (durationMinutes % 10_080 === 0) return `${durationMinutes / 10_080} 周窗口`;
  if (durationMinutes % 1_440 === 0) return `${durationMinutes / 1_440} 天窗口`;
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60} 小时窗口`;
  return `${durationMinutes} 分钟窗口`;
};
