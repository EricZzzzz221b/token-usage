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

  useEffect(() => {
    void loadUsage().then(setView);
    void loadSettings().then(setSettings);
    void loadAutostart().then(setAutostartValue);
    void loadWindowPreferences().then(setPreferences);
    let active = true;
    let unlisten: (() => void) | undefined;
    let unlistenWindow: (() => void) | undefined;
    void subscribe(setView).then((cleanup) => (active ? (unlisten = cleanup) : cleanup()));
    void subscribeWindowPreferences(setPreferences).then((cleanup) =>
      active ? (unlistenWindow = cleanup) : cleanup(),
    );
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
    async (patch: Partial<WindowPreferences>) => {
      const next = { ...preferences, ...patch };
      setPreferences(next);
      await saveWindowPreferences(next);
    },
    [preferences, saveWindowPreferences],
  );

  const compact = preferences.mode === "compact" && screen === "meter";
  const panelStyle = useMemo(
    () => ({ "--panel-opacity": String(preferences.opacity) }) as React.CSSProperties,
    [preferences.opacity],
  );
  const readyWindows = view.status === "ready" ? view.snapshot.windows : [];

  const openSettings = () => {
    setScreen("settings");
    void resizeView("settings");
  };
  const closeSettings = () => {
    setScreen("meter");
    void resizeView(preferences.mode);
  };

  const drag = (event: React.MouseEvent) => {
    if (event.button === 0 && !preferences.locked) void dragWindow();
  };

  if (compact && settings.usageEnabled && view.status === "ready") {
    return (
      <main className="app-shell compact-shell" style={panelStyle}>
        <section
          className={`liquid-panel compact-panel glass-${preferences.glassStrength}`}
          onMouseDown={drag}
        >
          <strong className="brand-word">Codex</strong>
          {readyWindows.map((window, index) => {
            const used = Math.round(window.usedPercent);
            return (
              <span className="compact-metric" key={window.id}>
                {index > 0 && <span className="metric-dot">·</span>}
                <span className="metric-label">{windowShortLabel(window.id)}</span>
                <strong className={`metric-value risk-text-${riskClass(used)}`}>{used}%</strong>
              </span>
            );
          })}
        </section>
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${screen === "settings" ? "settings-shell" : "detail-shell"}`}
      style={panelStyle}
    >
      <section className={`liquid-panel glass-${preferences.glassStrength}`}>
        <header className="titlebar" onMouseDown={drag}>
          <h1>{screen === "settings" ? t("settingsTitle") : t("meterTitle")}</h1>
          <div className="title-actions" onMouseDown={(event) => event.stopPropagation()}>
            {screen === "settings" ? (
              <button className="text-action" type="button" onClick={closeSettings}>
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
            onRefresh={refresh}
            onAuthorize={async () => {
              const next = await authorizeUsage();
              setView(next);
              setSettings((current) => ({ ...current, usageEnabled: true }));
            }}
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
  onRefresh,
  onAuthorize,
  t,
}: {
  view: UsageView;
  usageEnabled: boolean;
  stale: boolean;
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
        {t("updatedNow")}
        <span>·</span>
        {t("autoRefresh", { value: 5 })}
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
