import { useTranslation } from "react-i18next";

const windows = [
  { key: "fiveHour", used: 42 },
  { key: "sevenDay", used: 68 },
] as const;

export default function App() {
  const { t, i18n } = useTranslation();

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

        <div className="usage-list">
          {windows.map((window) => (
            <article className="usage-window" key={window.key}>
              <div className="usage-heading">
                <span>{t(`windows.${window.key}`)}</span>
                <strong>{window.used}%</strong>
              </div>
              <div
                aria-label={t("usedPercent", { value: window.used })}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={window.used}
                className="progress-track"
                role="progressbar"
              >
                <span className="progress-fill" style={{ width: `${window.used}%` }} />
              </div>
            </article>
          ))}
        </div>

        <footer>{t("phaseZero")}</footer>
      </section>
    </main>
  );
}
