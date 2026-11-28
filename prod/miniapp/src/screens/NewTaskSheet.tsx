import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, Icon, IconButton, Tag, Toggle, VilarHint, type IconName } from "../ui";
import { onToastCommit, report } from "../nav";
import { hasAccountLaunch } from "../api/mailBoard";
import { isoDay, newKey, trackerPost, useTaskRead, type ColumnCode, type People } from "../api/tracker";
import { useSwipeDown } from "../ui/useSwipeDown";
import { tick, whoop } from "../haptics";

/* Шторка «Новая задача» (макеты Figma «Sheet · new1–new4»).
   Заполняется по шагам: сначала тип, и каждое следующее поле появляется, только когда заполнено предыдущее.
   Высота шторки меняется плавно. Все выборы свои, без системных пикеров;
   людей подсказывает по первым буквам, встречу ставит в свободный слот календаря. */

type Kind = "project" | "meeting" | "assign" | "self";
const KINDS: { id: Kind; label: string; icon: IconName }[] = [
  { id: "project", label: "Задача по проекту", icon: "briefcase" },
  { id: "meeting", label: "Встреча", icon: "video" },
  { id: "assign", label: "Поручение", icon: "user-plus" },
  { id: "self", label: "Напомнить себе", icon: "bell" },
];

type Person = { name: string; tags: string[] };
const PEOPLE: Person[] = [
  { name: "Мария Лебедева", tags: ["интеграции"] },
  { name: "Максим Белов", tags: ["ИТ", "интеграции"] },
  { name: "Марина Соколова", tags: ["маркетинг"] },
  { name: "Ольга Смирнова", tags: ["продажи SMB"] },
  { name: "Павел Егоров", tags: ["ИТ"] },
  { name: "Алексей Новиков", tags: ["аналитика"] },
  { name: "Анна Волкова", tags: ["e-com"] },
  { name: "Дмитрий Козлов", tags: ["маркетинг"] },
  { name: "Екатерина Соколова", tags: ["HR"] },
  { name: "Сергей Морозов", tags: ["партнёрства"] },
  { name: "Наталья Павлова", tags: ["финансы"] },
  { name: "Игорь Фёдоров", tags: ["HR"] },
];
export const PROJECTS = [
  { name: "«Ромашка-Ритейл»", lead: "Мария Лебедева" },
  { name: "«ТехноСтрой»", lead: "Ольга Смирнова" },
  { name: "Бюджет Q1", lead: "Наталья Павлова" },
  { name: "Найм AM", lead: "Игорь Фёдоров" },
];
const initialsOf = (name: string) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const firstName = (name: string) => name.split(" ")[0];
/** «у кого»: Мария → Марии, Ольга → Ольги, Анна → Анны, Максим → Максима, Павел → Павла, Игорь → Игоря, Алексей → Алексея */
const genitive = (n: string) => {
  if (n.endsWith("ия")) return n.slice(0, -1) + "и";
  if (/[гкхжчшщ]а$/.test(n)) return n.slice(0, -1) + "и";
  if (n.endsWith("а")) return n.slice(0, -1) + "ы";
  if (/[ьй]$/.test(n)) return n.slice(0, -1) + "я";
  if (n === "Павел") return "Павла";
  return n + "а";
};

// даты: неделя от понедельника 7 декабря 2026
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_TITLE = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const TODAY = hasAccountLaunch ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(2026, 11, 7);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const dayLabel = (d: Date) => (same(d, TODAY) ? "Сегодня" : same(d, addDays(TODAY, 1)) ? "Завтра" : `${WD[d.getDay()][0].toUpperCase()}${WD[d.getDay()][1]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`);
const TIMES = ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];

// свободные слоты из календаря Outlook (у всех участников) — демо
const SLOTS: Record<string, [string, string][]> = {
  default: [["11:30–12:00", "перед вашим 1:1"], ["14:30–15:00", "у всех окно до 16:00"], ["16:00–16:30", "Павел до 17:00"], ["17:30–18:00", "конец дня у Ольги"]],
  today: [["15:00–15:30", "после 1:1 с Ольгой"], ["18:00–18:30", "у всех свободно"]],
};

