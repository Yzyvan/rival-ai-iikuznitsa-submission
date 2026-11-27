import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { columnLabels, kindLabels, type Actions, type Column, type Kind, type PriorityBindings, type PriorityFacts, type PriorityHistory, type PrioritySettings, type PriorityList, type PriorityAction, type TaskRecord as ViewTask, type TrackerBindings } from "vilar-tracker-ui";

export { columnLabels, kindLabels };
export type { Column, Kind };

export type Person = { id: string; name: string };
export type People = { rows: Person[]; self_id: string | null };
export type TaskRecord = {
  id: string;
  work_id: string;
  native: boolean;
  result_version: number;
  next_actor_person_id: string | null;
  title: string;
  column: Column;
  kind: Kind;
  assignee_person_id: string;
  assignee_name: string;
  reviewer_name: string;
  version: number;
  status: string;
  due_date: string | null;
  due_time: string | null;
  project: string | null;
  participant_ids: string[];
  duration_minutes: number | null;
  reminder: boolean;
  video_call: boolean;
  allowed_columns: Column[];
  can_edit: boolean;
  can_reschedule: boolean;
  can_remind: boolean;
  can_manage_priority_facts?: boolean;
  reminder_count: number;
  last_reminded_at: string | null;
};
export type TaskList = { rows: TaskRecord[]; can_create: boolean };

