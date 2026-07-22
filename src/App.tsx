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
import {
  enableUsage,
  ensureNotificationPermission,
  getAccountMode,
  getAutostart,
  setAutostart,
  type AccountMode,
} from "./system";
import {
  getTasks,
  openCodexThread,
  onTasksUpdated,
  type CodexTask,
  type TaskSnapshot,
  type TaskStatus,
} from "./tasks";
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
  showDockIcon: false,
  glassLevel: 1,
};

const defaultRefreshSettings: RefreshSettings = {
  intervalMinutes: 5,
  usageEnabled: false,
  trayWindow: "five_hour",
  notifySeventy: false,
  notifyNinety: true,
  notifyHundred: true,
  notifyReset: false,
};

const emptyTaskSnapshot = (): TaskSnapshot => ({ tasks: [], queriedAt: Date.now() });

async function loadTasksSafely() {
  try {
    return await getTasks();
  } catch {
    return emptyTaskSnapshot();
  }
}

async function subscribeTasksSafely(handler: (snapshot: TaskSnapshot) => void) {
  try {
    return await onTasksUpdated(handler);
  } catch {
    return () => undefined;
  }
}

async function loadAccountModeSafely(): Promise<{ mode: AccountMode }> {
  try {
    return await getAccountMode();
  } catch {
    return { mode: "signed_out" };
  }
}

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
  loadTasks?: () => Promise<TaskSnapshot>;
  subscribeTasks?: (handler: (snapshot: TaskSnapshot) => void) => Promise<() => void>;
  loadAccountMode?: () => Promise<{ mode: AccountMode }>;
  openTask?: (sessionId: string) => Promise<void>;
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

function isTaskActive(status: TaskStatus) {
  return status === "thinking" || status === "executing" || status === "waiting";
}

