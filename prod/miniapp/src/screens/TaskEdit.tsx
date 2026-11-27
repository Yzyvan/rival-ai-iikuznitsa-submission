import { useState } from "react";
import { ActionBar, Avatar, Button, Icon, IconButton, PersonChip, ScreenHeader, Section, Segmented, Status, Tags, ToggleRow, VilarHint } from "../ui";
import { useNav } from "../nav";
import { PickDateSheet, shortDate } from "./PickDateSheet";

const people = [
  { name: "Ольга Смирнова", short: "Ольга", initials: "ОС", hint: "ведёт договор с клиентом" },   // вариант Vilar
  { name: "Павел Егоров", short: "Павел", initials: "ПЕ" },
  { name: "Мария Лебедева", short: "Мария", initials: "МЛ" },
];

/** Поручение: Vilar уже подставил исполнителя и срок — пользователь проверяет и сохраняет. */
export function TaskEdit() {
  // срок: «Другая дата» открывает свой выбор дня и времени, выбранная дата встаёт в переключатель
  const [due, setDue] = useState(0);
  const [custom, setCustom] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const nav = useNav();
  const [who, setWho] = useState(0);
  const p = people[who];
  return (
    <div className="screen">
      <div className="scroll">
        <ScreenHeader title="Поручение" left={<IconButton icon="arrow-left" label="Назад" onClick={() => nav("back")} />} />
        <div className="body">
          <div className="head">
            <Status label="уточнить" type="Внимание" tone="Яркая" />
            <div className="row" style={{ gap: 12, alignItems: "flex-start", alignSelf: "stretch" }}>
              <h1 className="t-title-l grow">Согласовать окно работ с клиентом</h1>
              <IconButton icon="edit" size={36} label="Изменить текст" />
            </div>
            <VilarHint text="Vilar подставил исполнителя и срок — проверьте" />
            <div className="stack" style={{ gap: 8, paddingTop: 8 }}>
              <p className="t-body-l c-secondary">«…окно работ надо согласовать с клиентом до пятницы»</p>
              <Tags items={["Павел Егоров", "4 декабря", "14:38"]} />
            </div>
          </div>

          <Section title="Исполнитель">
            <div className="assignee">
              <Avatar initials={p.initials} />
              <div className="list-row__text">
                <span className="t-body-l">{p.name}</span>
                {p.hint && <VilarHint text={p.hint} />}
              </div>
              <span className="assignee__check"><Icon name="check" size={16} /></span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {people.map((x, i) => i !== who && <PersonChip key={x.name} name={x.short} initials={x.initials} onClick={() => setWho(i)} />)}
              <PersonChip name="Другой" />
            </div>
          </Section>

          <Section title="Срок">
            <Segmented options={["Пт, 11 дек", "Пн, 14 дек", custom ?? "Другая дата"]} index={due} onChange={(k) => (k === 2 ? setPicking(true) : setDue(k))} />
            <VilarHint text="в реплике прозвучало «до пятницы»" />
          </Section>

          <Section title="На будущее">
            <ToggleRow title="Запомнить правило" subtitle="Договорённости с клиентами поручать Ольге Смирновой" />
          </Section>
        </div>
      </div>
      <ActionBar caption="Протокол станет версией v4">
        <Button label="Отмена" variant="secondary" onClick={() => nav("back")} />
        <Button label="Сохранить" onClick={() => nav("back")} />
      </ActionBar>
      {picking && (
        <PickDateSheet title="Срок поручения" subtitle="Согласовать окно работ с клиентом" action="Поставить срок"
          onClose={() => setPicking(false)}
          onPick={(d, t) => { setPicking(false); setCustom(`${shortDate(d).split(", ")[1]}, ${t}`); setDue(2); }} />
      )}
    </div>
  );
}
