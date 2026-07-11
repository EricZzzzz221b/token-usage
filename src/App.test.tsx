import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import "./i18n";

describe("App", () => {
  it("renders both usage windows", () => {
    render(<App />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });
});
