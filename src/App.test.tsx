import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./i18n";

const ready = {
  status: "ready" as const,
  stale: false,
  snapshot: {
    source: "codex_oauth" as const,
    queriedAt: Date.now(),
    windows: [
      { id: "five_hour", label: "5 hours", usedPercent: 42, resetAt: 2_000_000_000 },
      { id: "seven_day", label: "7 days", usedPercent: 68 },
    ],
  },
};
const windowPreferences = {
  mode: "detailed" as const,
  alwaysOnTop: true,
  locked: false,
  clickThrough: false,
  opacity: 0.86,
  glassStrength: "standard" as const,
};
const defaults = {
  loadUsage: vi.fn().mockResolvedValue(ready),
  reloadUsage: vi.fn().mockResolvedValue(ready),
  loadSettings: vi.fn().mockResolvedValue({ intervalMinutes: 5 }),
  saveInterval: vi.fn().mockResolvedValue({ intervalMinutes: 5 }),
  subscribe: vi.fn().mockResolvedValue(vi.fn()),
  loadWindowPreferences: vi.fn().mockResolvedValue(windowPreferences),
  saveWindowPreferences: vi.fn().mockResolvedValue(windowPreferences),
  dragWindow: vi.fn().mockResolvedValue(undefined),
  subscribeWindowPreferences: vi.fn().mockResolvedValue(vi.fn()),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders detailed usage metadata", async () => {
    render(<App {...defaults} />);
    expect(await screen.findAllByRole("progressbar")).toHaveLength(2);
    expect(screen.getByText(/剩余 58%|58% remaining/)).toBeInTheDocument();
  });
  it("starts dragging from the header", async () => {
    const dragWindow = vi.fn().mockResolvedValue(undefined);
    render(<App {...defaults} dragWindow={dragWindow} />);
    await screen.findAllByRole("progressbar");
    fireEvent.mouseDown(screen.getByRole("banner"), { button: 0 });
    expect(dragWindow).toHaveBeenCalledOnce();
  });
  it("saves compact mode", async () => {
    const saveWindowPreferences = vi
      .fn()
      .mockResolvedValue({ ...windowPreferences, mode: "compact" });
    render(<App {...defaults} saveWindowPreferences={saveWindowPreferences} />);
    await screen.findAllByRole("progressbar");
    fireEvent.click(screen.getByRole("button", { name: /浮窗设置|Widget settings/ }));
    fireEvent.change(screen.getByLabelText(/浮窗模式|Widget mode/), {
      target: { value: "compact" },
    });
    await waitFor(() =>
      expect(saveWindowPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "compact" }),
      ),
    );
  });
});
