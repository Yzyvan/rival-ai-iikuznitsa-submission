import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  columnLabels,
  dateLabel,
  kindLabels,
  type Column,
  type Kind,
  type People,
  type TaskRecord,
} from "./model";
import { useTracker, type Actions, type Change, type EditedFields } from "./bindings";

const kinds = Object.keys(kindLabels) as Kind[];
const statusLabels: Record<string, string> = {
  open: "Открыта",
  rework: "На доработке",
  in_review: "Сдано на проверку",
  accepted: "Принято",
  completed: "Выполнено",
};

function TaskDialog({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const origin = document.activeElement;
    panel.current?.focus();
    return () => {
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    };
  }, []);
  return createPortal(
    <div className="sheet-layer live-task-layer">
      <div
        className="sheet-scrim"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet"
        tabIndex={-1}
        ref={panel}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
          if (e.key !== "Tab") return;
          const nodes = panel.current?.querySelectorAll<HTMLElement>(
            "button:enabled, input:enabled, select:enabled, textarea:enabled, a[href]",
          );
          if (!nodes?.length) return;
          const first = nodes[0],
            last = nodes[nodes.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            e.preventDefault();
            last.focus();
          }
          if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="sheet__handle" />
        <div className="nt-header">
          <h2 className="t-title-l">{title}</h2>
          <button type="button" className="btn btn--ghost btn--s" disabled={busy} onClick={onClose}>
            Закрыть
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.querySelector(".app") || document.body,
  );
}

function Submit({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button className="btn btn--primary btn--fill" type="submit" disabled={disabled}>
      {children}
    </button>
  );
}

