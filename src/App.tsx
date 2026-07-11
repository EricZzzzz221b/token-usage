import { useCallback, useEffect, useMemo, useState } from "react";
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
  onWindowPreferences,
  setWindowPreferences,
  startWindowDrag,
  type WindowPreferences,
} from "./window";

const defaultWindowPreferences: WindowPreferences = {
  mode: "detailed",
  alwaysOnTop: true,
  locked: false,
  clickThrough: false,
  opacity: 0.86,
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
  loadAutostart?: () => Promise<boolean>;
  saveAutostart?: (enabled: boolean) => Promise<boolean>;
  authorizeUsage?: () => Promise<UsageView>;
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
  loadAutostart = getAutostart,
  saveAutostart = setAutostart,
  authorizeUsage = enableUsage,
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
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    void loadUsage().then(setView);
    void loadSettings().then(setSettings);
    void loadAutostart().then(setAutostartValue);
    void loadWindowPreferences().then(setPreferences);
    let active = true;
    let unlisten: (() => void) | undefined;
    let unlistenWindow: (() => void) | undefined;
    void subscribe(setView).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    void subscribeWindowPreferences(setPreferences).then((cleanup) => {
      if (active) unlistenWindow = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      unlisten?.();
      unlistenWindow?.();
    };
  }, [
    loadAutostart,
    loadSettings,
    loadUsage,
    loadWindowPreferences,
    subscribe,
    subscribeWindowPreferences,
  ]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setView(await reloadUsage());
    } finally {
      setRefreshing(false);
    }
  }, [reloadUsage]);
  const updateInterval = useCallback(
    async (minutes: number) => {
      setSettings((value) => ({ ...value, intervalMinutes: minutes }));
      await saveInterval(minutes);
    },
    [saveInterval],
  );
  const updateSettings = useCallback(
    async (patch: Partial<RefreshSettings>) => {
      const enablingNotification =
        (patch.notifySeventy ?? false) ||
        (patch.notifyNinety ?? false) ||
        (patch.notifyHundred ?? false) ||
        (patch.notifyReset ?? false);
      if (enablingNotification && !(await ensureNotificationPermission())) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      await saveSettings(next);
    },
    [saveSettings, settings],
  );
  const updatePreferences = useCallback(
    async (patch: Partial<WindowPreferences>) => {
      const next = { ...preferences, ...patch };
      setPreferences(next);
      await saveWindowPreferences(next);
    },
    [preferences, saveWindowPreferences],
  );

  const panelStyle = useMemo(
    () => ({ "--panel-opacity": String(preferences.opacity) }) as React.CSSProperties,
    [preferences.opacity],
  );
  const compact = preferences.mode === "compact";

  return (
    <main className={`app-shell ${compact ? "is-compact" : "is-detailed"}`} style={panelStyle}>
      <section
        className={`glass-panel glass-${preferences.glassStrength}`}
        aria-labelledby="app-title"
      >
        <header
          className="drag-region"
          onMouseDown={(event) => {
            if (event.button === 0 && !preferences.locked) void dragWindow();
          }}
        >
          <div>
            <p className="eyebrow">CODEX</p>
            <h1 id="app-title">{t("appName")}</h1>
          </div>
          <div className="header-actions" onMouseDown={(event) => event.stopPropagation()}>
            <button
              className="icon-button"
              disabled={refreshing}
              onClick={() => void refresh()}
              type="button"
            >
              {refreshing ? "…" : "↻"}
              <span className="sr-only">{t("refresh")}</span>
            </button>
            {!compact && (
              <button
                className="icon-button"
                onClick={() => setShowControls((value) => !value)}
                type="button"
              >
                ⌁<span className="sr-only">{t("windowControls")}</span>
              </button>
            )}
          </div>
        </header>

        {!settings.usageEnabled ? (
          <div className="onboarding" role="dialog">
            <strong>{t("privacyTitle")}</strong>
            <p>{t("privacyBody")}</p>
            <button
              type="button"
              onClick={() =>
                void ensureNotificationPermission()
                  .then(() => authorizeUsage())
                  .then((next) => {
                    setView(next);
                    setSettings((value) => ({ ...value, usageEnabled: true }));
                  })
              }
            >
              {t("enableUsage")}
            </button>
          </div>
        ) : (
          view.status === "loading" && <p className="status-message">{t("loading")}</p>
        )}
        {settings.usageEnabled && view.status === "error" && (
          <div className="error-state" role="alert">
            <strong>{t(`errors.${view.code}`, { defaultValue: t("errors.unknown") })}</strong>
            <button onClick={() => void refresh()} type="button">
              {t("retry")}
            </button>
          </div>
        )}
        {settings.usageEnabled && view.status === "ready" && (
          <>
            {view.stale && <p className="stale-notice">{t("stale")}</p>}
            <div className="usage-list">
              {view.snapshot.windows.map((window) => {
                const used = Math.round(window.usedPercent);
                const remaining = Math.max(0, 100 - used);
                return (
                  <article className="usage-window" key={window.id}>
                    <div className="usage-heading">
                      <span>{t(`windows.${window.id}`, { defaultValue: window.label })}</span>
                      <strong>{used}%</strong>
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
                        className={`progress-fill risk-${used >= 90 ? "critical" : used >= 70 ? "warning" : "healthy"}`}
                        style={{ width: `${used}%` }}
                      />
                    </div>
                    {!compact && (
                      <div className="usage-meta">
                        <span>{t("remaining", { value: remaining })}</span>
                        {window.resetAt && (
                          <span>
                            {t("resets", {
                              value: new Date(window.resetAt * 1000).toLocaleString(),
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}

        {!compact && showControls && (
          <div className="control-sheet">
            <label>
              <span>{t("windowMode")}</span>
              <select
                value={preferences.mode}
                onChange={(event) =>
                  void updatePreferences({ mode: event.target.value as WindowPreferences["mode"] })
                }
              >
                <option value="compact">{t("compact")}</option>
                <option value="detailed">{t("detailed")}</option>
              </select>
            </label>
            <label>
              <span>{t("glassStrength")}</span>
              <select
                value={preferences.glassStrength}
                onChange={(event) =>
                  void updatePreferences({
                    glassStrength: event.target.value as WindowPreferences["glassStrength"],
                  })
                }
              >
                <option value="clear">{t("clear")}</option>
                <option value="standard">{t("standard")}</option>
                <option value="rich">{t("rich")}</option>
              </select>
            </label>
            <label>
              <span>{t("opacity")}</span>
              <input
                min="0.55"
                max="1"
                step="0.05"
                type="range"
                value={preferences.opacity}
                onChange={(event) =>
                  void updatePreferences({ opacity: Number(event.target.value) })
                }
              />
            </label>
            <label className="toggle-row">
              <span>{t("alwaysOnTop")}</span>
              <input
                checked={preferences.alwaysOnTop}
                type="checkbox"
                onChange={(event) => void updatePreferences({ alwaysOnTop: event.target.checked })}
              />
            </label>
            <label className="toggle-row">
              <span>{t("lockPosition")}</span>
              <input
                checked={preferences.locked}
                type="checkbox"
                onChange={(event) => void updatePreferences({ locked: event.target.checked })}
              />
            </label>
            <label className="toggle-row">
              <span>{t("clickThrough")}</span>
              <input
                checked={preferences.clickThrough}
                type="checkbox"
                onChange={(event) => void updatePreferences({ clickThrough: event.target.checked })}
              />
            </label>
            <label>
              <span>{t("refreshInterval")}</span>
              <select
                onChange={(event) => void updateInterval(Number(event.target.value))}
                value={settings.intervalMinutes}
              >
                {[1, 5, 10, 15, 30, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {t("minutes", { count: minutes })}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle-row">
              <span>{t("notify70")}</span>
              <input
                checked={settings.notifySeventy}
                type="checkbox"
                onChange={(e) => void updateSettings({ notifySeventy: e.target.checked })}
              />
            </label>
            <label className="toggle-row">
              <span>{t("notify90")}</span>
              <input
                checked={settings.notifyNinety}
                type="checkbox"
                onChange={(e) => void updateSettings({ notifyNinety: e.target.checked })}
              />
            </label>
            <label className="toggle-row">
              <span>{t("notify100")}</span>
              <input
                checked={settings.notifyHundred}
                type="checkbox"
                onChange={(e) => void updateSettings({ notifyHundred: e.target.checked })}
              />
            </label>
            <label className="toggle-row">
              <span>{t("notifyReset")}</span>
              <input
                checked={settings.notifyReset}
                type="checkbox"
                onChange={(e) => void updateSettings({ notifyReset: e.target.checked })}
              />
            </label>
            <label className="toggle-row">
              <span>{t("launchAtLogin")}</span>
              <input
                checked={autostart}
                type="checkbox"
                onChange={(e) => {
                  setAutostartValue(e.target.checked);
                  void saveAutostart(e.target.checked);
                }}
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void exportDiagnosticReport()}
            >
              {t("diagnostics")}
            </button>
            <button
              className="language-button"
              onClick={() => void i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}
              type="button"
            >
              {i18n.language === "zh" ? "English" : "中文"}
            </button>
          </div>
        )}
        <footer>{compact ? t("compactHint") : t("phaseThree")}</footer>
      </section>
    </main>
  );
}
