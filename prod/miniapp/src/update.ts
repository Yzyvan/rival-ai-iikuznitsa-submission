// Автообновление: если на сервере новая сборка — перезагрузить мини-апп.
declare const __BUILD_ID__: string;

let checking = false;
async function check() {
  if (checking || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;   // на локальной разработке не проверяем
  checking = true;
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    const { build } = await r.json();
    if (build && build !== __BUILD_ID__) location.reload();
  } catch { /* нет сети — проверим в следующий раз */ }
  checking = false;
}

/** Проверять при каждом возвращении в мини-апп и раз в 5 минут */
export function watchForUpdates() {
  const tg = (window as any).Telegram?.WebApp;
  try { tg?.onEvent?.("activated", check); } catch { /* старый клиент */ }   // развернули свёрнутый мини-апп
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  window.addEventListener("focus", check);
  setInterval(check, 5 * 60 * 1000);
  check();
}
