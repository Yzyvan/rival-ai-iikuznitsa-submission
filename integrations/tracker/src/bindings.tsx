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
export type PriorityAction = {
  action_id: string;
  step_id: string;
  title: string;
  next_actor_id: string | null;
  kind: string;
  tier: number;
  reason_code: string;
  reason_text: string;
  due_at: string | null;
  expected_response_at: string | null;
  check_at: string | null;
  version: number;
};
export type PriorityHistory = {
  changes: {
    action_id: string; position: number; recorded_at: string; policy_version: string; card: PriorityAction | null;
  }[];
};
export type PriorityList = {
  status: "ready";
  list_id: string;
  feedback_enabled: boolean;
  actions: PriorityAction[];
};
export type ShadowSettings = {
  retention_days: number;
  reserve_minutes?: number;
  loss_thresholds?: number[];
  preference_weights?: number[];
};
export type PrioritySettings = {
  version: number;
  enabled: boolean;
  settings: ShadowSettings | null;
  proposal: ShadowSettings | null;
};
export type SettingChange = { expected_version: number } & (
  { operation: "propose"; settings: ShadowSettings } | { operation: "confirm" | "revoke" }
);
export type PriorityFeedback = {
  list_id: string;
  action_id: string;
  expected_version: number;
  choice: "choose" | "defer" | "correct";
  reason?: string;
};
export type PriorityFacts = {
  version: number;
  waiting_for_response: boolean;
  expected_response_at: string | null;
  check_at: string | null;
  blocks_others: boolean;
};
export type FactChange = Partial<Omit<PriorityFacts, "version">> & { expected_version: number; response_confirmed?: true };
export interface PriorityBindings {
  useFacts(stepId: string): ReadState<PriorityFacts>;
  useFactChange(): {
    busy: boolean;
    error: string;
    send(stepId: string, body: FactChange, saved: () => void, conflict: () => void): void;
  };
  useSettings(): ReadState<PrioritySettings>;
  useSettingChange(): { busy: boolean; error: string; send(body: SettingChange, saved: () => void): void };
  useHistory(stepId: string): ReadState<PriorityHistory>;
  useQueue(): ReadState<PriorityList>;
  useCard(actionId: string): ReadState<PriorityAction>;
  useFeedback(): {
    busy: boolean;
    error: string;
    send(body: PriorityFeedback, saved: () => void, conflict: () => void): void;
  };
}

export interface TrackerBindings {
  priorities?: PriorityBindings;
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
