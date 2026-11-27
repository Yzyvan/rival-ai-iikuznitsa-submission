export type ImportedMail = { id: string; title: string; day: string };

type TelegramWebApp = { initData?: string; close?(): void; initDataUnsafe?: { user?: unknown } };

export function telegramWebApp() {
  return (window as Window & {Telegram?: {WebApp?: TelegramWebApp}}).Telegram?.WebApp;
}

export class TelegramLaunchError extends Error {}

export async function fetchImportedMail(signal: AbortSignal): Promise<ImportedMail[]> {
  const launch = new URLSearchParams(location.hash.slice(1)).get("tgWebAppData") || telegramWebApp()?.initData;
  if (!launch) throw new TelegramLaunchError("Откройте Vilar через меню бота @vilar_ai_bot в Telegram.");

  const response = await fetch("./api/mail/board", {
    headers: { Authorization: "tma " + launch },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (response.status === 401) {
    const body = await response.json();
    const reason = body.error === "expired_launch" ? "Сеанс Telegram истёк." : "Telegram не подтвердил вход.";
    throw new TelegramLaunchError(reason + " Закройте Vilar и откройте его через меню бота @vilar_ai_bot.");
  }
  if (response.status === 403) throw new Error("Почта доступна из Telegram-аккаунта владельца ящика.");
  if (!response.ok) throw new Error("Не удалось загрузить письма.");
  return (await response.json()).messages;
}
