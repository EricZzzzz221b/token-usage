import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const resources = {
  zh: {
    translation: {
      appName: "Token用量",
      phaseTwo: "阶段 2 · 菜单栏 MVP",
      loading: "正在读取 Codex 用量…",
      refresh: "立即刷新",
      retry: "重新尝试",
      stale: "正在显示上次成功数据",
      refreshInterval: "自动刷新",
      minutes: "{{count}} 分钟",
      usedPercent: "已使用 {{value}}%",
      windows: { five_hour: "5 小时窗口", seven_day: "7 天窗口", thirty_day: "30 天窗口" },
      errors: {
        not_logged_in: "没有发现 Codex 官方登录",
        unsupported_auth_mode: "Codex 当前未使用 ChatGPT OAuth 登录",
        credential_unreadable: "无法读取 Codex 登录凭据",
        credential_malformed: "Codex 登录凭据格式无效",
        authentication_expired: "Codex 登录已经过期，请重新登录",
        network_unavailable: "暂时无法连接 ChatGPT",
        rate_limited: "用量查询过于频繁，请稍后重试",
        server_unavailable: "官方用量服务暂时不可用",
        response_incompatible: "官方用量数据格式暂不兼容",
        unknown: "暂时无法读取用量",
      },
    },
  },
  en: {
    translation: {
      appName: "Token Usage",
      phaseTwo: "Phase 2 · Menu bar MVP",
      loading: "Reading Codex usage…",
      refresh: "Refresh now",
      retry: "Try again",
      stale: "Showing the last successful update",
      refreshInterval: "Auto refresh",
      minutes: "{{count}} minute",
      minutes_other: "{{count}} minutes",
      usedPercent: "{{value}}% used",
      windows: {
        five_hour: "5-hour window",
        seven_day: "7-day window",
        thirty_day: "30-day window",
      },
      errors: {
        not_logged_in: "Codex official login was not found",
        unsupported_auth_mode: "Codex is not using ChatGPT OAuth",
        credential_unreadable: "Codex credentials could not be read",
        credential_malformed: "Codex credentials are invalid",
        authentication_expired: "Codex login has expired. Please sign in again",
        network_unavailable: "ChatGPT is currently unreachable",
        rate_limited: "Usage was checked too frequently. Try again later",
        server_unavailable: "The official usage service is unavailable",
        response_incompatible: "The official usage response is not supported yet",
        unknown: "Usage could not be loaded",
      },
    },
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  fallbackLng: "en",
  lng: navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en",
  interpolation: { escapeValue: false },
});

export default i18n;
