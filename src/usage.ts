import { invoke } from "@tauri-apps/api/core";

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

export interface UsageErrorPayload {
  code: string;
  message: string;
}

export async function fetchUsage(): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>("fetch_usage");
}

export function normalizeInvokeError(error: unknown): UsageErrorPayload {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return {
      code: String(error.code),
      message: String(error.message),
    };
  }
  return { code: "unknown", message: String(error) };
}
