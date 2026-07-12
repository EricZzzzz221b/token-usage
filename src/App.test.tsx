import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./i18n";
import type { WindowPreferences } from "./window";

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
  loadSettings: vi.fn().mockResolvedValue({
    intervalMinutes: 5,
    usageEnabled: true,
    notifySeventy: false,
    notifyNinety: true,
    notifyHundred: true,
    notifyReset: false,
  }),
  saveInterval: vi.fn().mockResolvedValue({
    intervalMinutes: 5,
    usageEnabled: true,
    notifySeventy: false,
    notifyNinety: true,
    notifyHundred: true,
    notifyReset: false,
  }),
  saveSettings: vi.fn(),
  loadAutostart: vi.fn().mockResolvedValue(false),
  saveAutostart: vi.fn(),
  authorizeUsage: vi.fn().mockResolvedValue(ready),
  subscribe: vi.fn().mockResolvedValue(vi.fn()),
  loadWindowPreferences: vi.fn().mockResolvedValue(windowPreferences),
  saveWindowPreferences: vi.fn().mockResolvedValue(windowPreferences),
  dragWindow: vi.fn().mockResolvedValue(undefined),
  subscribeWindowPreferences: vi.fn().mockResolvedValue(vi.fn()),
  subscribeWindowModeChanged: vi.fn().mockResolvedValue(vi.fn()),
  resizeView: vi.fn().mockResolvedValue(undefined),
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
    fireEvent.click(screen.getByRole("button", { name: /设置|Settings/ }));
    fireEvent.change(screen.getByLabelText(/浮窗模式|Widget mode/), {
      target: { value: "compact" },
    });
    await waitFor(() =>
      expect(saveWindowPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "compact" }),
      ),
    );
  });

  it("keeps compact loading state inside the compact window", async () => {
    render(
      <App
        {...defaults}
        loadUsage={vi.fn().mockReturnValue(new Promise(() => undefined))}
        loadWindowPreferences={vi.fn().mockResolvedValue({
          ...windowPreferences,
          mode: "compact",
        })}
      />,
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/正在读取|Loading/);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("offers retry without expanding a compact error state", async () => {
    render(
      <App
        {...defaults}
        loadUsage={vi.fn().mockResolvedValue({
          status: "error" as const,
          code: "network_unavailable",
          message: "offline",
        })}
        loadWindowPreferences={vi.fn().mockResolvedValue({
          ...windowPreferences,
          mode: "compact",
        })}
      />,
    );
    expect(await screen.findByRole("button", { name: /重试|Retry/ })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the configured refresh interval and two native glass styles", async () => {
    render(
      <App
        {...defaults}
        loadSettings={vi.fn().mockResolvedValue({
          intervalMinutes: 10,
          usageEnabled: true,
          notifySeventy: false,
          notifyNinety: true,
          notifyHundred: true,
          notifyReset: false,
        })}
      />,
    );
    expect(await screen.findByText(/自动刷新 10 分钟|Refreshes every 10 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /设置|Settings/ }));
    const glassStyle = screen.getByLabelText(/玻璃样式|Glass style/) as HTMLSelectElement;
    expect(glassStyle.options).toHaveLength(2);
  });

  it("keeps settings open for preference-only tray events", async () => {
    let preferencesHandler: ((preferences: WindowPreferences) => void) | undefined;
    let modeHandler: ((preferences: WindowPreferences) => void) | undefined;
    render(
      <App
        {...defaults}
        subscribeWindowPreferences={vi.fn(async (handler) => {
          preferencesHandler = handler;
          return vi.fn();
        })}
        subscribeWindowModeChanged={vi.fn(async (handler) => {
          modeHandler = handler;
          return vi.fn();
        })}
      />,
    );
    await screen.findAllByRole("progressbar");
    fireEvent.click(screen.getByRole("button", { name: /设置|Settings/ }));
    expect(screen.getByRole("heading", { name: /设置|Settings/ })).toBeInTheDocument();

    act(() => preferencesHandler?.({ ...windowPreferences, clickThrough: false }));
    expect(screen.getByRole("heading", { name: /设置|Settings/ })).toBeInTheDocument();

    act(() => modeHandler?.({ ...windowPreferences, mode: "compact" }));
    expect(screen.queryByRole("heading", { name: /设置|Settings/ })).not.toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it("serializes rapid glass tint updates so the newest value wins", async () => {
    let resolveFirst: ((value: WindowPreferences) => void) | undefined;
    const saveWindowPreferences = vi
      .fn()
      .mockImplementationOnce(
        (preferences: WindowPreferences) =>
          new Promise<WindowPreferences>((resolve) => {
            resolveFirst = () => resolve(preferences);
          }),
      )
      .mockImplementation(async (preferences: WindowPreferences) => preferences);
    render(<App {...defaults} saveWindowPreferences={saveWindowPreferences} />);
    await screen.findAllByRole("progressbar");
    fireEvent.click(screen.getByRole("button", { name: /设置|Settings/ }));
    const tint = screen.getByLabelText(/玻璃着色|Glass tint/);
    fireEvent.change(tint, { target: { value: "0.55" } });
    fireEvent.change(tint, { target: { value: "1" } });

    await waitFor(() => expect(saveWindowPreferences).toHaveBeenCalledTimes(1));
    expect(saveWindowPreferences).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ opacity: 0.55 }),
    );
    await act(async () => resolveFirst?.(windowPreferences));
    await waitFor(() => expect(saveWindowPreferences).toHaveBeenCalledTimes(2));
    expect(saveWindowPreferences).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ opacity: 1 }),
    );
  });
});
