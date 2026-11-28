// Трекер для своих экранов мини-аппа: чтение — хук из интеграции трекера, запись — запрос с ключом повтора.
// Интерфейс трекера (integrations/tracker/src) сюда не подключается: задачи рисует канбан мини-аппа.
import { notifyTasks, taskPath, useTaskRead, type People, type TaskList, type TaskRecord } from "../../../../integrations/tracker/transport/bindings";
import type { Task } from "../data/content";

export { notifyTasks, taskPath, useTaskRead };
export type { People, TaskList, TaskRecord };

/** Колонки канбана по порядку — коды трекера: «Просроченные», «Новые», «В работе», «Готово» */
export const COLUMN_CODES = ["overdue", "new", "in_progress", "done"] as const;
export type ColumnCode = (typeof COLUMN_CODES)[number];
const isColumn = (c: unknown): c is ColumnCode => (COLUMN_CODES as readonly unknown[]).includes(c);
/** Порядок колонок из ответа трекера (column_order). Незнакомые коды отбрасываем, недостающие ставим в конец по нашему порядку. */
export function columnOrder(order: unknown): ColumnCode[] {
  const given = Array.isArray(order) ? order.filter(isColumn).filter((c, i, a) => a.indexOf(c) === i) : [];
  return [...given, ...COLUMN_CODES.filter((c) => !given.includes(c))];
}

/** Список задач трекера: can_create — можно ли ставить новые, column_order — порядок колонок */
export type LiveTaskList = TaskList & { column_order?: string[] };
/** Карточка задачи: GET /tracker/api/tasks/{id} — то же, что в списке, и описание */
export type TaskDetail = TaskRecord & { description?: string | null };

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** Подпись срока на карточке: «был 5 дек» — просрочено, «до 8 дек» — в работе и новые, «7 дек» — готово */
export function dueLabel(due: string | null, column: string) {
  if (!due) return "без срока";
  const [, m, d] = due.split("-").map(Number);
  const day = `${d} ${MONTHS_SHORT[m - 1]}`;
  return column === "overdue" ? `был ${day}` : column === "done" ? day : `до ${day}`;
}

/** Запись трекера → задача канбана */
export const toTask = (r: TaskRecord): Task => ({
  id: r.id, title: r.title, assignee: r.assignee_name, date: dueLabel(r.due_date, r.column), due: r.due_date,
  ...(r.project ? { project: r.project } : {}), rec: r,
});

const MESSAGES: Record<number, string> = {
  400: "Проверьте введённые данные.", 401: "Требуется вход.", 403: "Недостаточно прав для этого действия.",
  404: "Задача недоступна или сервер пока не принимает это действие.", 409: "Задача изменилась. Проверьте актуальную карточку.", 422: "Проверьте введённые данные.",
};

/** Заголовок входа: подпись Telegram или код тестовой ссылки */
export function launchHeaders(): Record<string, string> {
  const telegram = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
  const launch = telegram?.WebApp?.initData || new URLSearchParams(location.hash.slice(1)).get("tgWebAppData");
  if (launch) return { Authorization: "tma " + launch };
  let code: string | null = null, editable = false;
  try { code = sessionStorage.getItem("vilar:aegis-test"); editable = sessionStorage.getItem("vilar:link-editable") === "true"; } catch { /* хранилище недоступно */ }
  return code ? { Authorization: (editable ? "vilar-edit " : "vilar-test ") + code } : {};
}

/** Ключ повтора: один на одно действие, чтобы повтор того же запроса не создал дубль */
export const newKey = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID()
  : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));

/** Действие в трекере. Успех — списки задач перечитываются; отказ — ошибка с понятным текстом (и тоже перечитываются: карточка могла измениться). */
export async function trackerPost<T = unknown>(path: string, payload: object, key = newKey()): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/tracker/api/" + path, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { ...launchHeaders(), "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Ответ не получен. Повторите запрос.");
  }
  if (!res.ok) {
    notifyTasks();
    throw new Error(MESSAGES[res.status] ?? "Сервис задач недоступен. Повторите запрос.");
  }
  const data = res.status === 204 ? null : await res.json();
  notifyTasks();
  return data as T;
}

/** Дата для трекера: 2026-12-11 */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

let knownName: string | undefined;   // имя с прошлого чтения: чтобы аватар не мигал «…» при каждом возврате на Доску
/** Кто открыл мини-апп: имя из трекера, ник из Telegram. Инициалы — для аватара; пока имя не пришло — «…» */
export function useSelf(active: boolean) {
  const people = useTaskRead<People>(active ? "people" : null);
  const tg = (window as Window & { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { first_name?: string; last_name?: string; username?: string } } } } }).Telegram?.WebApp?.initDataUnsafe?.user;
  const fresh = people.data?.rows.find((p) => p.id === people.data?.self_id)?.name;
  if (fresh) knownName = fresh;
  const name = fresh ?? knownName ?? ([tg?.first_name, tg?.last_name].filter(Boolean).join(" ") || undefined);
  const initials = name?.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "…";
  return { name, initials, username: tg?.username ? "@" + tg.username : undefined, error: people.error };
}
