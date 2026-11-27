import { IconButton, ListRow, ScreenHeader, Section } from "../ui";
import { useNav } from "../nav";

/** Уведомления: лента событий по дням. */
export function Notifications() {
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
            <ListRow title="Vilar сходил на статус продаж" subtitle="11:45 · протокол разослан" status={["разослан", "Нейтрально", "Темная"]} onClick={() => nav("board:meetings")} />
          </Section>
        </div>
      </div>
    </div>
  );
}
