import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import {
  getRefreshSettings,
  getUsage,
  onRefreshSettingsChanged,
  onUsageUpdated,
  refreshUsage,
  setRefreshInterval,
  setRefreshSettings,
  type RefreshSettings,
  type UsageView,
} from "./usage";
import { enableUsage, ensureNotificationPermission, getAutostart, setAutostart } from "./system";
import {
  getBackdropTone,
  getWindowPreferences,
  onWindowModeChanged,
  onWindowPreferences,
  resizeWindowForView,
  setWindowPreferences,
  startWindowDrag,
  type BackdropTone,
  type WindowPreferences,
} from "./window";

const defaultWindowPreferences: WindowPreferences = {
  mode: "detailed",
  alwaysOnTop: true,
  locked: false,
  clickThrough: false,
  glassLevel: 0.5,
};

interface AppProps {
  loadUsage?: () => Promise<UsageView>;
  reloadUsage?: () => Promise<UsageView>;
  loadSettings?: () => Promise<RefreshSettings>;
  saveInterval?: (minutes: number) => Promise<RefreshSettings>;
  saveSettings?: (settings: RefreshSettings) => Promise<RefreshSettings>;
  subscribe?: (handler: (view: UsageView) => void) => Promise<() => void>;
  subscribeSettings?: (handler: (settings: RefreshSettings) => void) => Promise<() => void>;
  loadWindowPreferences?: () => Promise<WindowPreferences>;
  saveWindowPreferences?: (preferences: WindowPreferences) => Promise<WindowPreferences>;
  dragWindow?: () => Promise<void>;
  subscribeWindowPreferences?: (
    handler: (preferences: WindowPreferences) => void,
  ) => Promise<() => void>;
  subscribeWindowModeChanged?: (
    handler: (preferences: WindowPreferences) => void,
  ) => Promise<() => void>;
  loadAutostart?: () => Promise<boolean>;
  saveAutostart?: (enabled: boolean) => Promise<boolean>;
  loadAppVersion?: () => Promise<string>;
  authorizeUsage?: () => Promise<UsageView>;
  resizeView?: (view: "compact" | "detailed" | "settings") => Promise<void>;
  detectBackdrop?: () => Promise<BackdropTone>;
  backdropPollIntervalMs?: number;
}

function remainingPercent(usedPercent: number) {
  return Math.max(0, Math.min(100, 100 - Math.round(usedPercent)));
}

function riskClass(remaining: number) {
  if (remaining <= 0) return "limit";
  if (remaining <= 10) return "critical";
  if (remaining <= 30) return "warning";
  return "neutral";
}

function windowShortLabel(id: string) {
  if (id === "five_hour") return "5h";
  if (id === "seven_day") return "7d";
  if (id === "thirty_day") return "30d";
  return id;
}

