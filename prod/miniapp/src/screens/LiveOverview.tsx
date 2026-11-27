import { useState } from "react";
import { createPortal } from "react-dom";
import { useTaskRead, type People, type TaskList } from "../../../../integrations/tracker/transport/bindings";
import { useNav } from "../nav";
import { IconButton, ListRow, ScreenHeader, Section } from "../ui";
import { useCalendar } from "./CalendarBoard";
import { useImportedMail } from "./MailBoard";
import { SheetView } from "./SheetView";

type Approval = {
  step_id: string;
  title: string;
  assignee_name: string;
  reviewer_name: string;
  result_version: number;
};

export function useApprovals(active: boolean) {
  return useTaskRead<{ rows: Approval[] }>(active ? "board" : null);
}

export function LiveApprovals({ data, error }: ReturnType<typeof useApprovals>) {
  const [selectedId, select] = useState<string | null>(null);
  const selected = data?.rows.find(row => row.step_id === selectedId);

  return <Section title="Результаты на согласовании">
    {(error || !data?.rows.length) && <p role="status">
      {error || (data ? "Результатов на согласовании пока нет." : "Загрузка…")}
    </p>}
    {data?.rows.map(row => (
      <ListRow key={row.step_id} title={row.title} subtitle={row.assignee_name}
        onClick={() => select(row.step_id)} />
    ))}
    {selected && createPortal(
      <SheetView key={selected.step_id} sheet={{
        title: selected.title,
        tags: [selected.assignee_name, "На согласовании"],
        msg: `Проверяющий: ${selected.reviewer_name}. Версия результата: ${selected.result_version}.`,
        actions: [["Закрыть", "ghost", "close"]],
      }} onAction={() => select(null)} />,
      document.querySelector(".app")!,
    )}
  </Section>;
}

function summaryValue(count: number | undefined, unavailable: boolean) {
  return unavailable ? "Недоступно" : count === undefined ? "Загрузка…" : String(count);
}

export function LiveStats() {
  const mail = useImportedMail();
  const calendar = useCalendar(true);
  const tasks = useTaskRead<TaskList>("tasks");
  const approvals = useApprovals(true);
  return <div className="screen">
    <div className="scroll">
      <ScreenHeader title="Статистика" />
      <div className="body pad-for-bar">
        <Section title="Данные на стенде">
          <ListRow title="Письма Outlook" value={summaryValue(mail.messages?.length, Boolean(mail.error))} />
          <ListRow title="Встречи Outlook" value={summaryValue(calendar.meetings?.length, Boolean(calendar.error))} />
          <ListRow title="Задачи" value={summaryValue(tasks.data?.rows.length, Boolean(tasks.error))} />
          <ListRow title="Просроченные задачи" value={summaryValue(tasks.data?.rows.filter(row => row.column === "overdue").length, Boolean(tasks.error))} />
          <ListRow title="Результаты на согласовании" value={summaryValue(approvals.data?.rows.length, Boolean(approvals.error))} />
        </Section>
      </div>
    </div>
  </div>;
}

export function LiveNotifications() {
  const nav = useNav();
  const calendar = useCalendar(true);
  const approvals = useApprovals(true);
  const tasks = useTaskRead<TaskList>("tasks?column=overdue");
  const count = calendar.pending.length + (approvals.data?.rows.length ?? 0) + (tasks.data?.rows.length ?? 0);
  const error = calendar.error || approvals.error || tasks.error;
  const ready = calendar.meetings && approvals.data && tasks.data;

  return <div className="screen">
    <div className="scroll">
      <ScreenHeader title="Уведомления" left={<IconButton icon="arrow-left" label="Назад" onClick={() => nav("back")} />} />
      <div className="body">
        <Section title="Требуют внимания">
          {error ? <p role="status">Часть данных недоступна.</p>
            : !ready ? <p role="status">Загрузка…</p>
            : !count && <p role="status">Новых действий пока нет.</p>}
          {calendar.pending.map(row => <ListRow key={row.id} title={row.title} subtitle="Нужен выбор по встрече"
            onClick={() => nav("board:meetings")} />)}
          {approvals.data?.rows.map(row => <ListRow key={row.step_id} title={row.title} subtitle="На согласовании"
            onClick={() => nav("board:approvals")} />)}
          {tasks.data?.rows.map(row => <ListRow key={row.id} title={row.title} subtitle="Просрочено"
            onClick={() => nav("tab:tasks")} />)}
        </Section>
      </div>
    </div>
  </div>;
}

export function LiveProfile() {
  const nav = useNav();
  const people = useTaskRead<People>("people");
  const person = people.data?.rows.find(row => row.id === people.data?.self_id);

  return <div className="screen">
    <div className="scroll">
      <ScreenHeader title="Мой профиль" left={<IconButton icon="close" label="Закрыть" onClick={() => nav("back")} />} />
      <div className="body">
        <Section title="Аккаунт">
          {person ? <ListRow title={person.name} subtitle="@aegis_ivan" />
            : <p role="status">{people.error || (people.data ? "Имя профиля недоступно." : "Загрузка…")}</p>}
          <ListRow title="Тестовая ссылка" subtitle="Доступ на чтение" />
        </Section>
      </div>
    </div>
  </div>;
}
