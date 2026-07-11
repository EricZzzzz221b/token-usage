import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type WindowMode = "compact" | "detailed";
export type GlassStrength = "clear" | "standard" | "rich";

export interface WindowPreferences {
  mode: WindowMode;
  alwaysOnTop: boolean;
  locked: boolean;
  clickThrough: boolean;
  opacity: number;
  glassStrength: GlassStrength;
}

export function getWindowPreferences(): Promise<WindowPreferences> {
  return invoke<WindowPreferences>("get_window_preferences");
}

export function setWindowPreferences(preferences: WindowPreferences): Promise<WindowPreferences> {
  return invoke<WindowPreferences>("set_window_preferences", { preferences });
}

export function startWindowDrag(): Promise<void> {
  return invoke<void>("start_window_drag");
}

export function onWindowPreferences(
  handler: (preferences: WindowPreferences) => void,
): Promise<UnlistenFn> {
  return listen<WindowPreferences>("window://preferences", (event) => handler(event.payload));
}
