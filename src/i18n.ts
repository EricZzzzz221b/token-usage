import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const resources = {
  zh: {
    translation: {
      appName: "Token用量",
      phaseZero: "阶段 0 · 应用基础设施",
      usedPercent: "已使用 {{value}}%",
      windows: { fiveHour: "5 小时窗口", sevenDay: "7 天窗口" },
    },
  },
  en: {
    translation: {
      appName: "Token Usage",
      phaseZero: "Phase 0 · Application foundation",
      usedPercent: "{{value}}% used",
      windows: { fiveHour: "5-hour window", sevenDay: "7-day window" },
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
