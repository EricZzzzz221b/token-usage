import { useEffect, useRef, useState } from "react";

export type SurfaceTone = "light" | "dark";

function systemTone(): SurfaceTone {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

/** Screen sampling is optional and returns only a scalar; never request access here. */
export function useSurfaceTone(
  hasScreenAccess: () => Promise<boolean>,
  readLuminance: () => Promise<number>,
  pollIntervalMs = 300,
): SurfaceTone {
  const [tone, setTone] = useState<SurfaceTone>(systemTone);
  const toneRef = useRef(tone);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let sampling = false;
    let hasBackdrop = false;
    let smoothed: number | undefined;
    let candidate: SurfaceTone | undefined;
    let candidateSince = 0;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = (next: SurfaceTone) => {
      if (!active) return;
      toneRef.current = next;
      setTone(next);
    };
    const fallback = () => {
      if (!active) return;
      hasBackdrop = false;
      smoothed = undefined;
      candidate = undefined;
      apply(systemTone());
    };
    const systemChanged = () => {
      if (!hasBackdrop) apply(systemTone());
    };
    const sample = async () => {
      if (!active || sampling || document.hidden) return;
      sampling = true;
      let delay = Math.max(100, pollIntervalMs);
      try {
        // Recheck permission before each read so revocation never triggers a capture request.
        if (!(await hasScreenAccess())) {
          fallback();
          delay = 5_000;
          return;
        }
        if (!active) return;
        const luminance = await readLuminance();
        if (!active) return;
        if (!Number.isFinite(luminance) || luminance < 0 || luminance > 1) {
          throw new Error("Invalid backdrop sample");
        }
        hasBackdrop = true;
        smoothed = smoothed === undefined ? luminance : smoothed * 0.72 + luminance * 0.28;
        const next =
          toneRef.current === "dark" && smoothed > 0.58
            ? "light"
            : toneRef.current === "light" && smoothed < 0.42
              ? "dark"
              : toneRef.current;
        if (next === toneRef.current) {
          candidate = undefined;
        } else if (candidate !== next) {
          candidate = next;
          candidateSince = Date.now();
        } else if (Date.now() - candidateSince >= 600) {
          apply(next);
          candidate = undefined;
        }
      } catch {
        fallback();
        delay = 5_000;
      } finally {
        sampling = false;
        if (active) timer = window.setTimeout(() => void sample(), delay);
      }
    };
    const visible = () => {
      if (document.hidden || sampling) return;
      if (timer !== undefined) window.clearTimeout(timer);
      void sample();
    };
    media?.addEventListener("change", systemChanged);
    document.addEventListener("visibilitychange", visible);
    void sample();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      media?.removeEventListener("change", systemChanged);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [hasScreenAccess, readLuminance, pollIntervalMs]);

  return tone;
}

/** Thin CSS surfaces are allowed only after native glass confirms this tone. */
export function useNativeGlass(
  tone: SurfaceTone,
  sync: (dark: boolean) => Promise<boolean>,
): boolean {
  const [confirmedTone, setConfirmedTone] = useState<SurfaceTone>();
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const update = async () => {
      try {
        const ready = await sync(tone === "dark");
        if (active) setConfirmedTone(ready ? tone : undefined);
      } catch {
        if (active) setConfirmedTone(undefined);
      } finally {
        // Pick up accessibility changes and material reattachment after resize.
        if (active) timer = window.setTimeout(() => void update(), 2_000);
      }
    };
    void update();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [tone, sync]);
  return confirmedTone === tone;
}
