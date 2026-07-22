import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type WindowMode = "compact" | "detailed";
export type BackdropTone = "light" | "dark";
export interface WindowPreferences {
  mode: WindowMode;
  alwaysOnTop: boolean;
  locked: boolean;
  clickThrough: boolean;
  showDockIcon: boolean;
  glassLevel: number;
}

export async function getBackdropTone(): Promise<BackdropTone> {
  const dark = await invoke<boolean>("backdrop_is_dark");
  return dark ? "dark" : "light";
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

export function resizeWindowForView(view: "compact" | "detailed" | "settings"): Promise<void> {
  return invoke<void>("resize_window_for_view", { view });
}

export function onWindowPreferences(
  handler: (preferences: WindowPreferences) => void,
): Promise<UnlistenFn> {
  return listen<WindowPreferences>("window://preferences", (event) => handler(event.payload));
}

export function onWindowModeChanged(
  handler: (preferences: WindowPreferences) => void,
): Promise<UnlistenFn> {
  return listen<WindowPreferences>("window://mode-changed", (event) => handler(event.payload));
}
