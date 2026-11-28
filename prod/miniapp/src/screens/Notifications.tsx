import { IconButton, ListRow, ScreenHeader, Section } from "../ui";
import { hasAccountLaunch } from "../api/mailBoard";
import { useTaskRead, type TaskList } from "../../../../integrations/tracker/transport/bindings";
import { useCalendar } from "./CalendarBoard";
import { focusOn } from "../focus";
import { boards } from "../data/content";
import { rowSheet } from "../data/sheets";
import { useSelf } from "../api/tracker";
import { useApprovals } from "./LiveOverview";
import { useNav } from "../nav";

/** Уведомления: лента событий по дням. */
function AccountNotifications() {
  const nav = useNav();
  const calendar = useCalendar(true);
  const self = useSelf(true);
  const approvals = useApprovals(true, self.name);   // в ленту идут только результаты, которые согласует сам руководитель
  const tasks = useTaskRead<TaskList>("tasks?column=overdue");
  const pending = calendar.pending;
  const error = calendar.error || approvals.error || tasks.error;
  const ready = calendar.meetings && approvals.data && tasks.data;
  return <div className="screen"><div className="scroll">
    <ScreenHeader title="Уведомления" left={<IconButton icon="arrow-left" label="Назад" onClick={() => nav("back")} />} />
    <div className="body" style={{paddingBottom: 60}}>
      <Section title="Требуют внимания">
        {error && <p role="alert" className="t-body-m c-secondary">Часть данных недоступна.</p>}
        {!error && !ready && <p role="status" className="t-body-m c-secondary">Загрузка…</p>}
        {ready && !pending.length && !approvals.mine.length && !tasks.data?.rows.length && <p className="t-body-m c-secondary">Новых действий пока нет.</p>}
        {pending.map(m => <ListRow key={m.id} urgent title={m.title} subtitle="Нужно выбрать участника встречи" status={["решение", "Внимание", "Яркая"]} onClick={() => { focusOn({ kind: "meeting", id: m.id }); nav("board:meetings"); }} />)}
        {approvals.mine.map(r => <ListRow key={r.step_id} urgent title={r.title} subtitle={r.assignee_name} status={["утвердить", "Решение", "Яркая"]} onClick={() => { focusOn({ kind: "approval", id: r.step_id }); nav("board:approvals"); }} />)}
        {tasks.data?.rows.map(t => <ListRow key={t.id} urgent title={t.title} subtitle={t.assignee_name} status={["просрочено", "Проблема", "Темная"]} onClick={() => { focusOn({ kind: "task", id: t.id }); nav("tab:tasks"); }} />)}
      </Section>
    </div>
  </div></div>;
}

export function Notifications() {
  return hasAccountLaunch ? <AccountNotifications /> : <DemoNotifications />;
}

function DemoNotifications() {
  const nav = useNav();
  return (
    <div className="screen">
      <div className="scroll">
        <ScreenHeader title="Уведомления" left={<IconButton icon="arrow-left" label="Назад" onClick={() => nav("back")} />} right={<IconButton icon="check" label="Прочитать все" onClick={() => nav("toast:t10")} />} />
        <div className="body" style={{ paddingBottom: 60 }}>
          <Section title="Сегодня">
            <ListRow urgent title="Протокол готов: Интеграция «Ромашка-Ритейл»" subtitle="15:02 · ждёт утверждения" status={["утвердить", "Решение", "Яркая"]} onClick={() => nav("screen:protocol")} />
            <ListRow urgent title="Через 15 минут: статус запуска «Ромашка-Ритейл»" subtitle="10:45 · резюме готово" status={["скоро", "Внимание", "Яркая"]} onClick={() => nav("sheet:meet1")} />
            <ListRow urgent title="Ольга просрочила КП для «ТехноСтрой»" subtitle="09:10 · на 2 дня" status={["просрочено", "Проблема", "Темная"]} onClick={() => nav("sheet:task1")} />
            <ListRow urgent title="Письмо Павлу не доставлено" subtitle="15:04 · протокол интеграции" status={["не принято", "Проблема", "Темная"]} onClick={() => nav("screen:delivery")} />
          </Section>
          <Section title="Вчера">
            <ListRow title="Алексей сверяет прогноз декабря" subtitle="18:20 · будет готово завтра" status={["срок завтра", "Внимание", "Яркая"]} onClick={() => nav("sheet:task3")} />
            <ListRow title="Vilar сходил на статус продаж" subtitle="11:45 · протокол разослан" status={["разослан", "Нейтрально", "Темная"]} onClick={() => { const row = boards.meetings.sections.flatMap((x) => x.rows).find((r) => r.title === "Статус продаж, неделя 48"); nav(row ? rowSheet(row) : "board:meetings"); }} />
          </Section>
        </div>
      </div>
    </div>
  );
}
