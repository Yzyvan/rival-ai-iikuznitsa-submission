export type ImportedMail = { id: string; title: string; day: string };

type TelegramWebApp = { initData?: string; close?(): void; initDataUnsafe?: { user?: unknown } };

export function telegramWebApp() {
  return (window as Window & {Telegram?: {WebApp?: TelegramWebApp}}).Telegram?.WebApp;
}

export class TelegramLaunchError extends Error {}

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

export async function fetchBoardData(path: string, signal: AbortSignal) {
  const launch = new URLSearchParams(location.hash.slice(1)).get("tgWebAppData") || telegramWebApp()?.initData;
  const authorization = launch ? "tma " + launch : browserTestCode && "vilar-test " + browserTestCode;
  if (!authorization) throw new TelegramLaunchError("Откройте Vilar по тестовой ссылке или через меню бота @vilar_ai_bot.");

  const response = await fetch(path, {
    headers: { Authorization: authorization },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (response.status === 401) {
    const body = await response.json();
    if (!launch) {
      const reason = body.error === "expired_launch" ? "Срок действия тестовой ссылки истёк." : "Тестовая ссылка недействительна.";
      throw new Error(reason);
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
