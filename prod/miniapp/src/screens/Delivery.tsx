import { Button, IconButton, ListRow, ScreenHeader, Section, StatTile, Status, type StatusSpec } from "../ui";
import { useNav } from "../nav";

const ok: StatusSpec = ["доставлено", "Готово", "Яркая"];

/** Выдача итогов встречи. done — вариант «всё доставлено» после повтора. */
export function Delivery({ done }: { done?: boolean }) {
  const nav = useNav();
  const people: [string, string, StatusSpec][] = [
    ["Мария Лебедева", "итог + поручение", ok], ["Алексей Новиков", "итог + поручение", ok], ["Ольга Смирнова", "итог в Telegram", ok],
    done ? ["Павел Егоров", "итог · повторно, 15:09", ok] : ["Павел Егоров", "ящик не принял письмо", ["не принято", "Проблема", "Темная"]],
    ["Екатерина Соколова", "итог", ok], ["Наталья Павлова", "итог", ok],
  ];
  return (
    <div className="screen">
      <div className="scroll">
        <ScreenHeader title="Рассылка" left={<IconButton icon="arrow-left" label="Назад" onClick={() => nav("back")} />} right={<IconButton icon="dots-horizontal" label="Меню" onClick={() => nav("sheet:menu")} />} />
        <div className="body body--plain">
          <div className="head">
            <div className="row" style={{ gap: 8 }}>
              <Status label="утверждено" type="Готово" tone="Яркая" icon="check-circle" />
              <Status label="v3 · 15:02" type="Нейтрально" tone="Темная" />
            </div>
            <h1 className="t-display">Интеграция «Ромашка-Ритейл»</h1>
            <span className="t-body-m c-secondary">Утвердил Иван Петров в Telegram</span>
          </div>
          <div className="stats-grid" style={{ gap: 16 }}>
            <StatTile label="Доставлено" value={done ? "6" : "5"} caption="из 6 адресатов" icon="check-circle" level="Хорошо" />
            {done
              ? <StatTile label="Не принято" value="0" caption="повтор не нужен" icon="check-circle" level="Хорошо" />
              : <StatTile label="Не принято" value="1" caption="повтор — только ему" icon="warning-triangle" level="Плохо" />}
          </div>
          <Section title="Получатели">
            {people.map(([name, sub, st]) => <ListRow key={name} urgent={st[1] === "Проблема"} title={name} subtitle={sub} status={st} />)}
          </Section>
          {!done && <Button label="Повторить для Павла" fill onClick={() => nav("replace:delivery-done")} />}
          <Section title="Другие действия">
            <ListRow title="Созвон с клиентом 11 дек, 11:00" subtitle="4 участника · календарь" status={["создан", "Готово", "Яркая"]} />
            <ListRow title="3 поручения поставлены" subtitle="календарь Outlook" status={["создано", "Готово", "Яркая"]} />
            <ListRow urgent title="Бюджет на пилот" subtitle="остаётся у вас" status={["не выдаётся", "Нейтрально", "Темная"]} />
          </Section>
          <Section title="Версии">
            <ListRow title="Утверждена" subtitle="Иван Петров · 15:02" status={["v3", "Готово", "Яркая"]} />
            <ListRow title="Окно работ — Ольге" subtitle="Иван Петров · 14:58" status={["v2", "Нейтрально", "Темная"]} />
            <ListRow title="Черновик после встречи" subtitle="Vilar · 14:46" status={["v1", "Нейтрально", "Темная"]} />
          </Section>
        </div>
      </div>
    </div>
  );
}
