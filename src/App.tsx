import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchUsage,
  normalizeInvokeError,
  type UsageErrorPayload,
  type UsageSnapshot,
} from "./usage";

interface AppProps {
  loadUsage?: () => Promise<UsageSnapshot>;
}

type ViewState =
  | { status: "loading" }
  | { status: "ready"; snapshot: UsageSnapshot }
  | { status: "error"; error: UsageErrorPayload };

export default function App({ loadUsage = fetchUsage }: AppProps) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<ViewState>({ status: "loading" });

  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", snapshot: await loadUsage() });
    } catch (error) {
      setState({ status: "error", error: normalizeInvokeError(error) });
    }
  }, [loadUsage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="app-shell">
      <section className="glass-panel" aria-labelledby="app-title">
        <header>
          <div>
            <p className="eyebrow">CODEX</p>
            <h1 id="app-title">{t("appName")}</h1>
          </div>
          <button
            className="language-button"
            onClick={() => void i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}
            type="button"
          >
            {i18n.language === "zh" ? "EN" : "中文"}
          </button>
        </header>

        {state.status === "loading" && <p className="status-message">{t("loading")}</p>}

        {state.status === "error" && (
          <div className="error-state" role="alert">
            <strong>
              {t(`errors.${state.error.code}`, { defaultValue: t("errors.unknown") })}
            </strong>
            <button onClick={() => void refresh()} type="button">
              {t("retry")}
            </button>
          </div>
        )}

        {state.status === "ready" && (
          <div className="usage-list">
            {state.snapshot.windows.map((window) => {
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
        )}

        <footer>{t("phaseOne")}</footer>
      </section>
    </main>
  );
}
