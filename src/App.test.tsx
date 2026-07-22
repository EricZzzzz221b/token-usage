import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./i18n";
import type { RefreshSettings } from "./usage";
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
  showDockIcon: false,
  glassLevel: 1,
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
  saveSettings: vi.fn(async (settings: RefreshSettings) => settings),
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
  detectBackdrop: vi.fn().mockResolvedValue("light" as const),
  backdropPollIntervalMs: 10,
  loadAccountMode: vi.fn().mockResolvedValue({ mode: "subscription" as const }),
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
  it("adapts when the API omits the five-hour quota", async () => {
    render(
      <App
        {...defaults}
        loadUsage={vi.fn().mockResolvedValue({
          ...ready,
          snapshot: {
            ...ready.snapshot,
            windows: [{ id: "seven_day", label: "7 days", usedPercent: 68 }],
          },
        })}
      />,
    );

    expect(await screen.findByText(/7 天窗口|7-day window/)).toBeInTheDocument();
    expect(screen.queryByText(/5 小时窗口|5-hour window/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });

  it("shows usage-limit reset opportunities separately from credits", async () => {
    render(
      <App
        {...defaults}
        loadUsage={vi.fn().mockResolvedValue({
          ...ready,
          snapshot: {
            ...ready.snapshot,
            resetCredits: {
              availableCount: 3,
              credits: [{ id: "reset-1", title: "Full reset", expiresAt: 2_000_000_000 }],
            },
          },
        })}
      />,
    );

    expect(await screen.findByText(/使用限额重置|Usage limit resets/)).toBeInTheDocument();
    expect(screen.getByText(/可用 3 次|3 available/)).toBeInTheDocument();
    expect(screen.queryByText("Full reset")).not.toBeInTheDocument();
  });

  it("collapses and expands usage-limit reset details", async () => {
    render(
      <App
        {...defaults}
        loadUsage={vi.fn().mockResolvedValue({
          ...ready,
          snapshot: {
            ...ready.snapshot,
            resetCredits: {
              availableCount: 1,
              credits: [{ id: "reset-1", title: "Full reset", expiresAt: 2_000_000_000 }],
            },
          },
        })}
      />,
    );

    const toggle = await screen.findByRole("button", { name: /使用限额重置|Usage limit resets/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Full reset")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Full reset")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /任务|Tasks/ }));
    fireEvent.click(screen.getByRole("button", { name: /用量|Usage/ }));
    const restoredToggle = screen.getByRole("button", {
      name: /使用限额重置|Usage limit resets/,
    });
    expect(restoredToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Full reset")).toBeInTheDocument();
  });

  it("separates usage and tasks into tabs", async () => {
    render(
      <App
        {...defaults}
        loadTasks={vi.fn().mockResolvedValue({
          queriedAt: Date.now(),
          tasks: [
            {
              id: "task-1",
              title: "重新设计额度窗口",
              project: "Token用量",
              status: "thinking" as const,
              startedAt: Date.now() - 10_000,
              updatedAt: Date.now(),
            },
            {
              id: "task-2",
              title: "修复幽灵任务",
              project: "Token用量",
              status: "executing" as const,
              startedAt: Date.now() - 20_000,
              updatedAt: Date.now(),
            },
          ],
        })}
      />,
    );

    expect(await screen.findByRole("button", { name: /任务|Tasks/ })).toBeInTheDocument();
    expect(screen.queryByText("重新设计额度窗口")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /任务|Tasks/ }));
    expect(await screen.findByText("重新设计额度窗口")).toBeInTheDocument();
    expect(screen.getByText("修复幽灵任务")).toBeInTheDocument();
    expect(screen.queryByText(/另有 1 个任务|1 more active/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows five recent completions and opens the selected Codex thread", async () => {
    const openTask = vi.fn().mockResolvedValue(undefined);
    const now = Date.now();
    render(
      <App
        {...defaults}
        openTask={openTask}
        loadTasks={vi.fn().mockResolvedValue({
          queriedAt: now,
          tasks: Array.from({ length: 6 }, (_, index) => ({
            id: `task-${index}`,
            sessionId: `019f0000-0000-7000-8000-00000000000${index}`,
            title: `完成任务 ${index + 1}`,
            project: "Token用量",
            status: "completed" as const,
            startedAt: now - 60_000,
            updatedAt: now - index * 1_000,
            completedAt: now - index * 1_000,
          })),
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /任务|Tasks/ }));
    expect(screen.getByText("完成任务 5")).toBeInTheDocument();
    expect(screen.queryByText("完成任务 6")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /完成任务 3.*Codex/ }));
    expect(openTask).toHaveBeenCalledWith("019f0000-0000-7000-8000-000000000002");
  });

  it("shows the detected subscription at the top and hides monetary credits", async () => {
    render(
      <App
        {...defaults}
        loadUsage={vi.fn().mockResolvedValue({
          ...ready,
          snapshot: {
            ...ready.snapshot,
            planType: "plus",
            credits: { hasCredits: true, unlimited: false, balance: "120" },
          },
        })}
      />,
    );

    expect(await screen.findByText(/PLUS 订阅|PLUS subscription/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Credits")).not.toBeInTheDocument();
  });

  it("shows monetary credits only in API mode when balance data is available", async () => {
    render(
      <App
        {...defaults}
        loadAccountMode={vi.fn().mockResolvedValue({ mode: "api" as const })}
        loadUsage={vi.fn().mockResolvedValue({
          ...ready,
          snapshot: {
            ...ready.snapshot,
            credits: { hasCredits: true, unlimited: false, balance: "120" },
          },
        })}
      />,
    );

    expect(await screen.findByText(/API 模式|API mode/)).toBeInTheDocument();
    expect(screen.getByLabelText("Credits")).toBeInTheDocument();
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

  it("saves whether the app icon appears in the Dock", async () => {
    const saveWindowPreferences = vi.fn(async (preferences: WindowPreferences) => preferences);
    render(<App {...defaults} saveWindowPreferences={saveWindowPreferences} />);
    await screen.findAllByRole("progressbar");
    fireEvent.click(screen.getByRole("button", { name: /设置|Settings/ }));
    fireEvent.click(screen.getByLabelText(/在 Dock 中显示图标|Show icon in Dock/));
    await waitFor(() =>
      expect(saveWindowPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ showDockIcon: true }),
      ),
    );
  });

  it("adapts to a dark surface behind the widget", async () => {
    render(<App {...defaults} detectBackdrop={vi.fn().mockResolvedValue("dark")} />);
    await waitFor(() => expect(document.querySelector("main")).toHaveClass("backdrop-dark"));
  });

  it("adapts to a light surface behind the widget", async () => {
    render(<App {...defaults} detectBackdrop={vi.fn().mockResolvedValue("light")} />);
    await waitFor(() => expect(document.querySelector("main")).toHaveClass("backdrop-light"));
  });

  it("changes after the surface behind the widget changes", async () => {
    const samples = ["light", "light", "dark", "dark"] as const;
    let index = 0;
    const detectBackdrop = vi.fn(async () => samples[Math.min(index++, samples.length - 1)]);
    render(<App {...defaults} detectBackdrop={detectBackdrop} />);

    await waitFor(() => expect(document.querySelector("main")).toHaveClass("backdrop-light"));
    await waitFor(() => expect(document.querySelector("main")).toHaveClass("backdrop-dark"));
    expect(detectBackdrop).toHaveBeenCalledTimes(4);
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

    expect(await screen.findByText("5h 58%")).toBeInTheDocument();
    expect(screen.queryByText("32%")).not.toBeInTheDocument();
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
    expect(await screen.findByText(/正在读取|Loading/)).toBeInTheDocument();
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

  it("shows the configured refresh interval without a glass control", async () => {
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
    expect(screen.queryByLabelText(/玻璃效果|Glass effect/)).not.toBeInTheDocument();
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
    expect(screen.getByRole("status")).toHaveTextContent(/空闲|Idle/);
  });

  it("serializes rapid refresh setting updates without losing the newest state", async () => {
    let resolveFirst: (() => void) | undefined;
    const saveSettings = vi.fn(
      (settings: RefreshSettings) =>
        new Promise<RefreshSettings>((resolve) => {
          resolveFirst = () => resolve(settings);
        }),
    );
    const saveInterval = vi.fn(async () => ({
      ...(await defaults.loadSettings()),
      intervalMinutes: 10,
      trayWindow: "seven_day" as const,
    }));
    render(<App {...defaults} saveSettings={saveSettings} saveInterval={saveInterval} />);
    await screen.findAllByRole("progressbar");
    fireEvent.click(screen.getByRole("button", { name: /设置|Settings/ }));
    fireEvent.change(screen.getByLabelText(/托盘显示周期|System tray window/), {
      target: { value: "seven_day" },
    });
    fireEvent.change(screen.getByLabelText(/自动刷新|Auto refresh/), {
      target: { value: "10" },
    });

    await waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());
    expect(saveInterval).not.toHaveBeenCalled();
    await act(async () => resolveFirst?.());
    await waitFor(() => expect(saveInterval).toHaveBeenCalledOnce());
    expect(screen.getByLabelText(/托盘显示周期|System tray window/)).toHaveValue("seven_day");
    expect(screen.getByLabelText(/自动刷新|Auto refresh/)).toHaveValue("10");
  });

  it("restores a setting and shows an error when saving fails", async () => {
    render(<App {...defaults} saveSettings={vi.fn().mockRejectedValue(new Error("disk full"))} />);
    await screen.findAllByRole("progressbar");
    fireEvent.click(screen.getByRole("button", { name: /设置|Settings/ }));
    const trayWindow = screen.getByLabelText(/托盘显示周期|System tray window/);
    fireEvent.change(trayWindow, { target: { value: "seven_day" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/保存失败|could not be saved/);
    expect(trayWindow).toHaveValue("five_hour");
  });
});