function durationLabel(start: number, end: number) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
  backdropPollIntervalMs = 1500,
  loadTasks = loadTasksSafely,
  subscribeTasks = subscribeTasksSafely,
  loadAccountMode = loadAccountModeSafely,
  openTask = openCodexThread,
}: AppProps) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<UsageView>({ status: "loading" });
  const [settings, setSettings] = useState<RefreshSettings>(defaultRefreshSettings);
  const [autostart, setAutostartValue] = useState(false);
  const [appVersion, setAppVersion] = useState("1.1.5");
  const [, setRefreshing] = useState(false);
  const [preferences, setPreferences] = useState(defaultWindowPreferences);
  const [screen, setScreen] = useState<"meter" | "settings">("meter");
  const preferencesRef = useRef(defaultWindowPreferences);
  const persistedPreferencesRef = useRef(defaultWindowPreferences);
  const preferenceSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const settingsRef = useRef(defaultRefreshSettings);
  const persistedSettingsRef = useRef(defaultRefreshSettings);
  const settingsSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [saveError, setSaveError] = useState(false);
  const [backdropTone, setBackdropTone] = useState<BackdropTone>("light");
  const [tasks, setTasks] = useState<TaskSnapshot>({ tasks: [], queriedAt: Date.now() });
  const [clock, setClock] = useState(Date.now());
  const [accountMode, setAccountMode] = useState<AccountMode>("signed_out");
  // Keep this above the detailed/compact branches so changing views does not
  // recreate the disclosure and discard the user's choice.
  const [resetsExpanded, setResetsExpanded] = useState(false);

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
    void loadSettings().then((next) => {
      settingsRef.current = next;
      persistedSettingsRef.current = next;
      setSettings(next);
    });
    void loadAutostart().then(setAutostartValue);
    void loadAppVersion().then(setAppVersion);
    void loadTasks().then(setTasks);
    void loadAccountMode().then((report) => setAccountMode(report.mode));
    void loadWindowPreferences().then((next) => {
      preferencesRef.current = next;
      persistedPreferencesRef.current = next;
      setPreferences(next);
    });
    let active = true;
    let unlisten: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;
    let unlistenWindow: (() => void) | undefined;
    let unlistenMode: (() => void) | undefined;
    let unlistenTasks: (() => void) | undefined;
    void subscribe(setView).then((cleanup) => (active ? (unlisten = cleanup) : cleanup()));
    void subscribeSettings((next) => {
      settingsRef.current = next;
      persistedSettingsRef.current = next;
      setSettings(next);
    }).then((cleanup) => (active ? (unlistenSettings = cleanup) : cleanup()));
    void subscribeWindowPreferences((next) => {
      preferencesRef.current = next;
      persistedPreferencesRef.current = next;
      setPreferences(next);
    }).then((cleanup) => (active ? (unlistenWindow = cleanup) : cleanup()));
    void subscribeWindowModeChanged((next) => {
      preferencesRef.current = next;
      persistedPreferencesRef.current = next;
      setPreferences(next);
      setScreen("meter");
    }).then((cleanup) => (active ? (unlistenMode = cleanup) : cleanup()));
    void subscribeTasks(setTasks).then((cleanup) =>
      active ? (unlistenTasks = cleanup) : cleanup(),
    );
    return () => {
      active = false;
      unlisten?.();
      unlistenSettings?.();
      unlistenWindow?.();
      unlistenMode?.();
      unlistenTasks?.();
    };
  }, [
    loadAutostart,
    loadAppVersion,
    loadSettings,
    loadUsage,
    loadWindowPreferences,
    loadTasks,
    loadAccountMode,
    subscribe,
    subscribeSettings,
    subscribeWindowPreferences,
    subscribeWindowModeChanged,
    subscribeTasks,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    async (
      patch: Partial<RefreshSettings>,
      persist: (settings: RefreshSettings) => Promise<RefreshSettings> = saveSettings,
    ) => {
      const enabling =
        patch.notifySeventy || patch.notifyNinety || patch.notifyHundred || patch.notifyReset;
      if (enabling && !(await ensureNotificationPermission())) return;
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      setSaveError(false);
      const save = settingsSaveQueue.current
        .catch(() => undefined)
        .then(() => persist(next))
        .then((saved) => {
          persistedSettingsRef.current = saved;
          if (settingsRef.current === next) {
            settingsRef.current = saved;
            setSettings(saved);
          }
          return saved;
        })
        .catch(() => {
          if (settingsRef.current === next) {
            settingsRef.current = persistedSettingsRef.current;
            setSettings(persistedSettingsRef.current);
            setSaveError(true);
          }
          return persistedSettingsRef.current;
        });
      settingsSaveQueue.current = save;
      await save;
    },
    [saveSettings],
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
          persistedPreferencesRef.current = saved;
          if (preferencesRef.current === next) {
            preferencesRef.current = saved;
            setPreferences(saved);
          }
          return saved;
        })
        .catch(() => {
          if (preferencesRef.current === next) {
            preferencesRef.current = persistedPreferencesRef.current;
            setPreferences(persistedPreferencesRef.current);
            setSaveError(true);
          }
          return persistedPreferencesRef.current;
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
  const activeTasks = tasks.tasks.filter((task) => isTaskActive(task.status));
  const primaryTask = activeTasks[0];
  const recentCompletion = tasks.tasks.find(
    (task) => task.status === "completed" && clock - (task.completedAt ?? task.updatedAt) < 15_000,
  );
  const displayTask = primaryTask ?? recentCompletion;
  const displayStatus: TaskStatus = displayTask?.status ?? "unknown";

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
        <section
          className={`liquid-panel compact-panel status-${displayStatus}`}
          onMouseDown={drag}
        >
          <div className="compact-primary" role="status" aria-live="polite">
            <span className="status-signal" aria-hidden="true" />
            <div className="compact-status-copy">
              <strong>{t(`taskStatus.${displayStatus}`)}</strong>
              <span>
                {displayTask
                  ? durationLabel(displayTask.startedAt, displayTask.completedAt ?? clock)
                  : t("readyForTask")}
              </span>
            </div>
          </div>
          {activeTasks.length > 1 && (
            <span className="compact-task-count">+{activeTasks.length - 1}</span>
          )}
          {!settings.usageEnabled ? (
            <button
              className="compact-quota-button"
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void authorize()}
            >
              {t("compactEnable")}
            </button>
          ) : view.status === "loading" ? (
            <span className="compact-quota">{t("compactLoading")}</span>
          ) : view.status === "error" ? (
            <button
              className="compact-quota-button risk-text-critical"
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void refresh()}
            >
              {t("compactRetry")}
            </button>
          ) : readyWindows[0] ? (
            <span className="compact-quota">{`${windowShortLabel(readyWindows[0].id)} ${remainingPercent(readyWindows[0].usedPercent)}%`}</span>
          ) : null}
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
          <div className="title-identity">
            <h1>{screen === "settings" ? t("settingsTitle") : t("meterTitle")}</h1>
            {screen !== "settings" && (
              <span className={`account-mode mode-${accountMode}`}>
                {accountMode === "subscription" && view.status === "ready" && view.snapshot.planType
                  ? t("subscriptionMode", { plan: view.snapshot.planType.toUpperCase() })
                  : t(`accountMode.${accountMode}`)}
              </span>
            )}
          </div>
          <div className="title-actions" onMouseDown={(event) => event.stopPropagation()}>
            {screen === "settings" ? (
              <button className="text-action" type="button" onClick={() => void closeSettings()}>
                {t("done")}
              </button>
            ) : (
              <>
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
            {saveError && (
              <p className="stale-notice" role="alert">
                {t("saveFailed")}
              </p>
            )}
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
                  void updateSettings({ intervalMinutes: minutes }, () => saveInterval(minutes));
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
                label={t("showDockIcon")}
                checked={preferences.showDockIcon}
                onChange={(checked) => void updatePreferences({ showDockIcon: checked })}
              />
              <ToggleRow
                label={t("launchAtLogin")}
                checked={autostart}
                onChange={(checked) => {
                  const previous = autostart;
                  setAutostartValue(checked);
                  setSaveError(false);
                  void saveAutostart(checked)
                    .then(setAutostartValue)
                    .catch(() => {
                      setAutostartValue(previous);
                      setSaveError(true);
                    });
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
          <DashboardContent
            view={view}
            usageEnabled={settings.usageEnabled}
            tasks={tasks}
            now={clock}
            locale={i18n.language}
            intervalMinutes={settings.intervalMinutes}
            onRefresh={refresh}
            onAuthorize={authorize}
            t={t}
            accountMode={accountMode}
            onOpenTask={openTask}
            resetsExpanded={resetsExpanded}
            onResetsExpandedChange={setResetsExpanded}
          />
        )}
      </section>
    </main>
  );
}

