import { ActionBar, Button, IconButton, ListRow, ScreenHeader, Section, Tags } from "../ui";
import { useNav } from "../nav";

/** Протокол встречи: черновик, который пользователь правит и утверждает. */
export function Protocol() {
  const nav = useNav();
  return (
    <div className="screen">
      <div className="scroll">
        <ScreenHeader title="Протокол встречи" subtitle="черновик" left={<IconButton icon="arrow-left" label="Назад" onClick={() => nav("back")} />} right={<IconButton icon="dots-horizontal" label="Меню" onClick={() => nav("sheet:menu")} />} />
        <div className="body">
          <div className="head">
            <h1 className="t-display">Интеграция «Ромашка-Ритейл»</h1>
            <Tags items={["4 декабря", "45 мин", "инициатор Иван Петров"]} />
          </div>
          <Section title="Решения">
            <ListRow title="Заказы идут через шину событий" subtitle="Павел, 14:12" onClick={() => nav("sheet:q2")} />
            <ListRow title="Пилот — в одном регионе, Казань" subtitle="Иван, 14:20" onClick={() => nav("sheet:q3")} />
          </Section>
          <Section title="Поручения">
            <ListRow title="Передать дорожную карту интеграции" subtitle="Мария Лебедева · 14:32" value="10 дек" valueSub="из прошлого" onClick={() => nav("screen:task")} />
            <ListRow title="Описать формат событий заказа" subtitle="Алексей Новиков · 14:15" value="12 дек" onClick={() => nav("screen:task")} />
            <ListRow title="Оценить нагрузку на поддержку" subtitle="Мария Лебедева · 14:27" value="13 дек" onClick={() => nav("screen:task")} />
            <ListRow urgent title="Согласовать окно работ с клиентом" subtitle="нет исполнителя и срока" status={["уточнить", "Внимание", "Яркая"]} onClick={() => nav("screen:task")} />
          </Section>
          <Section title="Остаётся у вас">
            <ListRow urgent title="Бюджет на пилот" subtitle="Ольга, 14:40 · не выдаётся" status={["открыт", "Нейтрально", "Темная"]} onClick={() => nav("sheet:q4")} />
          </Section>
          <Section title="Получат итог">
            <ListRow title="Итог письмом всем участникам" subtitle="Поручения — лично каждому" value="6" valueSub="адресатов" />
          </Section>
        </div>
      </div>
      <ActionBar caption="Будет выдано 3 поручения · 1 вопрос остаётся у вас">
        <Button label="Исправить" variant="secondary" onClick={() => nav("screen:task")} />
        <Button label="Утвердить" onClick={() => nav("screen:delivery")} />
      </ActionBar>
    </div>
  );
}
