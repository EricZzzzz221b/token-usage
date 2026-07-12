import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getRefreshSettings,
  getUsage,
  onUsageUpdated,
  refreshUsage,
  setRefreshInterval,
  setRefreshSettings,
  type RefreshSettings,
  type UsageView,
} from "./usage";
import {
  enableUsage,
  ensureNotificationPermission,
  exportDiagnosticReport,
  getAutostart,
  setAutostart,
} from "./system";
import {
  getWindowPreferences,
  onWindowModeChanged,
  onWindowPreferences,
  resizeWindowForView,
  setWindowPreferences,
  startWindowDrag,
  type WindowPreferences,
} from "./window";

const defaultWindowPreferences: WindowPreferences = {
  mode: "detailed",
  alwaysOnTop: true,
  locked: false,
  clickThrough: false,
  opacity: 0.75,
  glassStrength: "standard",
};

interface AppProps {
  loadUsage?: () => Promise<UsageView>;
  reloadUsage?: () => Promise<UsageView>;
  loadSettings?: () => Promise<RefreshSettings>;
  saveInterval?: (minutes: number) => Promise<RefreshSettings>;
  saveSettings?: (settings: RefreshSettings) => Promise<RefreshSettings>;
  subscribe?: (handler: (view: UsageView) => void) => Promise<() => void>;
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
  authorizeUsage?: () => Promise<UsageView>;
  resizeView?: (view: "compact" | "detailed" | "settings") => Promise<void>;
}

function riskClass(value: number) {
  if (value >= 100) return "limit";
  if (value >= 90) return "critical";
  if (value >= 70) return "warning";
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
  loadWindowPreferences = getWindowPreferences,
  saveWindowPreferences = setWindowPreferences,
  dragWindow = startWindowDrag,
  subscribeWindowPreferences = onWindowPreferences,
  subscribeWindowModeChanged = onWindowModeChanged,
  loadAutostart = getAutostart,
  saveAutostart = setAutostart,
  authorizeUsage = enableUsage,
  resizeView = resizeWindowForView,
}: AppProps) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<UsageView>({ status: "loading" });
  const [settings, setSettings] = useState<RefreshSettings>({
    intervalMinutes: 5,
    usageEnabled: false,
    notifySeventy: false,
    notifyNinety: true,
    notifyHundred: true,
    notifyReset: false,
  });
  const [autostart, setAutostartValue] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [preferences, setPreferences] = useState(defaultWindowPreferences);
  const [screen, setScreen] = useState<"meter" | "settings">("meter");
  const preferencesRef = useRef(defaultWindowPreferences);
  const preferenceSaveQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    void loadUsage().then(setView);
    void loadSettings().then(setSettings);
    void loadAutostart().then(setAutostartValue);
    void loadWindowPreferences().then((next) => {
      preferencesRef.current = next;
      setPreferences(next);
    });
    let active = true;
    let unlisten: (() => void) | undefined;
    let unlistenWindow: (() => void) | undefined;
    let unlistenMode: (() => void) | undefined;
    void subscribe(setView).then((cleanup) => (active ? (unlisten = cleanup) : cleanup()));
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
      unlistenWindow?.();
      unlistenMode?.();
    };
  }, [
    loadAutostart,
    loadSettings,
    loadUsage,
    loadWindowPreferences,
    subscribe,
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

  const drag = (event: React.MouseEvent) => {
    if (event.button === 0 && !preferences.locked) void dragWindow();
  };

  if (compact) {
    return (
      <main className="app-shell compact-shell">
        <section
          className={`liquid-panel compact-panel glass-${preferences.glassStrength}`}
          onMouseDown={drag}
        >
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
              const used = Math.round(window.usedPercent);
              return (
                <span className="compact-metric" key={window.id}>
                  {index > 0 && <span className="metric-dot">·</span>}
                  <span className="metric-label">{windowShortLabel(window.id)}</span>
                  <strong className={`metric-value risk-text-${riskClass(used)}`}>{used}%</strong>
                </span>
              );
            })
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${screen === "settings" ? "settings-shell" : "detail-shell"}`}>
      <section className={`liquid-panel glass-${preferences.glassStrength}`}>
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
              <SelectRow
                label={t("glassStrength")}
                value={preferences.glassStrength}
                onChange={(value) =>
                  void updatePreferences({
                    glassStrength: value as WindowPreferences["glassStrength"],
                  })
                }
                options={[
                  ["clear", t("clear")],
                  ["standard", t("standard")],
                ]}
              />
              <label className="setting-row">
                <span>{t("opacity")}</span>
                <input
                  aria-label={t("opacity")}
                  min="0.55"
                  max="1"
                  step="0.05"
                  type="range"
                  value={preferences.opacity}
                  onChange={(e) => void updatePreferences({ opacity: Number(e.target.value) })}
                />
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
              <button
                className="setting-row row-button"
                type="button"
                onClick={() => void exportDiagnosticReport()}
              >
                <span>{t("diagnostics")}</span>
                <span className="row-value">{t("export")}</span>
              </button>
            </SettingsGroup>
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
          const remaining = Math.max(0, 100 - used);
          return (
            <article className="usage-window" key={window.id}>
              <div className="usage-heading">
                <strong>{t(`windows.${window.id}`, { defaultValue: window.label })}</strong>
                <strong className={`risk-text-${riskClass(used)}`}>{used}%</strong>
              </div>
              <div
                aria-label={t("usedPercent", { value: used })}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={used}
                className="progress-track"
                role="progressbar"
              >
                <span
                  className={`progress-fill risk-fill-${riskClass(used)}`}
                  style={{ width: `${used}%` }}
                />
              </div>
              <div className="usage-meta">
                <span>{t("remaining", { value: remaining })}</span>
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