function DashboardContent({
  view,
  usageEnabled,
  tasks,
  now,
  locale,
  intervalMinutes,
  onRefresh,
  onAuthorize,
  t,
  accountMode,
  resetsExpanded,
  onResetsExpandedChange,
  onOpenTask,
}: {
  view: UsageView;
  usageEnabled: boolean;
  tasks: TaskSnapshot;
  now: number;
  locale: string;
  intervalMinutes: number;
  onRefresh: () => Promise<void>;
  onAuthorize: () => Promise<void>;
  t: ReturnType<typeof useTranslation>["t"];
  accountMode: AccountMode;
  resetsExpanded: boolean;
  onResetsExpandedChange: (expanded: boolean) => void;
  onOpenTask: (sessionId: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"usage" | "tasks">("usage");
  const active = tasks.tasks.filter((task) => isTaskActive(task.status));
  const primary = active[0];
  const justCompleted = tasks.tasks.find(
    (task) => task.status === "completed" && now - (task.completedAt ?? task.updatedAt) < 15_000,
  );
  const featuredTask = primary ?? justCompleted;
  const recent = tasks.tasks
    .filter((task) => task.status === "completed")
    .sort(
      (left, right) =>
        (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt),
    )
    .slice(0, 5);
  return (
    <div className="dashboard-content">
      <nav className="meter-tabs" aria-label={t("overviewTabs")}>
        <button
          className={activeTab === "usage" ? "active" : ""}
          type="button"
          aria-selected={activeTab === "usage"}
          onClick={() => setActiveTab("usage")}
        >
          {t("usageTab")}
        </button>
        <button
          className={activeTab === "tasks" ? "active" : ""}
          type="button"
          aria-selected={activeTab === "tasks"}
          onClick={() => setActiveTab("tasks")}
        >
          {active.length > 0 && <span className="live-dot" aria-hidden="true" />}
          {t("tasksTab")}
          {active.length > 0 && <span className="task-count">{active.length}</span>}
        </button>
      </nav>
      {activeTab === "usage" ? (
        <MeterContent
          view={view}
          usageEnabled={usageEnabled}
          stale={view.status === "ready" && view.stale}
          intervalMinutes={intervalMinutes}
          locale={locale}
          onRefresh={onRefresh}
          onAuthorize={onAuthorize}
          t={t}
          accountMode={accountMode}
          resetsExpanded={resetsExpanded}
          onResetsExpandedChange={onResetsExpandedChange}
        />
      ) : (
        <TaskTabContent
          activeTasks={active}
          fallbackTask={featuredTask}
          recent={recent}
          now={now}
          locale={locale}
          t={t}
          onOpenTask={onOpenTask}
        />
      )}
    </div>
  );
}

function TaskTabContent({
  activeTasks,
  fallbackTask,
  recent,
  now,
  locale,
  t,
  onOpenTask,
}: {
  activeTasks: CodexTask[];
  fallbackTask?: CodexTask;
  recent: CodexTask[];
  now: number;
  locale: string;
  t: ReturnType<typeof useTranslation>["t"];
  onOpenTask: (sessionId: string) => Promise<void>;
}) {
  return (
    <div className="task-tab-content">
      <div className="active-task-list" aria-label={t("activeTasks")}>
        {activeTasks.length > 0 ? (
          activeTasks.map((task) => <StatusHero key={task.id} task={task} now={now} t={t} />)
        ) : (
          <StatusHero task={fallbackTask} now={now} t={t} />
        )}
      </div>
      {recent.length > 0 && (
        <section className="recent-strip" aria-label={t("recentTasks")}>
          <h2>{t("recentTasks")}</h2>
          {recent.map((item) => (
            <button
              className={`recent-row status-${item.status}`}
              key={item.id}
              type="button"
              disabled={!item.sessionId}
              aria-label={`${item.title} · ${t("openTask")}`}
              title={t("openTask")}
              onClick={() => item.sessionId && void onOpenTask(item.sessionId)}
            >
              <span className="recent-state">{t(`taskStatus.${item.status}`)}</span>
              <strong>{item.title}</strong>
              <time>
                {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
                  new Date(item.completedAt ?? item.updatedAt),
                )}
              </time>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function StatusHero({
  task,
  now,
  t,
}: {
  task?: CodexTask;
  now: number;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const status = task?.status ?? "unknown";
  return (
    <section className={`status-hero status-${status}`} aria-live="polite">
      <span className="status-signal" aria-hidden="true" />
      <div className="status-hero-copy">
        <div className="status-line">
          <strong>{t(`taskStatus.${status}`)}</strong>
          {task && <time>{durationLabel(task.startedAt, now)}</time>}
        </div>
        <p>{task?.title ?? t("tasksIdleHint")}</p>
        {task && <small>{task.project}</small>}
      </div>
    </section>
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
  accountMode,
  resetsExpanded,
  onResetsExpandedChange,
}: {
  view: UsageView;
  usageEnabled: boolean;
  stale: boolean;
  intervalMinutes: number;
  locale: string;
  onRefresh: () => Promise<void>;
  onAuthorize: () => Promise<void>;
  t: ReturnType<typeof useTranslation>["t"];
  accountMode: AccountMode;
  resetsExpanded: boolean;
  onResetsExpandedChange: (expanded: boolean) => void;
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
  if (view.status === "error" && accountMode === "api")
    return (
      <div className="state-card api-mode-state">
        <strong>{t("accountMode.api")}</strong>
        <p>{t("apiUsageUnavailable")}</p>
      </div>
    );
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
                      value: new Date(window.resetAt * 1000).toLocaleString(
                        locale,
                        window.id === "five_hour"
                          ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
                          : { month: "numeric", day: "numeric" },
                      ),
                    })}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {view.snapshot.resetCredits && view.snapshot.resetCredits.availableCount > 0 && (
        <section className="reset-credits" aria-label={t("resetCreditsTitle")}>
          <button
            className="reset-credits-heading"
            type="button"
            aria-expanded={resetsExpanded}
            onClick={() => onResetsExpandedChange(!resetsExpanded)}
          >
            <strong>{t("resetCreditsTitle")}</strong>
            <span className="reset-heading-actions">
              <span>
                {t("resetCreditsAvailable", {
                  count: view.snapshot.resetCredits.availableCount,
                })}
              </span>
              <span className="reset-chevron" aria-hidden="true">
                {resetsExpanded ? "⌃" : "⌄"}
              </span>
            </span>
          </button>
          {resetsExpanded && view.snapshot.resetCredits.credits.length > 0 && (
            <div className="reset-credit-list">
              {view.snapshot.resetCredits.credits.map((credit, index) => (
                <article className="reset-credit-row" key={credit.id ?? `${index}`}>
                  <div>
                    <strong>{credit.title || t("fullReset")}</strong>
                    {credit.expiresAt && (
                      <span>
                        {t("resetCreditExpires", {
                          value: new Date(credit.expiresAt * 1000).toLocaleDateString(locale, {
                            month: "numeric",
                            day: "numeric",
                          }),
                        })}
                      </span>
                    )}
                  </div>
                  <span className="reset-credit-status">{t("available")}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {accountMode === "api" && view.snapshot.credits && (
        <section className="credits-card" aria-label={t("creditsTitle")}>
          <div>
            <span>{t("creditsTitle")}</span>
            <strong>
              {view.snapshot.credits?.unlimited
                ? t("creditsUnlimited")
                : view.snapshot.credits?.hasCredits
                  ? t("creditsBalance", {
                      value: view.snapshot.credits.balance ?? t("creditsAvailable"),
                    })
                  : t("creditsNotEnabled")}
            </strong>
          </div>
          <div className="credits-meta">
            <span>
              {view.snapshot.credits?.expiresAt
                ? t("creditsExpire", {
                    value: new Date(view.snapshot.credits.expiresAt * 1000).toLocaleDateString(),
                  })
                : t("creditsExpiryUnavailable")}
            </span>
          </div>
        </section>
      )}
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
