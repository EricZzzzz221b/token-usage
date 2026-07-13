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
  glassLevel: 0.5,
};
const defaults = {
  loadUsage: vi.fn().mockResolvedValue(ready),
  reloadUsage: vi.fn().mockResolvedValue(ready),
  loadSettings: vi.fn().mockResolvedValue({
    intervalMinutes: 5,
    usageEnabled: true,
    trayWindow: "five_hour" as const,
    notifySeventy: false,
    notifyNinety: true,
    notifyHundred: true,
    notifyReset: false,
  }),
  saveInterval: vi.fn().mockResolvedValue({
    intervalMinutes: 5,
    usageEnabled: true,
    trayWindow: "five_hour" as const,
    notifySeventy: false,
    notifyNinety: true,
    notifyHundred: true,
    notifyReset: false,
  }),
  saveSettings: vi.fn(),
  loadAutostart: vi.fn().mockResolvedValue(false),
  saveAutostart: vi.fn(),
  loadAppVersion: vi.fn().mockResolvedValue("1.1.0"),
  authorizeUsage: vi.fn().mockResolvedValue(ready),
  subscribe: vi.fn().mockResolvedValue(vi.fn()),
  subscribeSettings: vi.fn().mockResolvedValue(vi.fn()),
  loadWindowPreferences: vi.fn().mockResolvedValue(windowPreferences),
  saveWindowPreferences: vi.fn().mockResolvedValue(windowPreferences),
  dragWindow: vi.fn().mockResolvedValue(undefined),
  subscribeWindowPreferences: vi.fn().mockResolvedValue(vi.fn()),
  subscribeWindowModeChanged: vi.fn().mockResolvedValue(vi.fn()),
  resizeView: vi.fn().mockResolvedValue(undefined),
  detectDarkBackdrop: vi.fn().mockResolvedValue(false),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders remaining quota as a countdown from 100 to 0", async () => {
    render(<App {...defaults} />);
    const progressbars = await screen.findAllByRole("progressbar");
    expect(progressbars).toHaveLength(2);
    expect(progressbars.map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["58", "32"]);
    expect(screen.getByText("58%")).toBeInTheDocument();
    expect(screen.getByText("32%")).toBeInTheDocument();
    expect(screen.getByText(/已使用 42%|42% used/)).toBeInTheDocument();
  });

  it("shows an empty quota as zero percent in red", async () => {
    render(
      <App
        {...defaults}
        loadUsage={vi.fn().mockResolvedValue({
          ...ready,
          snapshot: {
            ...ready.snapshot,
            windows: [{ id: "five_hour", label: "5 hours", usedPercent: 100 }],
          },
        })}
      />,
    );
    const progressbar = await screen.findByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "0");
    expect(progressbar).toHaveClass("risk-track-limit");
    expect(screen.getByText("0%")).toHaveClass("risk-text-limit");
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

  it("automatically uses light text over a dark desktop background", async () => {
    render(<App {...defaults} detectDarkBackdrop={vi.fn().mockResolvedValue(true)} />);
    await waitFor(() => expect(document.querySelector("main")).toHaveClass("text-tone-light"));
  });

  it("automatically uses dark text over a light desktop background", async () => {
    render(<App {...defaults} detectDarkBackdrop={vi.fn().mockResolvedValue(false)} />);
    await waitFor(() => expect(document.querySelector("main")).toHaveClass("text-tone-dark"));
  });

  it("switches directly from compact to standard mode", async () => {
    const saveWindowPreferences = vi.fn(async (preferences: WindowPreferences) => preferences);
    const resizeView = vi.fn().mockResolvedValue(undefined);
    render(
      <App
        {...defaults}
        loadWindowPreferences={vi.fn().mockResolvedValue({
          ...windowPreferences,
          mode: "compact",
        })}
        saveWindowPreferences={saveWindowPreferences}
        resizeView={resizeView}
      />,
    );

    expect(await screen.findByText("58%")).toBeInTheDocument();
    expect(screen.getByText("32%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /切换到标准模式|Switch to standard mode/ }));

    await waitFor(() =>
      expect(saveWindowPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "detailed" }),
      ),
    );
    expect(resizeView).toHaveBeenCalledWith("detailed");
  });

  it("switches directly from standard to compact mode", async () => {
    const saveWindowPreferences = vi.fn(async (preferences: WindowPreferences) => preferences);
    const resizeView = vi.fn().mockResolvedValue(undefined);
    render(
      <App {...defaults} saveWindowPreferences={saveWindowPreferences} resizeView={resizeView} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /切换到紧凑模式|Switch to compact mode/ }),
    );

    await waitFor(() =>
      expect(saveWindowPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "compact" }),
      ),
    );
    expect(resizeView).toHaveBeenCalledWith("compact");
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

  it("shows the configured refresh interval and one continuous glass control", async () => {
    render(
      <App
        {...defaults}
        loadSettings={vi.fn().mockResolvedValue({
          intervalMinutes: 10,
          usageEnabled: true,
          trayWindow: "seven_day" as const,
          notifySeventy: false,
          notifyNinety: true,
          notifyHundred: true,
          notifyReset: false,
        })}
      />,
    );
    expect(await screen.findByText(/自动刷新 10 分钟|Refreshes every 10 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /设置|Settings/ }));
    const glassEffect = screen.getByLabelText(/玻璃效果|Glass effect/) as HTMLInputElement;
    expect(glassEffect.type).toBe("range");
    expect(glassEffect.value).toBe("0.5");
    const trayWindow = screen.getByLabelText(/托盘显示周期|System tray window/);
    expect(trayWindow).toHaveValue("seven_day");
    fireEvent.change(trayWindow, { target: { value: "five_hour" } });
    await waitFor(() =>
      expect(defaults.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ trayWindow: "five_hour" }),
      ),
    );
    expect(screen.queryByText(/诊断报告|Diagnostics/)).not.toBeInTheDocument();
    expect(screen.getByText(/Token用量 v1\.1\.0|Token Usage v1\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Eric Zhang/)).toBeInTheDocument();
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

  it("serializes rapid glass effect updates so the newest value wins", async () => {
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
    const glassEffect = screen.getByLabelText(/玻璃效果|Glass effect/);
    fireEvent.change(glassEffect, { target: { value: "0.2" } });
    fireEvent.change(glassEffect, { target: { value: "0.9" } });

    await waitFor(() => expect(saveWindowPreferences).toHaveBeenCalledTimes(1));
    expect(saveWindowPreferences).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ glassLevel: 0.2 }),
    );
    await act(async () => resolveFirst?.(windowPreferences));
    await waitFor(() => expect(saveWindowPreferences).toHaveBeenCalledTimes(2));
    expect(saveWindowPreferences).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ glassLevel: 0.9 }),
    );
  });
});
