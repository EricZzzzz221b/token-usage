import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getRefreshSettings,
  getUsage,
  onUsageUpdated,
  refreshUsage,
  setRefreshInterval,
  type RefreshSettings,
  type UsageView,
} from "./usage";

interface AppProps {
  loadUsage?: () => Promise<UsageView>;
  reloadUsage?: () => Promise<UsageView>;
  loadSettings?: () => Promise<RefreshSettings>;
  saveInterval?: (minutes: number) => Promise<RefreshSettings>;
  subscribe?: (handler: (view: UsageView) => void) => Promise<() => void>;
}

export default function App({
  loadUsage = getUsage,
  reloadUsage = refreshUsage,
  loadSettings = getRefreshSettings,
  saveInterval = setRefreshInterval,
  subscribe = onUsageUpdated,
}: AppProps) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<UsageView>({ status: "loading" });
  const [interval, setIntervalValue] = useState(5);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void loadUsage().then(setView);
    void loadSettings().then((settings) => setIntervalValue(settings.intervalMinutes));
    let active = true;
    let unlisten: (() => void) | undefined;
    void subscribe(setView).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [loadSettings, loadUsage, subscribe]);

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
      setIntervalValue(minutes);
      await saveInterval(minutes);
    },
    [saveInterval],
  );

  return (
    <main className="app-shell">
      <section className="glass-panel" aria-labelledby="app-title">
        <header>
          <div>
            <p className="eyebrow">CODEX</p>
            <h1 id="app-title">{t("appName")}</h1>
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              disabled={refreshing}
              onClick={() => void refresh()}
              type="button"
            >
              {refreshing ? "…" : "↻"}
              <span className="sr-only">{t("refresh")}</span>
            </button>
            <button
              className="language-button"
              onClick={() => void i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}
              type="button"
            >
              {i18n.language === "zh" ? "EN" : "中文"}
            </button>
          </div>
        </header>

        {view.status === "loading" && <p className="status-message">{t("loading")}</p>}
        {view.status === "error" && (
          <div className="error-state" role="alert">
            <strong>{t(`errors.${view.code}`, { defaultValue: t("errors.unknown") })}</strong>
            <button onClick={() => void refresh()} type="button">
              {t("retry")}
            </button>
          </div>
        )}
        {view.status === "ready" && (
          <>
            {view.stale && <p className="stale-notice">{t("stale")}</p>}
            <div className="usage-list">
              {view.snapshot.windows.map((window) => {
                const used = Math.round(window.usedPercent);
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
                      <span className="progress-fill" style={{ width: `${used}%` }} />
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        <div className="settings-row">
          <label htmlFor="refresh-interval">{t("refreshInterval")}</label>
          <select
            id="refresh-interval"
            onChange={(event) => void updateInterval(Number(event.target.value))}
            value={interval}
          >
            {[1, 5, 10, 15, 30, 60].map((minutes) => (
              <option key={minutes} value={minutes}>
                {t("minutes", { count: minutes })}
              </option>
            ))}
          </select>
        </div>
        <footer>{t("phaseTwo")}</footer>
      </section>
    </main>
  );
}
