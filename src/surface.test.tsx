import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeGlass, useSurfaceTone } from "./surface";

let dark = false;
let listeners: Set<() => void>;
const allowed = vi.fn(async () => true);
const read = vi.fn(async () => 0);

beforeEach(() => {
  vi.useFakeTimers();
  dark = false;
  listeners = new Set();
  vi.stubGlobal("matchMedia", () => ({
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  allowed.mockReset().mockResolvedValue(true);
  read.mockReset().mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

function changeSystem(next: boolean) {
  act(() => {
    dark = next;
    listeners.forEach((listener) => listener());
  });
}

describe("optional surface sampling", () => {
  it("uses the system appearance without reading the screen when access is denied", async () => {
    dark = true;
    allowed.mockResolvedValue(false);
    const { result } = renderHook(() => useSurfaceTone(allowed, read));
    await advance(0);
    expect(result.current).toBe("dark");
    expect(read).not.toHaveBeenCalled();
    changeSystem(false);
    expect(result.current).toBe("light");
    await advance(10_000);
    expect(read).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledTimes(3);
  });

  it("requires sustained samples before switching and tolerates borderline changes", async () => {
    const { result } = renderHook(() => useSurfaceTone(allowed, read));
    await advance(300);
    expect(result.current).toBe("light");
    await advance(300);
    expect(result.current).toBe("dark");
    read.mockResolvedValue(0.5);
    await advance(3_000);
    expect(result.current).toBe("dark");
    read.mockResolvedValue(1);
    await advance(1_500);
    expect(result.current).toBe("light");
  });

  it("does not flash themes when samples alternate around the boundary", async () => {
    let count = 0;
    read.mockImplementation(async () => (++count % 2 ? 0.39 : 0.61));
    const { result } = renderHook(() => useSurfaceTone(allowed, read));
    await advance(6_000);
    expect(result.current).toBe("light");
  });

  it("falls back after a rejected or invalid sample and backs off retries", async () => {
    const { result } = renderHook(() => useSurfaceTone(allowed, read));
    await advance(600);
    expect(result.current).toBe("dark");
    read.mockRejectedValueOnce(new Error("capture failed"));
    await advance(300);
    expect(result.current).toBe("light");
    const calls = read.mock.calls.length;
    await advance(4_900);
    expect(read).toHaveBeenCalledTimes(calls);
    read.mockResolvedValue(Number.NaN);
    await advance(100);
    expect(result.current).toBe("light");
    changeSystem(true);
    expect(result.current).toBe("dark");
  });

  it("stops reading after permission revocation", async () => {
    const { result } = renderHook(() => useSurfaceTone(allowed, read));
    await advance(600);
    expect(result.current).toBe("dark");
    const calls = read.mock.calls.length;
    allowed.mockResolvedValue(false);
    await advance(300);
    expect(result.current).toBe("light");
    expect(read).toHaveBeenCalledTimes(calls);
  });

  it("serializes captures and ignores late results after unmount", async () => {
    let finish: (n: number) => void = () => undefined;
    read.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount } = renderHook(() => useSurfaceTone(allowed, read));
    await advance(3_000);
    expect(read).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => finish(0));
    await advance(5_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});

describe("native glass confirmation", () => {
  it("starts with the safe surface and enables glass only after native confirmation", async () => {
    const sync = vi.fn(async () => true);
    const { result } = renderHook(() => useNativeGlass("dark", sync));
    expect(result.current).toBe(false);
    await advance(0);
    expect(result.current).toBe(true);
    expect(sync).toHaveBeenCalledWith(true);
  });

  it("retains the safe surface when unsupported or native synchronization fails", async () => {
    const sync = vi.fn(async () => false);
    const { result } = renderHook(() => useNativeGlass("light", sync));
    await advance(0);
    expect(result.current).toBe(false);
    sync.mockRejectedValue(new Error("native unavailable"));
    await advance(2_000);
    expect(result.current).toBe(false);
  });

  it("ignores old theme confirmations during rapid tone changes", async () => {
    let finishDark: (n: boolean) => void = () => undefined;
    const sync = vi.fn((dark: boolean) =>
      dark
        ? new Promise<boolean>((resolve) => {
            finishDark = resolve;
          })
        : Promise.resolve(false),
    );
    const { result, rerender } = renderHook(({ tone }) => useNativeGlass(tone, sync), {
      initialProps: { tone: "dark" as "light" | "dark" },
    });
    await advance(0);
    rerender({ tone: "light" });
    await advance(0);
    await act(async () => finishDark(true));
    expect(result.current).toBe(false);
  });

  it("falls back when native accessibility settings disable translucent surfaces", async () => {
    const sync = vi.fn(async () => true);
    const { result, unmount } = renderHook(() => useNativeGlass("light", sync));
    await advance(0);
    expect(result.current).toBe(true);
    sync.mockResolvedValue(false);
    await advance(2_000);
    expect(result.current).toBe(false);
    unmount();
    const calls = sync.mock.calls.length;
    await advance(4_000);
    expect(sync).toHaveBeenCalledTimes(calls);
  });
});
