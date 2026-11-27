// Фильтр Тасков — только по тому, что пользователь сам задаёт задаче в форме «Новая задача»:
// дедлайн, тип (задача по проекту или поручение), ответственный, проект. Общее состояние для шторки и строки над канбаном.
import { useSyncExternalStore } from "react";
import { columns, type Task } from "./content";

const TODAY = 1207;      // «Пн, 7 декабря»
const WEEK_END = 1213;   // воскресенье, 13 декабря
const MONTH: Record<string, number> = { ноя: 11, дек: 12 };
const dayKey = (d: string) => { const m = d.match(/(\d+)\s+(ноя|дек)/); return m ? MONTH[m[2]] * 100 + Number(m[1]) : 9999; };

export type Term = "today" | "week" | "any";
export type Kind = "all" | "project" | "assign";
export type Filter = { term: Term; kind: Kind; person: string | null; project: string | null };
export const EMPTY: Filter = { term: "any", kind: "all", person: null, project: null };

let state: Filter = EMPTY;
const subs = new Set<() => void>();
export const setFilter = (patch: Partial<Filter>) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
export const resetFilter = () => setFilter(EMPTY);
export const useFilter = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);

/** Подходит ли задача под фильтр */
export function matches(t: Task, f: Filter) {
  const day = dayKey(t.date);
  if (f.term === "today" && day > TODAY) return false;
  if (f.term === "week" && day > WEEK_END) return false;
  if (f.kind === "project" && !t.project) return false;
  if (f.kind === "assign" && t.project) return false;
  if (f.person && t.assignee !== f.person) return false;
  if (f.project && t.project !== f.project) return false;
  return true;
}

/** Сколько фильтров включено — число на иконке */
export const activeCount = (f: Filter) => Number(f.term !== "any") + Number(f.kind !== "all") + Number(!!f.person) + Number(!!f.project);

const all = () => columns.flatMap((c) => c.tasks);
export const people = () => [...new Set(all().map((t) => t.assignee))];
export const countWith = (f: Filter) => all().filter((t) => matches(t, f)).length;
