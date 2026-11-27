import { useState } from "react";
import { useTracker, type PriorityAction, type PriorityBindings, type PriorityFeedback } from "./bindings";
import { ShadowPreferences } from "./ShadowPreferences";
import { TaskDialog } from "./TaskForms";

const steps: Record<string, string> = {
  work: "Выполнить поручение",
  review: "Проверить результат",
  decision: "Принять решение",
  check_response: "Проверить ответ",
  clarify: "Уточнить исполнителя",
};

type Selection = { id: string; listId: string; version: number; feedback: boolean };

function LoadStatus({ error, refresh }: { error: string; refresh: () => void }) {
  if (error) return <p role="alert">{error} <button type="button" onClick={refresh}>Повторить</button></p>;
  return <p role="status">Обновляем решения…</p>;
}

function Queue({ api, select }: { api: PriorityBindings; select: (s: Selection) => void }) {
  const { data, error, refresh } = api.useQueue();
  if (!data) return <LoadStatus error={error} refresh={refresh} />;
  return <>
    <button className="btn btn--ghost btn--s" onClick={refresh}>Обновить решения</button>
    {data.actions.length === 0 && <p role="status">Сейчас от вас не требуется решений.</p>}
    {data.actions.map(action => <button className="task-card" key={action.action_id}
      onClick={() => select({ id: action.action_id, version: action.version, listId: data.list_id, feedback: data.feedback_enabled })}>
      <span className="t-body-l">{action.title}</span>
      <span>{steps[action.kind] || "Открыть поручение"}</span>
      <span className="t-body-m c-secondary">{action.reason_text}</span>
    </button>)}
  </>;
}

function dateText(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(value + "T12:00:00").toLocaleDateString("ru-RU");
  }
  const instant = new Date(value);
  return instant.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

const dates = [
  ["due_at", "Срок поручения"],
  ["expected_response_at", "Ожидаемый ответ"],
  ["check_at", "Проверить ответ"],
] as const;

function History({ api, stepId }: { api: PriorityBindings; stepId: string }) {
  const { data, error, refresh } = api.useHistory(stepId);
  if (!data) return <LoadStatus error={error} refresh={refresh} />;
  if (!data.changes.length) return <p role="status">История изменений пока пуста.</p>;
  return <ol className="live-task-fields" aria-label="История решений">
    {[...data.changes].reverse().map(change => <li key={change.action_id + "/" + change.position + "/" + change.recorded_at}>
      <p>{change.card?.reason_text ?? "Действие вышло из очереди"}</p>
      <p className="t-caption c-secondary"><time dateTime={change.recorded_at}>{dateText(change.recorded_at)}</time>
        {change.card && " · Версия поручения " + change.card.version} · Правило {change.policy_version}</p>
    </li>)}
  </ol>;
}

function Card({ api, selected, back, openTask }: {
  api: PriorityBindings;
  selected: Selection;
  back: (message?: string) => void;
  openTask: (step: string) => void;
}) {
  const { data, error, refresh } = api.useCard(selected.id);
  const feedback = api.useFeedback();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  function record(action: PriorityAction, choice: PriorityFeedback["choice"]) {
    feedback.send({
      list_id: selected.listId, action_id: action.action_id, expected_version: action.version, choice,
      ...(choice === "correct" && reason.trim() ? { reason: reason.trim() } : {}),
    }, () => back("Ответ сохранён."), () => back("Доступность или версия решения изменилась. Обновляем список."));
  }
  return <>
    <button disabled={feedback.busy} className="btn btn--ghost btn--s" onClick={() => back()}>К списку решений</button>
    {!data ? <LoadStatus error={error} refresh={refresh} /> : <>
      <h3 className="t-title-s">{data.title}</h3>
      <p>{steps[data.kind] || "Открыть поручение"}</p>
      <p>{data.reason_text}</p>
      <dl className="live-task-info">
        {dates.map(([key, label]) => {
          const value = data[key];
          return value ? <DateFact key={key} label={label} value={value} /> : null;
        })}
      </dl>
      <button className="btn btn--primary" disabled={feedback.busy} onClick={() => openTask(data.step_id)}>Открыть поручение</button>
      <button className="btn btn--ghost btn--s" aria-expanded={historyOpen}
        onClick={() => setHistoryOpen(!historyOpen)}>История решений</button>
      {historyOpen && <History api={api} stepId={data.step_id} />}
      {selected.feedback && selected.version === data.version && <div className="live-task-fields">
        <div className="live-task-actions">
          <button className="btn btn--secondary btn--s" disabled={feedback.busy} onClick={() => record(data, "choose")}>Выбрать сейчас</button>
          <button className="btn btn--secondary btn--s" disabled={feedback.busy} onClick={() => record(data, "defer")}>Отложить выбор</button>
          <button className="btn btn--ghost btn--s" disabled={feedback.busy} onClick={() => setCorrecting(!correcting)}>Исправить рекомендацию</button>
        </div>
        {correcting && <form className="live-task-fields" onSubmit={e => { e.preventDefault(); record(data, "correct"); }}>
          <label>Причина исправления<input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
          <button className="btn btn--secondary btn--s" disabled={feedback.busy}>Сохранить исправление</button>
        </form>}
      </div>}
      {selected.feedback && selected.version !== data.version && <p role="status">Решение изменилось. Вернитесь к списку для оценки новой версии.</p>}
    </>}
    {feedback.error && <p role="alert">{feedback.error}</p>}
  </>;
}

function DateFact({ label, value }: { label: string; value: string }) {
  return <><dt>{label}</dt><dd><time dateTime={value}>{dateText(value)}</time></dd></>;
}

export function PriorityButton({ openTask }: { openTask: (id: string) => void }) {
  const { priorities } = useTracker();
  const [settings, setSettings] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, select] = useState<Selection | null>(null);
  const [notice, setNotice] = useState("");
  const close = () => { setOpen(false); setSettings(false); select(null); setNotice(""); };
  if (!priorities) return null;
  return <>
    <button type="button" className="btn btn--secondary btn--s" onClick={() => setOpen(true)}>Мои решения</button>
    {open && <TaskDialog title="Мои решения" busy={false} onClose={close}>
      {notice && <p role="status">{notice}</p>}
      {settings ? <ShadowPreferences api={priorities} back={() => setSettings(false)} /> : selected
        ? <Card api={priorities} selected={selected} back={message => { select(null); setNotice(message || ""); }}
            openTask={id => { close(); openTask(id); }} />
        : <>
          <Queue api={priorities} select={s => { select(s); setNotice(""); }} />
          <button className="btn btn--ghost btn--s" onClick={() => { setSettings(true); setNotice(""); }}>Настройки персонализации</button>
        </>}
    </TaskDialog>}
  </>;
}
