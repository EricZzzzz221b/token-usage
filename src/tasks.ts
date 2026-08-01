import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type TaskStatus =
  "thinking" | "executing" | "waiting" | "completed" | "failed" | "interrupted" | "unknown";

export type ProductSource = "codex" | "claude";

export interface CodexTask {
  product: ProductSource;
  id: string;
  sessionId?: string;
  title: string;
  project: string;
  status: TaskStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface TaskSnapshot {
  tasks: CodexTask[];
  queriedAt: number;
}

export function getTasks(): Promise<TaskSnapshot> {
  return invoke<TaskSnapshot>("get_tasks");
}

export function onTasksUpdated(handler: (snapshot: TaskSnapshot) => void): Promise<UnlistenFn> {
  return listen<TaskSnapshot>("tasks://updated", (event) => handler(event.payload));
}

export function openTask(product: ProductSource, sessionId: string): Promise<void> {
  return invoke<void>("open_task", { product, sessionId });
}
