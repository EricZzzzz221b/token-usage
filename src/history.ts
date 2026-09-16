import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export type HistoryRange = "one_day" | "seven_days" | "thirty_days";

export interface UsageHistoryPoint {
  queriedAt: number;
  remainingPercent: number;
  reset?: boolean;
}

export interface UsageHistorySeries {
  range: HistoryRange;
  windowId: string;
  points: UsageHistoryPoint[];
  sampleCount: number;
  currentRemaining?: number;
  minimumRemaining?: number;
  maximumRemaining?: number;
  consumptionPerHour?: number;
  projectedExhaustionAt?: number;
}

export function getUsageHistory(
  range: HistoryRange,
  windowId: string,
): Promise<UsageHistorySeries> {
  return invoke<UsageHistorySeries>("get_usage_history", { range, windowId });
}

export async function exportUsageHistory(range: HistoryRange, windowId: string): Promise<boolean> {
  const path = await save({
    defaultPath: `token-usage-${range}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;
  await invoke("export_usage_history_to_path", { range, windowId, path });
  return true;
}

export function clearUsageHistory(): Promise<void> {
  return invoke<void>("clear_usage_history");
}

export function buildHistoryPath(
  points: UsageHistoryPoint[],
  width: number,
  height: number,
  padding = 8,
): string {
  if (points.length === 0) return "";
  const firstTime = points[0].queriedAt;
  const lastTime = points[points.length - 1].queriedAt;
  const duration = Math.max(1, lastTime - firstTime);
  const chartWidth = Math.max(1, width - padding * 2);
  const chartHeight = Math.max(1, height - padding * 2);

  return points
    .map((point, index) => {
      const x = padding + ((point.queriedAt - firstTime) / duration) * chartWidth;
      const y =
        padding + (1 - Math.max(0, Math.min(100, point.remainingPercent)) / 100) * chartHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
