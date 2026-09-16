import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildHistoryPath,
  clearUsageHistory,
  exportUsageHistory,
  getUsageHistory,
  type HistoryRange,
  type UsageHistorySeries,
} from "./history";
import type { UsageWindow } from "./usage";

interface HistoryPanelProps {
  windows: UsageWindow[];
  locale: string;
  refreshKey: number;
  loadHistory?: (range: HistoryRange, windowId: string) => Promise<UsageHistorySeries>;
  exportHistory?: (range: HistoryRange, windowId: string) => Promise<boolean>;
  clearHistory?: () => Promise<void>;
}

const ranges: HistoryRange[] = ["one_day", "seven_days", "thirty_days"];

export default function HistoryPanel({
  windows,
  locale,
  refreshKey,
  loadHistory = getUsageHistory,
  exportHistory = exportUsageHistory,
  clearHistory = clearUsageHistory,
}: HistoryPanelProps) {
  const { t } = useTranslation();
  const [range, setRange] = useState<HistoryRange>("seven_days");
  const [windowId, setWindowId] = useState(windows[0]?.id ?? "five_hour");
  const [series, setSeries] = useState<UsageHistorySeries>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState(false);

  useEffect(() => {
    if (!windows.some((window) => window.id === windowId)) {
      setWindowId(windows[0]?.id ?? "five_hour");
    }
  }, [windowId, windows]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    void loadHistory(range, windowId)
      .then((next) => {
        if (active) setSeries(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadHistory, range, refreshKey, windowId]);

  const path = useMemo(() => buildHistoryPath(series?.points ?? [], 320, 112, 10), [series]);
  const firstTime = series?.points[0]?.queriedAt ?? 0;
  const lastTime = series?.points.at(-1)?.queriedAt ?? firstTime;
  const timeSpan = Math.max(1, lastTime - firstTime);
  const markerX = (timestamp: number) => 10 + ((timestamp - firstTime) / timeSpan) * 300;
  const formatPercent = (value?: number) => (value === undefined ? "--" : `${Math.round(value)}%`);
  const startLabel = series?.points[0]
    ? new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit" }).format(
        new Date(series.points[0].queriedAt),
      )
    : "";
  const endLabel = series?.points.at(-1)
    ? new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit" }).format(
        new Date(series.points.at(-1)!.queriedAt),
      )
    : "";

  return (
    <section className="history-panel" aria-label={t("historyTitle")}>
      <div className="history-controls">
        <div className="history-ranges" aria-label={t("historyRange")}>
          {ranges.map((item) => (
            <button
              className={range === item ? "active" : ""}
              key={item}
              type="button"
              onClick={() => setRange(item)}
            >
              {t(`historyRanges.${item}`)}
            </button>
          ))}
        </div>
        {windows.length > 1 && (
          <select
            aria-label={t("historyWindow")}
            value={windowId}
            onChange={(event) => setWindowId(event.target.value)}
          >
            {windows.map((window) => (
              <option key={window.id} value={window.id}>
                {t(`windows.${window.id}`, { defaultValue: window.label })}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="history-state">{t("historyLoading")}</div>
      ) : failed ? (
        <div className="history-state">{t("historyFailed")}</div>
      ) : !series || series.points.length < 2 ? (
        <div className="history-state">
          <strong>{t("historyEmpty")}</strong>
          <span>{t("historyEmptyHint")}</span>
        </div>
      ) : (
        <>
          <div className="history-stats">
            <div>
              <span>{t("historyCurrent")}</span>
              <strong>{formatPercent(series.currentRemaining)}</strong>
            </div>
            <div>
              <span>{t("historyMinimum")}</span>
              <strong>{formatPercent(series.minimumRemaining)}</strong>
            </div>
            <div>
              <span>{t("historyMaximum")}</span>
              <strong>{formatPercent(series.maximumRemaining)}</strong>
            </div>
          </div>
          <div className="history-chart">
            <svg
              viewBox="0 0 320 112"
              role="img"
              aria-label={t("historyChartLabel", { count: series.sampleCount })}
            >
              <line x1="10" y1="10" x2="310" y2="10" className="history-grid" />
              <line x1="10" y1="56" x2="310" y2="56" className="history-grid" />
              <line x1="10" y1="102" x2="310" y2="102" className="history-grid" />
              {series.points
                .filter((point) => point.reset)
                .map((point) => (
                  <line
                    key={point.queriedAt}
                    x1={markerX(point.queriedAt)}
                    y1="10"
                    x2={markerX(point.queriedAt)}
                    y2="102"
                    className="history-reset-marker"
                  />
                ))}
              <path d={path} className="history-line" />
              <circle
                cx="310"
                cy={10 + (1 - (series.currentRemaining ?? 0) / 100) * 92}
                r="3.5"
                className="history-point"
              />
            </svg>
            <div className="history-axis">
              <span>{startLabel}</span>
              <span>{endLabel}</span>
            </div>
          </div>
          {series.points.some((point) => point.reset) && (
            <div className="history-reset-legend">
              <span className="history-reset-swatch" aria-hidden="true" />
              {t("historyResetLegend")}
            </div>
          )}
          {series.consumptionPerHour !== undefined && (
            <div className="history-estimate">
              <div>
                <span>{t("historyConsumption")}</span>
                <strong>
                  {t("historyConsumptionRate", {
                    value: series.consumptionPerHour.toFixed(1),
                  })}
                </strong>
              </div>
              <div>
                <span>{t("historyProjection")}</span>
                <strong>
                  {series.projectedExhaustionAt
                    ? new Intl.DateTimeFormat(locale, {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(series.projectedExhaustionAt))
                    : t("historyProjectionUnavailable")}
                </strong>
              </div>
              <p>{t("historyEstimateNotice")}</p>
            </div>
          )}
          <div className="history-actions">
            <button
              type="button"
              onClick={() => {
                setActionError(false);
                void exportHistory(range, windowId).catch(() => setActionError(true));
              }}
              disabled={series.sampleCount === 0}
            >
              {t("historyExport")}
            </button>
            <button
              className="history-clear"
              type="button"
              onClick={() => {
                if (!window.confirm(t("historyClearConfirm"))) return;
                setActionError(false);
                void clearHistory()
                  .then(() => setSeries(undefined))
                  .catch(() => setActionError(true));
              }}
            >
              {t("historyClear")}
            </button>
          </div>
          <p className="history-footnote">
            {actionError
              ? t("historyActionFailed")
              : t("historySamples", { count: series.sampleCount })}
          </p>
        </>
      )}
      {!loading && (!series || series.points.length < 2) && (
        <div className="history-actions">
          <button
            className="history-clear"
            type="button"
            onClick={() => {
              if (!window.confirm(t("historyClearConfirm"))) return;
              setActionError(false);
              void clearHistory()
                .then(() => setSeries(undefined))
                .catch(() => setActionError(true));
            }}
          >
            {t("historyClear")}
          </button>
          {actionError && <span className="history-footnote">{t("historyActionFailed")}</span>}
        </div>
      )}
    </section>
  );
}