/** Поле ввода (компонент Input): пустое и без фокуса — лейбл по центру (Body/M, состояние Default);
    в фокусе или с текстом — лейбл уезжает наверх и становится Caption, под ним ввод (состояние Focus) */
export function FloatField({ label, value, onChange, autoFocus, onDone, className = "", inputMode }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; onDone?: () => void; className?: string; inputMode?: "numeric" | "text" }) {
  return (
    <label className={`nt-input${value ? " is-filled" : ""} ${className}`}>
      <span className="nt-input__label t-body-m">{label}</span>
      <input className="t-body-m" autoFocus={autoFocus} value={value} inputMode={inputMode} enterKeyHint={onDone ? "done" : undefined}
             onChange={(e) => onChange(e.target.value)} onBlur={onDone}
             onKeyDown={(e) => { if (e.key === "Enter" && onDone) (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

/** Колонка канбана, куда добавится задача (её «Добавить» нажали); без колонки — в «Новые» */
let targetColumn: ColumnCode = "new";
export const openNewTask = (column: ColumnCode = "new") => { targetColumn = column; };

export function NewTaskSheet({ onClose, onToast }: { onClose: () => void; onToast: (id: string) => void }) {
  // После входа люди — из трекера, и шторка сама ставит задачу в трекер: её можно открыть с любого экрана, не только с канбана
  const team = useTaskRead<People>(hasAccountLaunch ? "people" : null);
  const livePeople = useMemo<Person[] | null>(() => (hasAccountLaunch ? (team.data?.rows ?? []).map((p) => ({ name: p.name, tags: [] })) : null), [team.data]);
  // один ключ повтора на одну форму: повтор того же запроса не создаст вторую задачу
  const idempotency = useRef(newKey());
  const [closing, setClosing] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [project, setProject] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [query, setQuery] = useState<string | null>(null);   // null — поле поиска закрыто
  const [day, setDay] = useState<Date | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [weekStart, setWeekStart] = useState(TODAY);
  const [slot, setSlot] = useState<number | null>(null);
  const [duration, setDuration] = useState<string | null>(null);
  const [toggle, setToggle] = useState(true);
  // название «готово», когда клавиатура закрылась (поле потеряло фокус) и прошло ещё полсекунды
  const [titleReady, setTitleReady] = useState(false);
  const readyTimer = useRef(0);
  const finishTitle = () => { clearTimeout(readyTimer.current); readyTimer.current = window.setTimeout(() => setTitleReady(true), 500); };

  // плавная высота: шторка подстраивается под содержимое с переходом, а не прыгает
  const sheet = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const fit = () => {
    const s = sheet.current, c = inner.current;
    if (!s || !c) return;
    const cs = getComputedStyle(s);
    s.style.height = `${c.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)}px`;
  };
  useLayoutEffect(fit);   // после каждого изменения состава полей
  useLayoutEffect(() => {   // и если поле само поменяло высоту (перенос текста, подсказки)
    const c = inner.current;
    if (!c) return;
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = (then?: () => void) => { setClosing(true); setTimeout(() => { onClose(); then?.(); }, 200); };
  useSwipeDown(sheet, onClose);   // свайп вниз — закрыть
  const multi = kind === "meeting";
  const lead = project !== null ? PROJECTS[project].lead : "";

  // смена типа: название остаётся, поля этого типа начинаются заново
  const pickKind = (k: Kind) => {
    if (k === kind) return;
    whoop(); setKind(k); setQuery(null); setPicker(false);
    setProject(null); setPeople([]); setSlot(null); setDuration(null); setDay(null); setTime(null);
  };
  const pickProject = (i: number) => { tick(); setProject(i); setPeople(livePeople && !livePeople.some((p) => p.name === PROJECTS[i].lead) ? [] : [PROJECTS[i].lead]); };

  // подсказки людей: совпадение с началом имени или фамилии; ведущий проекта — первым
  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.trim().toLowerCase();
    const list = (livePeople ?? PEOPLE).filter((p) => !people.includes(p.name) && (!q || p.name.toLowerCase().split(" ").some((w) => w.startsWith(q))));
    return list.sort((a, b) => Number(b.name === lead) - Number(a.name === lead)).slice(0, 4);
  }, [query, people, lead, livePeople]);
  const choose = (name: string) => { tick(); setPeople((p) => (multi ? [...p, name] : [name])); setQuery(null); };

  // шаги: что уже заполнено и что показывать дальше
  const titleDone = titleReady && title.trim().length > 0;
  const peopleDone = people.length > 0;
  const showProject = kind === "project";
  const showTitle = kind !== null && (kind !== "project" || project !== null);
  const showPeople = showTitle && titleDone && (kind === "project" || kind === "assign" || kind === "meeting");
  const showDue = kind === "self" ? showTitle && titleDone : (kind === "project" || kind === "assign") && showPeople && peopleDone;
  const showTime = showDue && day !== null;
  const showSlots = kind === "meeting" && showPeople && peopleDone;
  const showDuration = showSlots && slot !== null;
  const showFinal = kind === "meeting" ? showDuration && duration !== null : showTime && time !== null;

  const days = [TODAY, addDays(TODAY, 1), addDays(TODAY, 4)];
  const dayChips = !day || days.some((d) => same(d, day)) ? days : [...days.slice(0, 2), day];
  const slots = day && same(day, TODAY) ? SLOTS.today : SLOTS.default;

  const create = () => {
    if (!showFinal || !kind) return;
    const t = title.trim();
    if ((kind === "project" || kind === "assign") && day) {
      const due = `до ${day.getDate()} ${MONTHS_SHORT[day.getMonth()]}`;
      const projectName = kind === "project" && project !== null ? PROJECTS[project].name : null;
      if (hasAccountLaunch) {
        // POST /tracker/api/tasks с Idempotency-Key; «Просроченные» трекер считает сам — оттуда задача встаёт в «Новые»
        const person = team.data?.rows.find((p) => p.name === people[0]);
        const column = targetColumn === "overdue" ? "new" : targetColumn, key = idempotency.current;
        onToastCommit(() => {
          if (!person) return report("Исполнителя нет в трекере.");
          trackerPost("tasks", {
            title: t, kind, column, assignee_person_id: person.id, project: projectName, due_date: isoDay(day), due_time: time ?? null,
            participant_ids: [], duration_minutes: null, video_call: false, reminder: false,
          }, key).catch((e: Error) => report(e.message));
        });
      } else onToastCommit(() => window.dispatchEvent(new CustomEvent("vilar:task", { detail: { column: targetColumn, kind, day, time, task: { date: due, title: t, assignee: people[0], ...(projectName ? { project: projectName } : {}) } } })));
    }
    close(() => onToast(kind === "meeting" ? "t14" : kind === "self" ? "t15" : kind === "assign" ? "t16" : "t13"));
  };

  const name = (p: string) => {
    const q = (query ?? "").trim();
    if (!q) return <span className="t-body-l">{p}</span>;
    return <span className="t-body-l c-secondary">{p.split(" ").map((w, i) => {
      const hit = w.toLowerCase().startsWith(q.toLowerCase());
      return <span key={i}>{i > 0 && " "}{hit ? <><span className="c-primary">{w.slice(0, q.length)}</span>{w.slice(q.length)}</> : w}</span>;
    })}</span>;
  };

  const section = (key: string, label: string, children: React.ReactNode, extra?: React.ReactNode) => (
    <div key={key} className="nt-section nt-reveal">
      <span className="t-overline c-tertiary nt-label">{extra}{label}</span>
      {children}
    </div>
  );

  const peopleField = (label: string) => (
    <>
      <div className="nt-chips">
        {people.map((p) => (
          <button key={p} type="button" className="person-chip person-chip--hug" onClick={() => { tick(); setPeople((x) => x.filter((n) => n !== p)); }} aria-label={`Убрать ${p}`}>
            <Avatar initials={initialsOf(p)} size={28} /><span className="t-body-m-medium">{p}</span>
          </button>
        ))}
        {query === null && (
          <button type="button" className="person-chip person-chip--hug" onClick={() => setQuery("")}>
            <span className="person-chip__plus"><Icon name="plus" size={16} /></span><span className="t-body-m-medium">{people.length && !multi ? "Сменить" : "Добавить"}</span>
          </button>
        )}
      </div>
      {query !== null && (
        <>
          <FloatField className="nt-reveal" label={label} value={query} autoFocus onChange={setQuery} />
          {suggestions.length > 0 && (
            <div className="nt-suggest">
              {suggestions.map((p) => (
                <button key={p.name} type="button" className={`nt-suggest__row${p.name === lead && kind !== "meeting" ? " is-top" : ""}`} onClick={() => choose(p.name)}>
                  <Avatar initials={initialsOf(p.name)} size={28} />
                  <span className="nt-suggest__text">
                    {name(p.name)}
                    <span className="tags">{(p.name === lead && project !== null ? [`ведёт ${PROJECTS[project].name}`] : p.tags).map((t) => <Tag key={t} label={t} />)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );

  const dueField = (
    <>
      <div className="nt-chips">
        {dayChips.map((d) => <button key={d.toDateString()} type="button" className={`nt-chip t-body-m-medium${day && same(d, day) ? " is-on" : ""}`} onClick={() => { tick(); setDay(d); }}>{dayLabel(d)}</button>)}
        <button type="button" className={`nt-chip nt-chip--icon${picker ? " is-on" : ""}`} aria-label="Другая дата" onClick={() => { tick(); setPicker((v) => !v); }}><Icon name="calendar" size={20} /></button>
      </div>
      {picker && (
        <div className="nt-picker nt-reveal">
          <div className="nt-picker__head">
            <span className="t-body-m-medium">{MONTHS_TITLE[addDays(weekStart, 3).getMonth()]} {addDays(weekStart, 3).getFullYear()}</span>
            <span className="row" style={{ gap: 8 }}>
              <IconButton icon="chevron-left" size={36} label="Предыдущая неделя" onClick={() => setWeekStart((w) => addDays(w, -7))} />
              <IconButton icon="chevron-right" size={36} label="Следующая неделя" onClick={() => setWeekStart((w) => addDays(w, 7))} />
            </span>
          </div>
          <div className="nt-week">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
              const off = d.getDay() === 0 || d.getDay() === 6;
              return (
                <button key={d.toDateString()} type="button" className={`nt-day${day && same(d, day) ? " is-on" : ""}${off ? " is-off" : ""}`} onClick={() => { tick(); setDay(d); }}>
                  <span className="t-caption">{WD[d.getDay()]}</span>
                  <span className="t-body-l">{d.getDate()}</span>
                  <span className={`nt-day__dot${same(d, TODAY) ? " is-today" : ""}`} />
                </button>
              );
            })}
          </div>
          {day && (
            <>
              <span className="t-overline c-tertiary">Время</span>
              <div className="nt-times">
                {TIMES.map((t) => <button key={t} type="button" className={`nt-chip nt-chip--surface t-body-m-medium${t === time ? " is-on" : ""}`} onClick={() => { tick(); setTime(t); }}>{t}</button>)}
              </div>
            </>
          )}
        </div>
      )}
      {showTime && !picker && (
        <div className="nt-chips nt-reveal">
          {["12:00", "15:00", "18:00"].map((t) => <button key={t} type="button" className={`nt-chip t-body-m-medium${t === time ? " is-on" : ""}`} onClick={() => { tick(); setTime(t); }}>{t}</button>)}
          <button type="button" className={`nt-chip nt-chip--icon${time && !["12:00", "15:00", "18:00"].includes(time) ? " is-on" : ""}`} aria-label="Другое время" onClick={() => { tick(); setPicker(true); }}><Icon name="clock" size={20} /></button>
        </div>
      )}
      {day && time && people[0] && kind !== "self" && <VilarHint text={`${day.getDate()} ${MONTHS[day.getMonth()]} в ${time} у ${genitive(firstName(people[0]))} нет встреч`} />}
    </>
  );

  return (
    <div className={`sheet-layer${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Новая задача">
      <button type="button" className="sheet-scrim" aria-label="Закрыть" onClick={() => close()} />
      <div className="sheet nt" ref={sheet}>
        <div className="nt-inner" ref={inner}>
          <span className="sheet__handle" />
          <div className="nt-header">
            <h2 className="t-title-l">Новая задача</h2>
            <IconButton icon="close" label="Закрыть" onClick={() => close()} />
          </div>

          <div className="nt-section">
            <span className="t-overline c-tertiary nt-label">Тип</span>
            <div className="nt-chips">
              {KINDS.map((k) => (
                <button key={k.id} type="button" className={`nt-chip nt-chip--big t-body-m-medium${k.id === kind ? " is-on" : ""}`} onClick={() => pickKind(k.id)}>
                  <Icon name={k.icon} size={20} />{k.label}
                </button>
              ))}
            </div>
          </div>

          {showProject && section("project", "Проект", (
            <div className="nt-chips">
              {PROJECTS.map((p, i) => <button key={p.name} type="button" className={`nt-chip t-body-m-medium${i === project ? " is-on" : ""}`} onClick={() => pickProject(i)}>{p.name}</button>)}
            </div>
          ))}

          {showTitle && (
            <FloatField key={`title-${kind}`} className="nt-reveal" label={kind === "meeting" ? "Название встречи" : kind === "self" ? "О чём напомнить" : "Название"} value={title} onChange={setTitle} onDone={finishTitle} />
          )}

          {showPeople && kind === "meeting" && section("people-m", "Участники", peopleField("Участник"))}
          {showPeople && (kind === "project" || kind === "assign") && section("people", "Ответственный", (
            <>
              {peopleField("Ответственный")}
              {kind === "project" && query === null && project !== null && people[0] === lead && <VilarHint text={`ведёт проект ${PROJECTS[project].name}`} />}
            </>
          ))}

          {showSlots && section("slots", "Свободные слоты из календаря Outlook", (
            <>
              <div className="nt-chips">
                {days.map((d) => <button key={d.toDateString()} type="button" className={`nt-chip t-body-m-medium${(day ?? addDays(TODAY, 4)) && same(d, day ?? addDays(TODAY, 4)) ? " is-on" : ""}`} onClick={() => { tick(); setDay(d); setSlot(null); }}>{dayLabel(d)}</button>)}
              </div>
              <div className="nt-slots">
                {slots.map(([t, note], i) => (
                  <button key={t} type="button" className={`nt-slot${i === slot ? " is-on" : ""}`} onClick={() => { tick(); setSlot(i); }}>
                    <span className="t-body-l">{t}</span><span className="t-body-m nt-slot__note">{note}</span>
                  </button>
                ))}
              </div>
              <VilarHint text="Свободно у всех участников — занятые окна не показываю" />
            </>
          ), <img src="./assets/logos/outlook-calendar.svg" width={16} height={16} alt="" />)}
          {showDuration && section("duration", "Длительность", (
            <div className="nt-chips">
              {["15 мин", "30 мин", "45 мин", "1 час"].map((d) => <button key={d} type="button" className={`nt-chip t-body-m-medium${d === duration ? " is-on" : ""}`} onClick={() => { tick(); setDuration(d); }}>{d}</button>)}
            </div>
          ))}

          {showDue && section("due", kind === "self" ? "Когда напомнить" : "Дедлайн", dueField)}

          {showFinal && (
            <div key="final" className="nt-final nt-reveal">
              <div className="nt-toggle">
                <span className="list-row__text">
                  <span className="t-body-l">{kind === "meeting" ? "Видеозвонок" : kind === "self" ? "Напомнить ещё и в Telegram" : "Напомнить за день"}</span>
                  <span className="t-body-m c-secondary">{kind === "meeting" ? "ссылка придёт участникам в приглашении" : kind === "self" ? "сообщением от Vilar" : "Vilar напишет ответственному и вам"}</span>
                </span>
                <Toggle on={toggle} onChange={setToggle} label="Переключатель" />
              </div>
              <Button label={kind === "meeting" ? "Создать встречу" : kind === "self" ? "Напомнить" : kind === "assign" ? "Поручить" : "Создать задачу"} fill onClick={create} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
