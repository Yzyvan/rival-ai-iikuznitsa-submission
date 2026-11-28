export type ImportedMail = { id: string; title: string; day: string };

type TelegramWebApp = { initData?: string; close?(): void; initDataUnsafe?: { user?: unknown } };

export function telegramWebApp() {
  return (window as Window & {Telegram?: {WebApp?: TelegramWebApp}}).Telegram?.WebApp;
}

export class BoardAccessError extends Error {}
export class TelegramLaunchError extends BoardAccessError {}

const browserTestCode = (() => {
  const url = new URL(location.href);
  const params = new URLSearchParams(url.hash.slice(1));
  const code = params.get("aegis_test");
  if (code === null) {
    try {
      return sessionStorage.getItem("vilar:aegis-test");
    } catch {
      return null;
    }
  }
  params.delete("aegis_test");
  url.hash = params.toString();
  history.replaceState(history.state, "", url);
  try {
    sessionStorage.setItem("vilar:aegis-test", code);
  } catch {
    // The current page can still use the link if storage is disabled.
  }
  return code;
})();

function telegramLaunch() {
  return new URLSearchParams(location.hash.slice(1)).get("tgWebAppData") || telegramWebApp()?.initData;
}

// A launch selects the UI. The API authenticates every request independently.
export const hasAccountLaunch = Boolean(browserTestCode || telegramLaunch());
export const isBrowserTest = Boolean(browserTestCode && !telegramLaunch());

export let canEdit = Boolean(telegramLaunch());

export async function loadBrowserAccess() {
  if (!isBrowserTest) return;
  try {
    const res = await fetchBoardData("./api/owner/access", AbortSignal.timeout(5000));
    canEdit = res.ok && (await res.json()).edit === true;
  } catch {
    canEdit = false;
  }
  try { sessionStorage.setItem("vilar:link-editable", String(canEdit)); } catch { /* storage unavailable */ }
}

export function launchHeaders(): Record<string, string> {
  const launch = telegramLaunch();
  if (launch) return { Authorization: "tma " + launch };
  return browserTestCode ? { Authorization: (canEdit ? "vilar-edit " : "vilar-test ") + browserTestCode } : {};
}

export async function fetchBoardData(path: string, signal?: AbortSignal, body?: object) {
  const launch = telegramLaunch();
  const authorization = launch ? "tma " + launch : browserTestCode && ((canEdit ? "vilar-edit " : "vilar-test ") + browserTestCode);
  if (!authorization) throw new TelegramLaunchError("Откройте Vilar по тестовой ссылке или через меню бота @vilar_ai_bot.");

  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: authorization, ...(body && { "Content-Type": "application/json" }) },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (response.status === 401) {
    const body = await response.json().catch(() => ({}));
    if (!launch) {
      const reason = body.error === "expired_launch" ? "Срок действия тестовой ссылки истёк." : "Тестовая ссылка недействительна.";
      throw new BoardAccessError(reason);
    }
    const reason = body.error === "expired_launch" ? "Сеанс Telegram истёк." : "Telegram не подтвердил вход.";
    throw new TelegramLaunchError(reason + " Закройте Vilar и откройте его через меню бота @vilar_ai_bot.");
  }
  return response;
}

export async function fetchImportedMail(signal: AbortSignal): Promise<ImportedMail[]> {
  const response = await fetchBoardData("./api/mail/board", signal);
  if (response.status === 403) throw new Error("Почта доступна из Telegram-аккаунта владельца ящика.");
  if (!response.ok) throw new Error("Не удалось загрузить письма.");
  return (await response.json()).messages;
}
