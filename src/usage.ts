import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface UsageWindow {
  id: string;
  label: string;
  durationSeconds?: number;
  usedPercent: number;
  resetAt?: number;
}

export interface UsageSnapshot {
  source: "codex_oauth";
  windows: UsageWindow[];
  queriedAt: number;
}

export type UsageView =
  | { status: "loading" }
  | { status: "ready"; snapshot: UsageSnapshot; stale: boolean; lastError?: string }
  | { status: "error"; code: string; message: string };

export interface RefreshSettings {
  intervalMinutes: number;
  usageEnabled: boolean;
  trayWindow: "five_hour" | "seven_day";
  notifySeventy: boolean;
  notifyNinety: boolean;
  notifyHundred: boolean;
  notifyReset: boolean;
}

export function getUsage(): Promise<UsageView> {
  return invoke<UsageView>("get_usage");
}

export function refreshUsage(): Promise<UsageView> {
  return invoke<UsageView>("refresh_usage");
}

export function getRefreshSettings(): Promise<RefreshSettings> {
  return invoke<RefreshSettings>("get_refresh_settings");
}

export function setRefreshInterval(minutes: number): Promise<RefreshSettings> {
  return invoke<RefreshSettings>("set_refresh_interval", { minutes });
}

export function setRefreshSettings(settings: RefreshSettings): Promise<RefreshSettings> {
  return invoke<RefreshSettings>("set_refresh_settings", { settings });
}

export function onUsageUpdated(handler: (view: UsageView) => void): Promise<UnlistenFn> {
  return listen<UsageView>("usage://updated", (event) => handler(event.payload));
}

export function onRefreshSettingsChanged(
  handler: (settings: RefreshSettings) => void,
): Promise<UnlistenFn> {
  return listen<RefreshSettings>("usage://settings-changed", (event) => handler(event.payload));
}
