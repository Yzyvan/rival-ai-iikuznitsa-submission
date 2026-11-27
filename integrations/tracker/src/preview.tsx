import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  Tasks,
  TaskBindingsProvider,
  columnLabels,
  type Column,
  type Draft,
  type TaskRecord,
  type TrackerBindings,
} from "./index";
import "./style.css";

const directory = {
  rows: [
    { id: "demo-author", name: "Автор примера" },
    { id: "demo-design", name: "Дизайнер" },
    { id: "demo-editor", name: "Редактор" },
  ],
};
const nameOf = (id: string) => directory.rows.find((p) => p.id === id)?.name ?? "";
function sample(id: string, draft: Draft): TaskRecord {
  const assigneeId = draft.assigneeId ?? directory.rows[0].id;
  return {
    id,
    native: true,
    showSubmit: false,
    resultVersion: 0,
    title: draft.title,
    kind: draft.kind,
    column: draft.column,
    assigneeId,
    assigneeName: nameOf(assigneeId),
    ownerLabel: directory.rows[0].name,
    version: 1,
    status: draft.column === "done" ? "completed" : "open",
    dueDate: draft.dueDate ?? null,
    dueTime: draft.dueTime ?? null,
    project: draft.project ?? null,
    participants: draft.participants ?? [],
    duration: draft.duration ?? null,
    video: draft.video ?? false,
    reminder: draft.reminder,
    reminderCount: 0,
    moveTargets: Object.keys(columnLabels) as Column[],
    showEdit: true,
    showReschedule: true,
    showReminder: true,
  };
}
let rows = [
  sample("demo-layout", {
    kind: "project",
    column: "in_progress",
    title: "Подготовить макеты для печати",
    project: "Выставка",
    assigneeId: "demo-design",
    reminder: false,
  }),
  sample("demo-text", {
    kind: "assign",
    column: "new",
    title: "Проверить подписи к иллюстрациям",
    assigneeId: "demo-editor",
    reminder: false,
  }),
];
const listeners = new Set<() => void>();
function publish(next: TaskRecord[]) {
  rows = next;
  listeners.forEach((f) => f());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snapshot = () => rows;
const refresh = () => listeners.forEach((f) => f());
const bindings: TrackerBindings = {
  useList(query, assignee, column) {
    const all = useSyncExternalStore(subscribe, snapshot);
    return {
      data: {
        rows: all.filter(
          (t) =>
            t.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
            (!column || t.column === column) &&
            (!assignee || t.assigneeId === assignee),
        ),
        showCreate: true,
      },
      error: "",
      refresh,
    };
  },
  useDetail(id) {
    const row = useSyncExternalStore(subscribe, snapshot).find((task) => task.id === id);
    return { data: row ?? null, error: row ? "" : "Карточка удалена из примера.", refresh };
  },
  usePeople(enabled) {
    return { data: enabled ? directory : null, error: "", refresh };
  },
  useActions() {
    return {
      busy: false,
      error: "",
      clearError() {},
      create(draft, saved) {
        const row = sample(crypto.randomUUID(), draft);
        publish([...rows, row]);
        saved(row);
      },
      change(id, _version, action, edits, saved) {
        publish(
          rows.map((row) => {
            if (row.id !== id) return row;
            const next = { ...row, ...edits, version: row.version + 1 };
            if (edits.assigneeId) next.assigneeName = nameOf(edits.assigneeId);
            if (action === "move") next.status = next.column === "done" ? "completed" : "open";
            if (action === "remind") next.reminderCount++;
            return next;
          }),
        );
        saved();
      },
      undo(task, saved) {
        publish(rows.filter((r) => r.id !== task.id));
        saved();
      },
    };
  },
};
createRoot(document.getElementById("root")!).render(
  <div className="preview">
    <p className="preview-note">Пример трекера · изменения до перезагрузки</p>
    <div className="app">
      <TaskBindingsProvider bindings={bindings}>
        <Tasks />
      </TaskBindingsProvider>
    </div>
  </div>,
);
