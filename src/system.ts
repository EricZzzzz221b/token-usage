import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

export interface DiagnosticReport {
  appVersion: string;
  os: string;
  credential: { status: string; source: string };
  usageStatus: string;
  refreshSettings: import("./usage").RefreshSettings;
}

export const getAutostart = () => invoke<boolean>("get_autostart");
export const setAutostart = (enabled: boolean) => invoke<boolean>("set_autostart", { enabled });
export const getDiagnosticReport = () => invoke<DiagnosticReport>("diagnostic_report");
export const enableUsage = () => invoke<import("./usage").UsageView>("enable_usage");
export type AccountMode = "subscription" | "api" | "other" | "signed_out";
export const getAccountMode = () => invoke<{ mode: AccountMode }>("account_mode");

export async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}
