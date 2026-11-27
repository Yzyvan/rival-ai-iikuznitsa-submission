export const columnLabels = {
  overdue: "Просрочено",
  in_progress: "В работе",
  new: "Новые",
  done: "Готово",
} as const;
export const kindLabels = {
  project: "Задача по проекту",
  meeting: "Встреча",
  assign: "Поручение",
  self: "Напомнить себе",
} as const;
export type Column = keyof typeof columnLabels;
export type Kind = keyof typeof kindLabels;
export type Person = { id: string; name: string };
export type People = { rows: Person[] };
export type TaskRecord = {
  id: string;
  native: boolean;
  showSubmit: boolean;
  resultVersion: number;
  title: string;
  column: Column;
  kind: Kind;
  assigneeId: string;
  assigneeName: string;
  ownerLabel: string;
  version: number;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  project: string | null;
  participants: string[];
  duration: number | null;
  reminder: boolean;
  video: boolean;
  moveTargets: Column[];
  showEdit: boolean;
  showReschedule: boolean;
  showReminder: boolean;
  reminderCount: number;
};
export type TaskList = { rows: TaskRecord[]; showCreate: boolean };

export function dateLabel(task: TaskRecord) {
  if (!task.dueDate) return "Без срока";
  const text = new Date(task.dueDate + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return task.dueTime ? text + ", " + task.dueTime.slice(0, 5) : text;
}
