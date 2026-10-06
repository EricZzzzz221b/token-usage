import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type UpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "up_to_date"
  | "confirming"
  | "downloading"
  | "installing"
  | "restarting"
  | "error";
export interface UpdateSnapshot {
  currentVersion: string;
  enabled: boolean;
  phase: UpdatePhase;
  update: { version: string; notes: string } | null;
  downloaded: number;
  total: number | null;
  error: string | null;
  visible: boolean;
  revision: number;
}
export const getUpdateState = () => invoke<UpdateSnapshot>("get_update_state");
export const checkForUpdates = () => invoke<UpdateSnapshot>("check_for_updates");
export const installUpdate = (version: string) =>
  invoke<UpdateSnapshot>("install_update", { version });
export const onUpdateChanged = (handler: (snapshot: UpdateSnapshot) => void) =>
  listen<UpdateSnapshot>("updates://changed", (event) => handler(event.payload));

export const onUpdateSettingsRequested = (handler: () => void) =>
  listen("updates://open-settings", handler);