export function dateLabel(task: TaskRecord) {
  if (!task.due_date) return "Без срока";
  const text = new Date(task.due_date + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return task.due_time ? text + ", " + task.due_time.slice(0, 5) : text;
}

class TaskError extends Error {
  constructor(public status: number) {
    super(
      (
        {
          400: "Проверьте введённые данные.",
          401: "Требуется вход.",
          403: "Недостаточно прав для этого действия.",
          404: "Задача недоступна.",
          409: "Задача изменилась. Проверьте актуальную карточку.",
          422: "Проверьте введённые данные.",
        } as Record<number, string>
      )[status] || "Сервис задач недоступен. Повторите запрос.",
    );
  }
}

const changed = "vilar:tasks-changed";
export const notifyTasks = () => window.dispatchEvent(new Event(changed));
const apiBase = "/tracker/api/";
function launchHeaders(): Record<string, string> {
  const telegram = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
  const launch = telegram?.WebApp?.initData || new URLSearchParams(location.hash.slice(1)).get("tgWebAppData");
  return launch ? { Authorization: "tma " + launch } : {};
}
export const taskPath = (id: string) => "tasks/" + encodeURIComponent(id);

export function useTaskRead<T>(path: string | null, priority = false) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string }>({
    path: null,
    data: null,
    error: "",
  });
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let timer: number;
    let retriedConflict = false;
    const read = async () => {
      try {
        const response = await fetch(apiBase + path, { headers: launchHeaders(), redirect: "error", cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (priority && (response.status === 202 || (response.status === 409 && !retriedConflict))) {
          if (response.status === 409) retriedConflict = true;
          setState({ path, data: null, error: "" });
          timer = window.setTimeout(read, 1000);
          return;
        }
        if (!response.ok) throw new TaskError(response.status);
        const data: T = await response.json();
        if (!controller.signal.aborted) {
          setState({ path, data, error: "" });
          if (priority) timer = window.setTimeout(() => {
            if (document.visibilityState === "visible") void read();
          }, 30000);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setState({ path, data: null, error: e instanceof TaskError ? e.message : "Не удалось загрузить данные." });
      }
    };
    void read();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [path, generation, priority]);
  useEffect(() => {
    if (!path) return;
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(changed, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener(changed, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [path, refresh]);
  return { data: state.path === path ? state.data : null, error: state.path === path ? state.error : "", refresh };
}

// Keep the key when a response is lost so a retry of the same form cannot duplicate it.
function useTaskMutation() {
  const last = useRef<{ signature: string; key: string }>();
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async <T>(path: string, payload: object, saved: (data: T) => void, conflict?: () => void) => {
    if (active.current) return;
    const body = JSON.stringify(payload),
      signature = path + "\n" + body;
    if (last.current?.signature !== signature) {
      const key =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(
              "",
            );
      last.current = { signature, key };
    }
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiBase + path, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        headers: {
          ...launchHeaders(),
          "Content-Type": "application/json",
          "Idempotency-Key": last.current.key,
        },
        body,
      });
      if (!res.ok) throw new TaskError(res.status);
      const data = res.status === 204 ? null : await res.json();
      last.current = undefined;
      saved(data);
      notifyTasks();
    } catch (e) {
      setError(e instanceof TaskError ? e.message : "Ответ не получен. Повторите запрос.");
      if (e instanceof TaskError && [401, 403, 404, 409].includes(e.status)) {
        conflict?.();
        notifyTasks();
      }
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run, clearError: () => setError("") };
}

function awaitingSubmission(row: TaskRecord) {
  return !row.native && (row.status === "open" || row.status === "rework");
}

function present(row: TaskRecord, selfId: string | null): ViewTask {
  return {
    id: row.id,
    native: row.native,
    showSubmit: awaitingSubmission(row) && row.assignee_person_id === selfId,
    resultVersion: row.result_version,
    title: row.title,
    column: row.column,
    kind: row.kind,
    assigneeId: row.assignee_person_id,
    assigneeName: row.assignee_name,
    ownerLabel: row.reviewer_name,
    version: row.version,
    status: row.status,
    dueDate: row.due_date,
    dueTime: row.due_time,
    project: row.project,
    participants: row.participant_ids,
    duration: row.duration_minutes,
    reminder: row.reminder,
    video: row.video_call,
    moveTargets: row.allowed_columns,
    showEdit: row.can_edit,
    showReschedule: row.can_reschedule,
    showReminder: row.can_remind,
    canManagePriorityFacts: row.can_manage_priority_facts,
    reminderCount: row.reminder_count,
  };
}

function useList(query: string, assignee: string, column: string) {
  const filters = new URLSearchParams();
  if (query) filters.set("q", query);
  if (assignee) filters.set("assignee_person_id", assignee);
  if (column) filters.set("column", column);
  const path = filters.size ? "tasks?" + filters : "tasks";
  const list = useTaskRead<TaskList>(path);
  // The result action belongs to the detail view, which verifies the signed-in assignee.
  const data = useMemo(() => list.data && ({
    rows: list.data.rows.map((row) => present(row, null)),
    showCreate: list.data.can_create,
  }), [list.data]);
  return { ...list, data };
}

function useDetail(id: string) {
  const row = useTaskRead<TaskRecord>(taskPath(id));
  const identity = useTaskRead<People>(row.data && awaitingSubmission(row.data) ? "people" : null);
  return {
    data: row.data && present(row.data, identity.data?.self_id ?? null),
    error: row.error || identity.error,
    refresh() {
      row.refresh();
      identity.refresh();
    },
  };
}

function usePeople(enabled: boolean) {
  const read = useTaskRead<People>(enabled ? "people" : null);
  return { ...read, data: read.data && { rows: read.data.rows } };
}

function useActions(): Actions {
  const { busy, error, clearError, run } = useTaskMutation();
  return {
    busy,
    error,
    clearError,
    create(draft, saved) {
      const body = {
        title: draft.title,
        kind: draft.kind,
        column: draft.column,
        assignee_person_id: draft.assigneeId,
        project: draft.project,
        due_date: draft.dueDate,
        due_time: draft.dueTime,
        participant_ids: draft.participants,
        duration_minutes: draft.duration,
        video_call: draft.video,
        reminder: draft.reminder,
      };
      return run<TaskRecord>("tasks", body, (row) => saved(present(row, null)));
    },
    change(id, version, action, fields, saved) {
      return run(taskPath(id) + "/" + action, {
        expected_version: version,
        column: fields.column,
        title: fields.title,
        assignee_person_id: fields.assigneeId,
        due_date: fields.dueDate,
        due_time: fields.dueTime,
      }, saved);
    },
    undo(task, saved) {
      return run(taskPath(task.id) + "/undo-create", { expected_version: task.version }, saved);
    },
  };
}

const priorities: PriorityBindings = {
  useFacts: (id) => useTaskRead<PriorityFacts>(taskPath(id) + "/priority-facts"),
  useFactChange() {
    const { busy, error, run } = useTaskMutation();
    return { busy, error, send: (id, body, saved, conflict) => run(taskPath(id) + "/priority-facts", body, saved, conflict) };
  },
  useSettings: () => useTaskRead<PrioritySettings>("priority-settings"),
  useSettingChange() {
    const { busy, error, run } = useTaskMutation();
    return { busy, error, send: (body, saved) => run("priority-settings", body, saved) };
  },
  useHistory: (id) => useTaskRead<PriorityHistory>(taskPath(id) + "/priority-history", true),
  useQueue: () => useTaskRead<PriorityList>("priorities", true),
  useCard: (id) => useTaskRead<PriorityAction>("priorities/" + encodeURIComponent(id), true),
  useFeedback() {
    const { busy, error, run } = useTaskMutation();
    return { busy, error, send: (body, saved, conflict) => run("priority-feedback", body, saved, conflict) };
  },
};

export const trackerBindings: TrackerBindings = {
  priorities,
  useList,
  useDetail,
  usePeople,
  useActions,
  resultLink: (id) => "/tracker/?step=" + encodeURIComponent(id),
};
