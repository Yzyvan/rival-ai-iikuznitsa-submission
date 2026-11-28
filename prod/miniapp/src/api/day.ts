// Учебный день показа: GET /vilar-contest/api/day → { phase, generation, round, revision, clock, queue, task, meeting, reply }.
// clock — учебное время; queue — задачи по порядку, у строки id, title, reason; task — поручение Марии, его состояние в task.status:
// waiting — в работе, check_due — срок прошёл (строка первая в queue), done — сдано (из queue убрано).
// Когда phase = "approve" (протокол утверждён, поручение Марии выдано), нажатие на дату в шапке Доски
// отправляет POST с { action: "advance", generation, round, revision } — сервер проматывает 48 учебных часов
// и возвращает новое время и новый порядок задач. Время меняется только у текущего участника.
// Точной схемы ответа у фронта нет, поэтому поля читаются с запасом: по нескольким возможным именам.
import { useEffect, useState } from "react";
import { launchHeaders, notifyTasks } from "./tracker";
import { notifyAttention } from "./attention";

const DAY = "/vilar-contest/api/day";

/** Задача из ответа дня — уже в том порядке, в каком её показывает Доска */
export type DayTask = { id: string; taskId?: string; title: string; /** почему задача стоит на этом месте — от сервера */ reason?: string; assignee?: string; due?: string; overdue: boolean; done: boolean };
export type Day = {
  phase: string | null;
  /** учебное «сейчас» участника; null — сервер его не прислал, тогда дата настоящая */
  now: Date | null;
  tasks: DayTask[];
  /** ответ исполнителя по поручению показа: текст и id поручения */
  reply: { body: string; taskId: string } | null;
  /** можно ли промотать день: phase = approve */
  canAdvance: boolean;
  token: { generation: unknown; round: unknown; revision: unknown };
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const idOf = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) ? String(v) : str(v);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const date = (v: unknown): Date | null => {
  const s = str(v) ?? (typeof v === "number" ? v : undefined);
  if (s === undefined) return null;
  const d = new Date(typeof s === "number" && s < 1e12 ? s * 1000 : s);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** clock: строка с датой или объект вроде { now, at, iso, date } */
function clockOf(body: Record<string, unknown>): Date | null {
  const c = body.clock ?? body.now;
  const direct = date(c);
  if (direct) return direct;
  const o = obj(c);
  if (!o) return null;
  for (const k of ["now", "at", "iso", "date", "time", "current", "value"]) { const d = date(o[k]); if (d) return d; }
  for (const v of Object.values(o)) { const d = date(v); if (d && typeof v === "string" && /\d{4}-\d{2}-\d{2}/.test(v)) return d; }
  return null;
}
function taskOf(raw: unknown, i: number): DayTask | null {
  if (typeof raw === "string") return { id: raw, title: raw, overdue: false, done: false };
  const t = obj(raw);
  if (!t) return null;
  const title = str(t.title) ?? str(t.name) ?? str(t.subject);
  if (!title) return null;
  const person = obj(t.assignee) ?? obj(t.owner);
  const state = (str(t.column) ?? str(t.state) ?? str(t.status) ?? "").toLowerCase();
  return {
    id: idOf(t.id) ?? idOf(t.step_id) ?? idOf(t.task_id) ?? `${i}:${title}`,
    taskId: idOf(t.task_id) ?? idOf(t.id) ?? idOf(t.step_id),
    title, reason: str(t.reason),
    assignee: str(t.assignee_name) ?? str(person?.name) ?? str(t.assignee) ?? str(t.owner_name),
    due: str(t.due_date) ?? str(t.due) ?? str(t.deadline) ?? str(t.due_at),
    overdue: t.overdue === true || t.is_overdue === true || state === "overdue" || state === "late" || state === "check_due",
    done: t.done === true || state === "done" || state === "closed" || state === "completed",
  };
}
function tasksOf(body: Record<string, unknown>): DayTask[] {
  for (const k of ["queue", "tasks", "order", "task_order", "rows", "items", "board"]) {
    const v = body[k];
    const list = Array.isArray(v) ? v : Array.isArray(obj(v)?.rows) ? (obj(v)!.rows as unknown[]) : Array.isArray(obj(v)?.items) ? (obj(v)!.items as unknown[]) : null;
    if (list) return list.map(taskOf).filter((t): t is DayTask => !!t);
  }
  return [];
}
function parse(body: unknown): Day | null {
  const b = obj(body);
  if (!b) return null;
  const phase = str(b.phase) ?? null;
  let tasks = tasksOf(b);
  // поручение показа (Мария): состояние — в task.status; в очереди у его строки тот же id
  const own = taskOf(b.task, -1);
  if (own) {
    let at = tasks.findIndex(t => t.id === own.id || (own.taskId && t.taskId === own.taskId));
    if (at < 0) {
      const matches = tasks.filter(t => t.title === own.title && (!own.taskId || !t.taskId));
      if (matches.length === 1) at = tasks.indexOf(matches[0]);
    }
    if (at >= 0) tasks = tasks.map((t, i) => (i === at ? { ...own, ...t, taskId: own.taskId ?? t.taskId, reason: t.reason ?? own.reason, assignee: t.assignee ?? own.assignee, due: t.due ?? own.due, overdue: own.overdue || t.overdue, done: own.done } : t));
    else if (own.done) tasks = [...tasks, own];   // сдано — сервер убрал строку из очереди, показываем её последней со статусом «сдано»
  }
  const r = obj(b.reply);
  const replyText = str(r?.body);
  const replyId = idOf(r?.task_id);
  const candidates = r?.task_id == null ? tasks.filter(t => t.done)
    : tasks.filter(t => replyId !== undefined && (t.taskId === replyId || t.id === replyId));
  const reply = replyText && candidates.length === 1 ? { body: replyText, taskId: candidates[0].id } : null;
  return { phase, now: clockOf(b), tasks, reply, canAdvance: phase === "approve", token: { generation: b.generation, round: b.round, revision: b.revision } };
}

// Общее состояние: шапка Доски и вкладка «Поручения» читают один и тот же ответ
let last: Day | null = null;
const subs = new Set<(d: Day | null) => void>();
const put = (d: Day | null) => { last = d; subs.forEach((f) => f(d)); };

async function request(init?: RequestInit): Promise<Day | null> {
  const res = await fetch(DAY, { cache: "no-store", redirect: "error", ...init, headers: { ...launchHeaders(), ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(String(res.status));
  const body = await res.json();
  return parse(body);
}

/** Прочитать учебный день. Адреса нет, нет входа или нет сети — Доска работает, как раньше */
export async function readDay() {
  try { put(await request()); } catch { /* учебного дня нет — остаётся настоящая дата */ }
}

/** Промотать учебный день на 48 часов. Возвращает текст ошибки или null, если всё прошло */
export async function advanceDay(): Promise<string | null> {
  const d = last;
  if (!d?.canAdvance) return "Перемотать день можно после утверждения протокола.";
  try {
    const next = await request({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "advance", ...d.token }) });
    // в ответе может не быть задач или времени — тогда дочитываем обычным GET
    put(next && (next.tasks.length || next.now) ? next : last);
    if (!next?.tasks.length || !next.now) await readDay();
    notifyTasks(); notifyAttention();   // сроки сдвинулись — канбан и счётчики вкладок перечитываются
    return null;
  } catch (e) {
    await readDay();   // версия могла устареть — берём свежие generation / round / revision
    return (e as Error).message === "409" ? "День уже изменился — показываю свежие данные." : "Не получилось перемотать день. Повторите.";
  }
}

export function useDay(active: boolean) {
  const [day, setDay] = useState<Day | null>(last);
  useEffect(() => {
    if (!active) return;
    subs.add(setDay);
    void readDay();
    const again = () => void readDay();
    const visible = () => { if (document.visibilityState === "visible") again(); };
    window.addEventListener("vilar:tasks-changed", again);   // утвердили протокол, сдали результат — фаза могла смениться
    window.addEventListener("vilar:attention-changed", again);
    document.addEventListener("visibilitychange", visible);
    // исполнитель сдаёт результат с другого профиля — перечитываем сами, пока мини-апп на экране
    const timer = setInterval(() => { if (document.visibilityState === "visible") again(); }, 5000);
    return () => {
      clearInterval(timer);
      subs.delete(setDay);
      window.removeEventListener("vilar:tasks-changed", again);
      window.removeEventListener("vilar:attention-changed", again);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [active]);
  return day;
}
