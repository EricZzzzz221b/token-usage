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
      { id: "five_hour", label: "5 hours", usedPercent: 42 },
      { id: "seven_day", label: "7 days", usedPercent: 68 },
    ],
  },
};

const defaults = {
  loadUsage: vi.fn().mockResolvedValue(ready),
  reloadUsage: vi.fn().mockResolvedValue(ready),
  loadSettings: vi.fn().mockResolvedValue({ intervalMinutes: 5 }),
  saveInterval: vi.fn().mockResolvedValue({ intervalMinutes: 5 }),
  subscribe: vi.fn().mockResolvedValue(vi.fn()),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders usage returned by the coordinator", async () => {
    render(<App {...defaults} />);
    expect(await screen.findAllByRole("progressbar")).toHaveLength(2);
    expect(screen.getByText("68%")).toBeInTheDocument();
  });

  it("refreshes manually", async () => {
    const reloadUsage = vi.fn().mockResolvedValue(ready);
    render(<App {...defaults} reloadUsage={reloadUsage} />);
    fireEvent.click(screen.getByRole("button", { name: /立即刷新|Refresh now/ }));
    await waitFor(() => expect(reloadUsage).toHaveBeenCalledOnce());
  });

  it("saves a new refresh interval", async () => {
    const saveInterval = vi.fn().mockResolvedValue({ intervalMinutes: 10 });
    render(<App {...defaults} saveInterval={saveInterval} />);
    const select = await screen.findByLabelText(/自动刷新|Auto refresh/);
    fireEvent.change(select, { target: { value: "10" } });
    await waitFor(() => expect(saveInterval).toHaveBeenCalledWith(10));
  });
});
