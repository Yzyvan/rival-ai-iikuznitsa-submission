// Служба подключений Microsoft: состояние почты и календаря и вход в Microsoft.
// Адреса — как в версии со стенда (/me/connections, /auth/microsoft/…). Работает только при входе из Telegram.
export type ConnectionStatus = "connected" | "needs_login" | "error";
export type Connections = { mail: ConnectionStatus; calendar: ConnectionStatus; can_manage: boolean };

type WebApp = { initData?: string; openLink?(url: string): void };
export const telegram = () => (window as Window & { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

export async function connectionsApi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const init = telegram()?.initData;
  if (!init) throw new Error("Подключения настраиваются из Telegram.");
  const response = await fetch(path, {
    method, cache: "no-store", redirect: "error",
    headers: { Authorization: "tma " + init, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000),
  });
  if (response.status === 429) throw new Error("Microsoft ограничил запросы. Повторите позже.");
  if (response.status === 401) throw new Error("Откройте мини-апп заново в Telegram.");
  if (!response.ok) throw new Error("Сервис подключений недоступен.");
  return await response.json() as T;
}

/** Ссылка на вход в Microsoft: read — читать почту и календарь, manage — ещё и отправлять письма и менять встречи */
export async function microsoftLink(mode: "read" | "manage") {
  const reply = await connectionsApi<{ url: string }>("/auth/microsoft/intent", "POST", { mode });
  const link = new URL(reply.url);
  if (link.origin !== location.origin || link.pathname !== "/auth/microsoft/start") throw new Error("Сервис подключений недоступен.");
  return link.href;
}

// После входа в Microsoft человек возвращается в Telegram по ссылке с параметром ms_…: вход нужно завершить на сервере.
let finishing: Promise<"done" | "error" | "none"> | null = null;
/** Завершить вход в Microsoft, если мини-апп открыт по ссылке возврата. Вызывать можно сколько угодно раз — выполнится однажды. */
export function completeMicrosoftLogin() {
  return (finishing ??= (async () => {
    const start = new URLSearchParams(telegram()?.initData).get("start_param") ?? "";
    if (start === "ms_error") return "error" as const;
    if (!/^ms_[\w-]{43}$/.test(start)) return "none" as const;
    try { await connectionsApi("/auth/microsoft/finish", "POST"); await connectionsApi("/me/connections/check", "POST"); return "done" as const; }
    catch { return "error" as const; }
  })());
}
