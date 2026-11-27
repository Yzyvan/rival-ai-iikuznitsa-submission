import { createContext, useContext, type ReactNode } from "react";
import type { Column, Kind, People, TaskList, TaskRecord } from "./model";

export type Draft = {
  title: string;
  kind: Kind;
  column: Column;
  assigneeId?: string;
  project?: string;
  dueDate?: string;
  dueTime?: string;
  participants?: string[];
  duration?: number;
  video?: boolean;
  reminder: boolean;
};
export type Change = "move" | "edit" | "reschedule" | "remind";
export type EditedFields = {
  column?: Column;
  title?: string;
  assigneeId?: string;
  dueDate?: string | null;
  dueTime?: string | null;
};
export type ReadState<T> = { data: T | null; error: string; refresh: () => void };
export interface Actions {
  busy: boolean;
  error: string;
  clearError(): void;
  create(draft: Draft, saved: (created: TaskRecord) => void): void;
  change(id: string, version: number, action: Change, fields: EditedFields, saved: () => void): void;
  undo(task: TaskRecord, saved: () => void): void;
}
export interface TrackerBindings {
  useList(query: string, assignee: string, column: string): ReadState<TaskList>;
  useDetail(id: string): ReadState<TaskRecord>;
  usePeople(enabled: boolean): ReadState<People>;
  useActions(): Actions;
  resultLink?(id: string): string;
}
const Context = createContext<TrackerBindings | null>(null);
export function TaskBindingsProvider({ bindings, children }: { bindings: TrackerBindings; children: ReactNode }) {
  return <Context.Provider value={bindings}>{children}</Context.Provider>;
}
export function useTracker() {
  const bindings = useContext(Context);
  if (!bindings) throw Error("TaskBindingsProvider is required");
  return bindings;
}
