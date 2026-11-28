// Счётчики вкладок Доски: GET ./api/attention → { tasks, meetings, mail } — сколько карточек каждого этапа ждут руководителя.
// Перечитываем при открытии Доски, при возврате в мини-апп и после каждого действия (notifyAttention, изменения в трекере).
import { useEffect, useState } from "react";
import { fetchBoardData } from "./mailBoard";

export type Attention = { tasks?: number; meetings?: number; mail?: number };
/** pending — ответа ещё не было; ok — счётчики с сервера; missing — адреса на сервере нет, Доска считает сама */
type State = { status: "pending" | "ok" | "missing"; data: Attention | null };

const CHANGED = "vilar:attention-changed";
/** Действие на Доске выполнено — счётчики нужно перечитать */
export const notifyAttention = () => window.dispatchEvent(new Event(CHANGED));

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
function parse(body: unknown): Attention | null {
  if (!body || typeof body !== "object") return null;
  const src = ((body as { counts?: unknown }).counts ?? body) as Record<string, unknown>;
  const pick = (k: string) => count(src[k]) ?? count((src[k] as { count?: unknown } | undefined)?.count);
  const data = { tasks: pick("tasks"), meetings: pick("meetings"), mail: pick("mail") };
  return Object.values(data).some((v) => v !== undefined) ? data : null;
}

// Последний ответ: при возврате на Доску вкладки сразу стоят со своими числами, а не мигают
let last: State = { status: "pending", data: null };

export function useAttention(active: boolean) {
  const [state, setState] = useState<State>(last);
  useEffect(() => {
    if (!active) return;
    let controller: AbortController | null = null;
    const put = (next: State) => { last = next; setState(next); };
    const read = async () => {
      controller?.abort();
      const c = (controller = new AbortController());
      try {
        const res = await fetchBoardData("./api/attention", c.signal);
        if (c.signal.aborted) return;
        if (res.status === 404) return put({ status: "missing", data: null });
        if (!res.ok) return;   // сбой сервера — остаются прошлые числа
        const data = parse(await res.json());
        if (!c.signal.aborted) put(data ? { status: "ok", data } : { status: "missing", data: null });
      } catch { /* нет сети или входа — остаются прошлые числа */ }
    };
    void read();
    const visible = () => { if (document.visibilityState === "visible") void read(); };
    const again = () => void read();
    window.addEventListener(CHANGED, again);
    window.addEventListener("vilar:tasks-changed", again);   // создали, перенесли или закрыли поручение
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller?.abort();
      window.removeEventListener(CHANGED, again);
      window.removeEventListener("vilar:tasks-changed", again);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [active]);
  return state;
}
