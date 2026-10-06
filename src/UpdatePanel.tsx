import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  checkForUpdates,
  getUpdateState,
  installUpdate,
  onUpdateChanged,
  type UpdateSnapshot,
} from "./updates";
import "./updates.css";

export interface UpdateApi {
  read: typeof getUpdateState;
  check: typeof checkForUpdates;
  install: typeof installUpdate;
  subscribe: typeof onUpdateChanged;
}
const defaultApi: UpdateApi = {
  read: getUpdateState,
  check: checkForUpdates,
  install: installUpdate,
  subscribe: onUpdateChanged,
};
const busyPhases = new Set(["checking", "confirming", "downloading", "installing", "restarting"]);

// Presentation only: schedule, version policy, signatures, locks and confirmation live in Rust.
export function UpdatePanel({
  settings,
  compact = false,
  onOpenSettings,
  api = defaultApi,
}: {
  settings: boolean;
  compact?: boolean;
  onOpenSettings?: () => void;
  api?: UpdateApi;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<UpdateSnapshot>();
  const [sending, setSending] = useState(false);
  const [transportError, setTransportError] = useState(false);
  const intent = useRef(false);
  const revision = useRef(-1);
  const mounted = useRef(false);
  const apply = useCallback((snapshot: UpdateSnapshot) => {
    if (mounted.current && snapshot.revision >= revision.current) {
      revision.current = snapshot.revision;
      setState(snapshot);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    let cleanup: (() => void) | undefined;
    // Subscribe before reading; revisions prevent an old IPC response overwriting an event.
    void api
      .subscribe(apply)
      .then((unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        void api
          .read()
          .then(apply)
          .catch(() => {
            if (active) setTransportError(true);
          });
      })
      .catch(() => {
        if (active) setTransportError(true);
      });
    return () => {
      active = false;
      mounted.current = false;
      cleanup?.();
    };
  }, [api, apply]);

  async function send(operation: () => Promise<UpdateSnapshot>) {
    if (intent.current) return;
    intent.current = true;
    setSending(true);
    setTransportError(false);
    try {
      apply(await operation());
    } catch {
      if (mounted.current) setTransportError(true);
    } finally {
      intent.current = false;
      if (mounted.current) setSending(false);
    }
  }
  const busy = sending || (!!state && busyPhases.has(state.phase));
  if (!settings && (!state?.visible || state.phase === "disabled" || state.phase === "up_to_date"))
    return null;
  if (!settings && onOpenSettings) {
    return (
      <button
        className={compact ? "update-compact-notice" : "update-notice"}
        type="button"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onOpenSettings}
        aria-label={t("updates.title")}
        title={
          state?.update
            ? t("updates.phases.available", { version: state.update.version })
            : t("updates.title")
        }
      >
        {compact
          ? "↑"
          : state?.phase === "available"
            ? t("updates.phases.available", { version: state.update?.version })
            : t("updates.title")}
      </button>
    );
  }
  const offered = !!state?.update && ["available", "error"].includes(state.phase);
  return (
    <section className="update-panel" aria-label={t("updates.title")}>
      {settings && (
        <div className="update-heading">
          <span>{t("updates.title")}</span>
          <span>{state ? `v${state.currentVersion} · stable` : t("updates.loading")}</span>
        </div>
      )}
      <div role="status" aria-live="polite">
        {transportError
          ? t("updates.transport")
          : state && (state.visible || state.phase === "disabled")
            ? state.error
              ? t(`updates.errors.${state.error}`, { defaultValue: t("updates.errors.install") })
              : t(`updates.phases.${state.phase}`, { version: state.update?.version })
            : settings
              ? t("updates.schedule")
              : null}
      </div>
      {state?.phase === "downloading" && (
        <>
          <progress
            aria-label={t("updates.progress")}
            max={state.total || undefined}
            value={state.total ? Math.min(state.downloaded, state.total) : undefined}
          />
          <span>
            {(state.downloaded / 1048576).toFixed(1)} MB
            {state.total ? ` / ${(state.total / 1048576).toFixed(1)} MB` : ""}
          </span>
        </>
      )}
      {offered && state.update?.notes && (
        <details>
          <summary>{t("updates.notes")}</summary>
          <p>{state.update.notes}</p>
        </details>
      )}
      <div className="update-actions">
        {settings && (
          <button type="button" disabled={busy} onClick={() => void send(api.check)}>
            {t("updates.check")}
          </button>
        )}
        {offered && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send(() => api.install(state.update!.version))}
          >
            {t("updates.install")}
          </button>
        )}
      </div>
    </section>
  );
}