export default function App({
  loadUsage = getUsage,
  reloadUsage = refreshUsage,
  loadSettings = getRefreshSettings,
  saveInterval = setRefreshInterval,
  saveSettings = setRefreshSettings,
  subscribe = onUsageUpdated,
  subscribeSettings = onRefreshSettingsChanged,
  loadWindowPreferences = getWindowPreferences,
  saveWindowPreferences = setWindowPreferences,
  dragWindow = startWindowDrag,
  subscribeWindowPreferences = onWindowPreferences,
  subscribeWindowModeChanged = onWindowModeChanged,
  loadAutostart = getAutostart,
  saveAutostart = setAutostart,
  loadAppVersion = getVersion,
  authorizeUsage = enableUsage,
  resizeView = resizeWindowForView,
  detectBackdrop = getBackdropTone,
  backdropPollIntervalMs = 350,
}: AppProps) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<UsageView>({ status: "loading" });
  const [settings, setSettings] = useState<RefreshSettings>({
    intervalMinutes: 5,
    usageEnabled: false,
    trayWindow: "five_hour",
    notifySeventy: false,
    notifyNinety: true,
    notifyHundred: true,
    notifyReset: false,
  });
  const [autostart, setAutostartValue] = useState(false);
  const [appVersion, setAppVersion] = useState("1.1.4");
  const [refreshing, setRefreshing] = useState(false);
  const [preferences, setPreferences] = useState(defaultWindowPreferences);
  const [screen, setScreen] = useState<"meter" | "settings">("meter");
  const preferencesRef = useRef(defaultWindowPreferences);
  const preferenceSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [backdropTone, setBackdropTone] = useState<BackdropTone>("light");

  useEffect(() => {
    let active = true;
    let detecting = false;
    let lastCandidate: BackdropTone | undefined;
    let matchingSamples = 0;
    const detect = () => {
      if (detecting || document.hidden) return;
      detecting = true;
      void detectBackdrop()
        .then((next) => {
          if (!active) return;
          if (next === lastCandidate) matchingSamples += 1;
          else {
            lastCandidate = next;
            matchingSamples = 1;
          }
          if (matchingSamples >= 2) setBackdropTone(next);
        })
        .catch(() => undefined)
        .finally(() => {
          detecting = false;
        });
    };
    detect();
    const timer = window.setInterval(detect, backdropPollIntervalMs);
    const detectWhenVisible = () => {
      if (!document.hidden) detect();
    };
    document.addEventListener("visibilitychange", detectWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", detectWhenVisible);
    };
  }, [backdropPollIntervalMs, detectBackdrop]);

  useEffect(() => {
    void loadUsage().then(setView);
    void loadSettings().then(setSettings);
    void loadAutostart().then(setAutostartValue);
    void loadAppVersion().then(setAppVersion);
    void loadWindowPreferences().then((next) => {
      preferencesRef.current = next;
      setPreferences(next);
    });
    let active = true;
    let unlisten: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;
    let unlistenWindow: (() => void) | undefined;
    let unlistenMode: (() => void) | undefined;
    void subscribe(setView).then((cleanup) => (active ? (unlisten = cleanup) : cleanup()));
    void subscribeSettings(setSettings).then((cleanup) =>
      active ? (unlistenSettings = cleanup) : cleanup(),
    );
    void subscribeWindowPreferences((next) => {
      preferencesRef.current = next;
      setPreferences(next);
    }).then((cleanup) => (active ? (unlistenWindow = cleanup) : cleanup()));
    void subscribeWindowModeChanged((next) => {
      preferencesRef.current = next;
      setPreferences(next);
      setScreen("meter");
    }).then((cleanup) => (active ? (unlistenMode = cleanup) : cleanup()));
    return () => {
      active = false;
      unlisten?.();
      unlistenSettings?.();
      unlistenWindow?.();
      unlistenMode?.();
    };
  }, [
    loadAutostart,
    loadAppVersion,
    loadSettings,
    loadUsage,
    loadWindowPreferences,
    subscribe,
    subscribeSettings,
    subscribeWindowPreferences,
    subscribeWindowModeChanged,
  ]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setView(await reloadUsage());
    } finally {
      setRefreshing(false);
    }
  }, [reloadUsage]);

  const authorize = useCallback(async () => {
    const next = await authorizeUsage();
    setView(next);
    setSettings((current) => ({ ...current, usageEnabled: true }));
  }, [authorizeUsage]);

  const updateSettings = useCallback(
    async (patch: Partial<RefreshSettings>) => {
      const enabling =
        patch.notifySeventy || patch.notifyNinety || patch.notifyHundred || patch.notifyReset;
      if (enabling && !(await ensureNotificationPermission())) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      await saveSettings(next);
    },
    [saveSettings, settings],
  );

  const updatePreferences = useCallback(
    (patch: Partial<WindowPreferences>) => {
      const next = { ...preferencesRef.current, ...patch };
      preferencesRef.current = next;
      setPreferences(next);
      const save = preferenceSaveQueue.current
        .catch(() => undefined)
        .then(() => saveWindowPreferences(next))
        .then((saved) => {
          if (preferencesRef.current === next) {
            preferencesRef.current = saved;
            setPreferences(saved);
          }
          return saved;
        });
      preferenceSaveQueue.current = save;
      return save;
    },
    [saveWindowPreferences],
  );

  const compact = preferences.mode === "compact" && screen === "meter";
  const textToneClass = `backdrop-${backdropTone}`;
  const platformClass = navigator.userAgent.includes("Windows") ? "platform-windows" : "";
  const readyWindows = view.status === "ready" ? view.snapshot.windows : [];

  const openSettings = () => {
    setScreen("settings");
    void resizeView("settings");
  };
  const closeSettings = async () => {
    await preferenceSaveQueue.current.catch(() => undefined);
    setScreen("meter");
    await resizeView(preferencesRef.current.mode);
  };
  const toggleWindowMode = () => {
    const nextMode = preferencesRef.current.mode === "compact" ? "detailed" : "compact";
    void updatePreferences({ mode: nextMode });
    void resizeView(nextMode);
  };

  const drag = (event: React.MouseEvent) => {
    if (event.button === 0 && !preferences.locked) void dragWindow();
  };

  if (compact) {
    return (
      <main className={`app-shell compact-shell ${textToneClass} ${platformClass}`}>
        <section className="liquid-panel compact-panel" onMouseDown={drag}>
          <strong className="brand-word">Codex</strong>
          {!settings.usageEnabled ? (
            <button
              className="compact-state-button"
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void authorize()}
            >
              {t("compactEnable")}
            </button>
          ) : view.status === "loading" ? (
            <span className="compact-state" role="status">
              {t("compactLoading")}
            </span>
          ) : view.status === "error" ? (
            <button
              className="compact-state-button risk-text-critical"
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void refresh()}
            >
              {t("compactRetry")}
            </button>
          ) : (
            readyWindows.map((window, index) => {
              const remaining = remainingPercent(window.usedPercent);
              return (
                <span className="compact-metric" key={window.id}>
                  {index > 0 && <span className="metric-dot">·</span>}
                  <span className="metric-label">{windowShortLabel(window.id)}</span>
                  <strong className={`metric-value risk-text-${riskClass(remaining)}`}>
                    {remaining}%
                  </strong>
                </span>
              );
            })
          )}
          <button
            className="compact-mode-toggle"
            type="button"
            aria-label={t("switchToStandard")}
            title={t("switchToStandard")}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={toggleWindowMode}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M2.5 5.25h8m-2.5-2.5 2.5 2.5-2.5 2.5M13.5 10.75h-8m2.5-2.5-2.5 2.5 2.5 2.5" />
            </svg>
          </button>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${screen === "settings" ? "settings-shell" : "detail-shell"} ${textToneClass} ${platformClass}`}
    >
      <section className="liquid-panel">
        <header className="titlebar" onMouseDown={drag}>
          <h1>{screen === "settings" ? t("settingsTitle") : t("meterTitle")}</h1>
          <div className="title-actions" onMouseDown={(event) => event.stopPropagation()}>
            {screen === "settings" ? (
              <button className="text-action" type="button" onClick={() => void closeSettings()}>
                {t("done")}
              </button>
            ) : (
              <>
                <button
                  className="text-action"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                  type="button"
                >
                  {refreshing ? t("refreshing") : t("refresh")}
                </button>
                <button
                  className="icon-action mode-toggle-action"
                  type="button"
                  aria-label={t("switchToCompact")}
                  title={t("switchToCompact")}
                  onClick={toggleWindowMode}
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16">
                    <path d="M2.5 5.25h8m-2.5-2.5 2.5 2.5-2.5 2.5M13.5 10.75h-8m2.5-2.5-2.5 2.5 2.5 2.5" />
                  </svg>
                </button>
                <button className="text-action" onClick={openSettings} type="button">
                  {t("settingsTitle")}
                </button>
              </>
            )}
          </div>
        </header>

        {screen === "settings" ? (
          <div className="settings-scroll">
            <SettingsGroup title={t("appearanceGroup")}>
              <SelectRow
                label={t("windowMode")}
                value={preferences.mode}
                onChange={(value) =>
                  void updatePreferences({ mode: value as WindowPreferences["mode"] })
                }
                options={[
                  ["compact", t("compact")],
                  ["detailed", t("detailed")],
                ]}
              />
              <label className="setting-row glass-level-row">
                <span>{t("glassEffect")}</span>
                <span className="glass-level-control">
                  <input
                    aria-label={t("glassEffect")}
                    aria-valuetext={t("glassEffectValue", {
                      value: Math.round(preferences.glassLevel * 100),
                    })}
                    min="0"
                    max="1"
                    step="0.01"
                    type="range"
                    value={preferences.glassLevel}
                    onChange={(event) =>
                      void updatePreferences({ glassLevel: Number(event.target.value) })
                    }
                  />
                  <span className="glass-level-scale" aria-hidden="true">
                    <span>{t("clear")}</span>
                    <span>{t("standard")}</span>
                  </span>
                </span>
              </label>
              <ToggleRow
                label={t("alwaysOnTop")}
                checked={preferences.alwaysOnTop}
                onChange={(checked) => void updatePreferences({ alwaysOnTop: checked })}
              />
              <ToggleRow
                label={t("lockPosition")}
                checked={preferences.locked}
                onChange={(checked) => void updatePreferences({ locked: checked })}
              />
              <ToggleRow
                label={t("clickThrough")}
                checked={preferences.clickThrough}
                onChange={(checked) => void updatePreferences({ clickThrough: checked })}
              />
            </SettingsGroup>
            <SettingsGroup title={t("dataGroup")}>
              <SelectRow
                label={t("trayWindow")}
                value={settings.trayWindow}
                onChange={(value) =>
                  void updateSettings({
                    trayWindow: value as RefreshSettings["trayWindow"],
                  })
                }
                options={[
                  ["five_hour", t("trayFiveHour")],
                  ["seven_day", t("traySevenDay")],
                ]}
              />
              <SelectRow
                label={t("refreshInterval")}
                value={String(settings.intervalMinutes)}
                onChange={(value) => {
                  const minutes = Number(value);
                  setSettings((current) => ({ ...current, intervalMinutes: minutes }));
                  void saveInterval(minutes);
                }}
                options={[1, 5, 10, 15, 30, 60].map((minutes) => [
                  String(minutes),
                  t("minutes", { count: minutes }),
                ])}
              />
            </SettingsGroup>
            <SettingsGroup title={t("notificationsGroup")}>
              <ToggleRow
                label={t("notify70")}
                checked={settings.notifySeventy}
                onChange={(checked) => void updateSettings({ notifySeventy: checked })}
              />
              <ToggleRow
                label={t("notify90")}
                checked={settings.notifyNinety}
                onChange={(checked) => void updateSettings({ notifyNinety: checked })}
              />
              <ToggleRow
                label={t("notify100")}
                checked={settings.notifyHundred}
                onChange={(checked) => void updateSettings({ notifyHundred: checked })}
              />
              <ToggleRow
                label={t("notifyReset")}
                checked={settings.notifyReset}
                onChange={(checked) => void updateSettings({ notifyReset: checked })}
              />
            </SettingsGroup>
            <SettingsGroup title={t("systemGroup")}>
              <ToggleRow
                label={t("launchAtLogin")}
                checked={autostart}
                onChange={(checked) => {
                  setAutostartValue(checked);
                  void saveAutostart(checked);
                }}
              />
              <button
                className="setting-row row-button"
                type="button"
                onClick={() => void i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}
              >
                <span>{t("language")}</span>
                <span className="row-value">{i18n.language === "zh" ? "简体中文" : "English"}</span>
              </button>
            </SettingsGroup>
            <div className="about-meta">
              <span>
                {t("appName")} v{appVersion}
              </span>
              <span>{t("author", { value: "Eric Zhang" })}</span>
            </div>
          </div>
        ) : (
          <MeterContent
            view={view}
            usageEnabled={settings.usageEnabled}
            stale={view.status === "ready" && view.stale}
            intervalMinutes={settings.intervalMinutes}
            locale={i18n.language}
            onRefresh={refresh}
            onAuthorize={authorize}
            t={t}
          />
        )}
      </section>
    </main>
  );
}

function MeterContent({
  view,
  usageEnabled,
  stale,
  intervalMinutes,
  locale,
  onRefresh,
  onAuthorize,
  t,
}: {
  view: UsageView;
  usageEnabled: boolean;
  stale: boolean;
  intervalMinutes: number;
  locale: string;
  onRefresh: () => Promise<void>;
  onAuthorize: () => Promise<void>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!usageEnabled)
    return (
      <div className="state-card">
        <strong>{t("privacyTitle")}</strong>
        <p>{t("privacyBody")}</p>
        <button type="button" onClick={() => void onAuthorize()}>
          {t("enableUsage")}
        </button>
      </div>
    );
  if (view.status === "loading") return <p className="status-message">{t("loading")}</p>;
  if (view.status === "error")
    return (
      <div className="state-card error-state" role="alert">
        <strong>{t(`errors.${view.code}`, { defaultValue: t("errors.unknown") })}</strong>
        <button type="button" onClick={() => void onRefresh()}>
          {t("retry")}
        </button>
      </div>
    );
  return (
    <div className="meter-content">
      {stale && <p className="stale-notice">{t("stale")}</p>}
      <div className="usage-list">
        {view.snapshot.windows.map((window) => {
          const used = Math.round(window.usedPercent);
          const remaining = remainingPercent(window.usedPercent);
          return (
            <article className="usage-window" key={window.id}>
              <div className="usage-heading">
                <strong>{t(`windows.${window.id}`, { defaultValue: window.label })}</strong>
                <strong className={`risk-text-${riskClass(remaining)}`}>{remaining}%</strong>
              </div>
              <div
                aria-label={t("remainingPercent", { value: remaining })}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={remaining}
                className={`progress-track risk-track-${riskClass(remaining)}`}
                role="progressbar"
              >
                <span
                  className={`progress-fill risk-fill-${riskClass(remaining)}`}
                  style={{ width: `${remaining}%` }}
                />
              </div>
              <div className="usage-meta">
                <span>{t("used", { value: used })}</span>
                {window.resetAt && (
                  <span>
                    {t("resetsShort", {
                      value: new Date(window.resetAt * 1000).toLocaleString([], {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    })}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <footer>
        {t("updatedAt", {
          value: new Intl.DateTimeFormat(locale, {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(view.snapshot.queriedAt)),
        })}
        <span>·</span>
        {t("autoRefresh", { value: intervalMinutes })}
      </footer>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <input checked={checked} type="checkbox" onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([optionValue, text]) => (
          <option value={optionValue} key={optionValue}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
