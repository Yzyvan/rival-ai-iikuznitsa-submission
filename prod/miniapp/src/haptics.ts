// Вибрация через Telegram (HapticFeedback); вне Telegram — navigator.vibrate, где он есть.
// Антон попросил сделать вибрацию заметно сильнее, поэтому каждая ступень сдвинута на одну вверх.
const hf = () => (window as any).Telegram?.WebApp?.HapticFeedback;
const safe = (fn: () => void) => { try { fn(); } catch { /* нет вибрации */ } };
const impact = (style: "light" | "medium" | "heavy" | "rigid", ms: number) =>
  safe(() => { const h = hf(); if (h?.impactOccurred) h.impactOccurred(style); else navigator.vibrate?.(ms); });

/** Толчок: light / medium / heavy — на ступень сильнее названного */
export const buzz = (power: "light" | "medium" | "heavy") =>
  power === "light" ? impact("medium", 18) : power === "medium" ? impact("heavy", 30) : (impact("heavy", 45), setTimeout(() => impact("rigid", 0), 40));
/** «Буп» — отсечка (колонки канбана, галочка) */
export const tick = () => impact("medium", 16);
/** «Вууп» — переключение вкладок */
export const whoop = () => impact("heavy", 28);
/** «Ту-ту» — как отправка сообщения */
export const buzzSent = () => safe(() => { const h = hf(); if (h?.notificationOccurred) h.notificationOccurred("success"); else navigator.vibrate?.([50, 80, 50]); });
