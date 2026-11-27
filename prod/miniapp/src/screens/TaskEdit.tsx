import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionBar, Avatar, Button, Icon, IconButton, PersonChip, ScreenHeader, Section, Segmented, Status, Tags, ToggleRow, VilarHint } from "../ui";
import { useNav } from "../nav";
import { PickDateSheet, shortDate } from "./PickDateSheet";

const people = [
  { name: "Ольга Смирнова", short: "Ольга", initials: "ОС", hint: "ведёт договор с клиентом" },   // вариант Vilar
  { name: "Павел Егоров", short: "Павел", initials: "ПЕ" },
  { name: "Мария Лебедева", short: "Мария", initials: "МЛ" },
];

/** Название поручения: карандаш — сразу правка на месте (текст переносится по строкам), галочка — сохранить. */
function EditableTitle({ text }: { text: string }) {
  const [value, setValue] = useState(text);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const pressing = useRef(false);   // палец на галочке: блюр поля не должен закрывать правку раньше нажатия
  useLayoutEffect(() => {           // поле растёт по высоте вместе с текстом
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);
  useEffect(() => {
    const el = input.current;
    if (editing && el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, [editing]);
  const finish = () => { setEditing(false); setValue((v) => (v.trim() ? v.trim() : text)); };
  return (
    <div className="row" style={{ gap: 12, alignItems: "flex-start", alignSelf: "stretch" }}>
      {editing
        ? <textarea ref={input} className="title-input t-title-m grow" rows={1} value={value} aria-label="Название поручения"
            onChange={(e) => setValue(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); finish(); } }}
            onBlur={() => { if (!pressing.current) finish(); }} />
        : <h1 className="t-title-m grow">{value}</h1>}
      <span onPointerDown={(e) => { pressing.current = true; e.preventDefault(); }} onPointerCancel={() => { pressing.current = false; }}>
        <IconButton icon={editing ? "check" : "edit"} size={36} label={editing ? "Сохранить" : "Изменить текст"}
          onClick={() => { pressing.current = false; if (editing) finish(); else setEditing(true); }} />
      </span>
    </div>
  );
}

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
            <EditableTitle text="Согласовать окно работ с клиентом" />
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
