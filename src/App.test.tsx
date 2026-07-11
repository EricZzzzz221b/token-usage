import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import "./i18n";

describe("App", () => {
  it("renders usage returned by the Rust boundary", async () => {
    render(
      <App
        loadUsage={vi.fn().mockResolvedValue({
          source: "codex_oauth",
          queriedAt: Date.now(),
          windows: [
            { id: "five_hour", label: "5 hours", usedPercent: 42 },
            { id: "seven_day", label: "7 days", usedPercent: 68 },
          ],
        })}
      />,
    );
    expect(await screen.findAllByRole("progressbar")).toHaveLength(2);
    expect(screen.getByText("68%")).toBeInTheDocument();
  });

  it("shows a recoverable authentication error", async () => {
    render(
      <App
        loadUsage={vi.fn().mockRejectedValue({
          code: "authentication_expired",
          message: "fixture only",
        })}
      />,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新尝试|Try again/ })).toBeInTheDocument();
  });
});
