import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
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

export async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export async function exportDiagnosticReport(): Promise<boolean> {
  const path = await save({
    defaultPath: "token-usage-diagnostics.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return false;
  await invoke("export_diagnostic_report", { path });
  return true;
}
