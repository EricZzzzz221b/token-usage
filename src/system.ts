import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
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
export async function exportDiagnosticReport(): Promise<boolean> {
  const path = await save({
    defaultPath: `token-usage-diagnostics-${Date.now()}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return false;
  await invoke("export_diagnostic_report", { path });
  return true;
}
export const enableUsage = () => invoke<import("./usage").UsageView>("enable_usage");
export type AccountMode = "subscription" | "api" | "other" | "signed_out";
export const getAccountMode = () => invoke<{ mode: AccountMode }>("account_mode");
export const syncSurfaceTone = (dark: boolean) => invoke<boolean>("sync_surface_tone", { dark });
export const screenCaptureAllowed = () => invoke<boolean>("screen_capture_allowed");
export const sampleBackdropLuminance = () => invoke<number>("sample_backdrop_luminance");

export async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export function confirmNative(message: string, title = "Token用量"): Promise<boolean> {
  return ask(message, { title, kind: "warning" });
}