function PeopleOptions({ people }: { people: People | null }) {
  return (
    <>
      {people?.rows.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </>
  );
}

export function CreateTaskSheet({
  column,
  onClose,
  onCreated,
}: {
  column: Column;
  onClose: () => void;
  onCreated: (t: TaskRecord) => void;
}) {
  const bindings = useTracker();
  const people = bindings.usePeople(true);
  const write = bindings.useActions();
  const [kind, setKind] = useState<Kind>("assign");
  const [title, setTitle] = useState(""),
    [who, setWho] = useState(""),
    [project, setProject] = useState("");
  const [date, setDate] = useState(""),
    [time, setTime] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [duration, setDuration] = useState("30"),
    [video, setVideo] = useState(false),
    [reminder, setReminder] = useState(false);
  const assigned = kind === "assign" || kind === "project";
  const meeting = kind === "meeting";
  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    void write.create(
      {
        title: title.trim(),
        kind,
        column,
        ...(assigned && { assigneeId: who }),
        ...(kind === "project" && { project: project.trim() }),
        ...(date && { dueDate: date }),
        ...(date && time && { dueTime: time }),
        ...(meeting && { participants: participants, duration: Number(duration), video: video }),
        reminder,
      },
      onCreated,
    );
  };
  return (
    <TaskDialog title="Новая задача" onClose={onClose} busy={write.busy}>
      <div className="live-task-kinds" role="group" aria-label="Тип задачи">
        {kinds.map((k) => (
          <button
            type="button"
            key={k}
            aria-pressed={kind === k}
            disabled={write.busy}
            className={"btn btn--s btn--" + (kind === k ? "primary" : "secondary")}
            onClick={() => {
              setKind(k);
              write.clearError();
            }}
          >
            {kindLabels[k]}
          </button>
        ))}
      </div>
      <form onSubmit={create}>
        <fieldset disabled={write.busy} className="live-task-fields">
          <label>
            Название
            <input required maxLength={512} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {kind === "project" && (
            <label>
              Проект
              <input required maxLength={512} value={project} onChange={(e) => setProject(e.target.value)} />
            </label>
          )}
          {assigned && (
            <label>
              Ответственный
              <select required value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Выберите исполнителя</option>
                <PeopleOptions people={people.data} />
              </select>
            </label>
          )}
          {meeting && (
            <label>
              Участники
              <select
                multiple
                required
                value={participants}
                onChange={(e) => setParticipants(Array.from(e.target.selectedOptions, (o) => o.value))}
              >
                <PeopleOptions people={people.data} />
              </select>
            </label>
          )}
          {meeting && (
            <label>
              Длительность, минут
              <select value={duration} onChange={(e) => setDuration(e.target.value)}>
                {[15, 30, 45, 60].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Дедлайн
            <input
              type="date"
              required={meeting || !!time}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Время
            <input type="time" required={meeting} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          {meeting && (
            <label className="live-task-check">
              <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} />
              Видеозвонок
            </label>
          )}
          <label className="live-task-check">
            <input type="checkbox" checked={reminder} onChange={(e) => setReminder(e.target.checked)} />
            Напоминание
          </label>
          {people.error && (
            <p role="alert">
              {people.error}{" "}
              <button type="button" onClick={people.refresh}>
                Повторить
              </button>
            </p>
          )}
          {write.error && <p role="alert">{write.error}</p>}
          <Submit
            disabled={
              !title.trim() || (kind === "project" && !project.trim()) || ((assigned || meeting) && !people.data)
            }
          >
            Создать задачу
          </Submit>
        </fieldset>
      </form>
    </TaskDialog>
  );
}

type Editor = "edit" | "reschedule" | null;

function TaskActions({ task, people, write }: { task: TaskRecord; people: People | null; write: Actions }) {
  const [editor, setEditor] = useState<Editor>(null);
  const [target, setTarget] = useState<Column | "">("");
  const [notice, setNotice] = useState("");
  const [writeVersion, setWriteVersion] = useState(task.version);
  const [name, setName] = useState(""),
    [who, setWho] = useState(""),
    [date, setDate] = useState(""),
    [time, setTime] = useState("");
  const start = (mode: Editor) => {
    setName(task.title);
    setWho(task.assigneeId);
    setDate(task.dueDate || "");
    setTime(task.dueTime?.slice(0, 5) || "");
    setWriteVersion(task.version);
    setEditor(mode);
    write.clearError();
    setNotice("");
  };
  const change = (action: Change, payload: EditedFields, text: string, version = task.version) => {
    setNotice("");
    void write.change(task.id, version, action, payload, () => {
      setEditor(null);
      setTarget("");
      setNotice(text);
    });
  };
  const canChangeAssignee = task.kind === "assign" || task.kind === "project";
  const targets = task.moveTargets.filter((c) => c !== task.column);
  return (
    <fieldset className="live-task-fields" disabled={write.busy}>
      {targets.length > 0 && (
        <form
          className="live-task-fields"
          onSubmit={(e) => {
            e.preventDefault();
            if (target) change("move", { column: target }, "Задача перемещена.");
          }}
        >
          <label>
            Переместить в колонку
            <select value={target} onChange={(e) => setTarget(e.target.value as Column)}>
              <option value="">Выберите колонку</option>
              {targets.map((c) => (
                <option key={c} value={c}>
                  {columnLabels[c]}
                </option>
              ))}
            </select>
          </label>
          <Submit disabled={!target || !targets.includes(target)}>Переместить</Submit>
        </form>
      )}
      {!editor && (
        <div className="live-task-actions">
          {task.showEdit && (
            <button className="btn btn--secondary" onClick={() => start("edit")}>
              Изменить задачу
            </button>
          )}
          {task.showReschedule && (
            <button className="btn btn--secondary" onClick={() => start("reschedule")}>
              Перенести срок
            </button>
          )}
          {task.showReminder && (
            <button
              className="btn btn--secondary"
              onClick={() => change("remind", {}, "Напоминание записано в трекере.")}
            >
              Напомнить исполнителю
            </button>
          )}
        </div>
      )}
      {editor && (
        <form
          className="live-task-fields"
          onSubmit={(e) => {
            e.preventDefault();
            if (editor === "reschedule")
              change("reschedule", { dueDate: date, dueTime: time || null }, "Срок сохранён.", writeVersion);
            else
              change(
                "edit",
                {
                  title: name.trim(),
                  ...(canChangeAssignee && { assigneeId: who }),
                  dueDate: date || null,
                  dueTime: time || null,
                },
                "Изменения сохранены.",
                writeVersion,
              );
          }}
        >
          {editor === "edit" && (
            <>
              <label>
                Название
                <input required maxLength={512} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              {canChangeAssignee && (
                <label>
                  Ответственный
                  <select value={who} required onChange={(e) => setWho(e.target.value)}>
                    {!people?.rows.some((p) => p.id === who) && <option value={who}>{task.assigneeName}</option>}
                    <PeopleOptions people={people} />
                  </select>
                </label>
              )}
            </>
          )}
          <label>
            Новый срок
            <input
              type="date"
              required={editor === "reschedule" || task.kind === "meeting" || !!time}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Новое время
            <input
              type="time"
              required={task.kind === "meeting"}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          {task.version !== writeVersion && (
            <p role="alert">
              Задача изменилась.{" "}
              <button type="button" onClick={() => start(editor)}>
                Загрузить актуальные поля
              </button>
            </p>
          )}
          <Submit disabled={writeVersion !== task.version || (editor === "edit" && !name.trim())}>
            {editor === "edit" ? "Сохранить изменения" : "Сохранить срок"}
          </Submit>
          <button type="button" className="btn btn--ghost" onClick={() => setEditor(null)}>
            Отмена
          </button>
        </form>
      )}
      {write.error && <p role="alert">{write.error}</p>}
      {notice && <p role="status">{notice}</p>}
    </fieldset>
  );
}

export function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const bindings = useTracker();
  const read = bindings.useDetail(id);
  const task = read.data;
  const write = bindings.useActions();
  const people = bindings.usePeople(!!task && (task.showEdit || task.participants.length > 0));
  return (
    <TaskDialog title={task?.title || "Карточка задачи"} onClose={onClose} busy={write.busy}>
      {read.error && (
        <p role="alert">
          {read.error} <button onClick={read.refresh}>Обновить</button>
        </p>
      )}
      {!task && !read.error && <p role="status">Загружаем задачу…</p>}
      {task && (
        <>
          <dl className="live-task-info">
            <dt>Тип</dt>
            <dd>{kindLabels[task.kind] || "Поручение"}</dd>
            <dt>Ответственный</dt>
            <dd>{task.assigneeName}</dd>
            <dt>Статус</dt>
            <dd>{statusLabels[task.status] || task.status}</dd>
            {task.resultVersion > 0 && (
              <>
                <dt>Версия результата</dt>
                <dd>{task.resultVersion}</dd>
              </>
            )}
            <dt>Колонка</dt>
            <dd>{columnLabels[task.column]}</dd>
            {task.ownerLabel && (
              <>
                <dt>{task.native ? "Автор" : "Принимает"}</dt>
                <dd>{task.ownerLabel}</dd>
              </>
            )}
            <dt>Дедлайн</dt>
            <dd>{dateLabel(task)}</dd>
            {task.project && (
              <>
                <dt>Проект</dt>
                <dd>{task.project}</dd>
              </>
            )}
            {task.participants.length > 0 && (
              <>
                <dt>Участники</dt>
                <dd>
                  {task.participants
                    .map((id) => people.data?.rows.find((p) => p.id === id)?.name || id)
                    .join(", ")}
                </dd>
              </>
            )}
            {task.duration && (
              <>
                <dt>Длительность</dt>
                <dd>{task.duration} мин</dd>
              </>
            )}
            {task.video && (
              <>
                <dt>Формат</dt>
                <dd>Видеозвонок</dd>
              </>
            )}
            {task.reminder && (
              <>
                <dt>Напоминание</dt>
                <dd>Включено</dd>
              </>
            )}
            {task.reminderCount > 0 && (
              <>
                <dt>Напоминаний</dt>
                <dd>{task.reminderCount}</dd>
              </>
            )}
          </dl>
          {task.showSubmit && bindings.resultLink && (
            <a className="btn btn--primary" href={bindings.resultLink(id)}>
              Сдать результат
            </a>
          )}
          <TaskActions task={task} people={people.data} write={write} />
        </>
      )}
    </TaskDialog>
  );
}
