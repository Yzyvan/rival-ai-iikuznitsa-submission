import { useEffect, useRef, useState, type ReactNode } from "react";
import { glow, playGlow } from "../data/content";
import { Button, Icon, Tag, Tags, Toggle, VilarHint, VilarMessage } from "../ui";
import { buzz, buzzSent, tick, whoop } from "../haptics";
import { OutlookConnections } from "./OutlookConnections";
import { FloatField } from "./NewTaskSheet";

/* Первый вход: регистрация на подложке прелоудера (ряд «§ Первый вход» в Figma).
   Сверху — степпер и заголовок шага, снизу — блок настройки; шаги сменяются внутри одного экрана. */

const DONE_KEY = "vilar:onboarded";
/** Показывать ли регистрацию: ?onboarding — всегда; иначе — пока пользователь её не прошёл */
export function needOnboarding(skipPreloader: boolean, deepTarget: boolean) {
  const q = new URLSearchParams(location.search);
  if (q.has("onboarding")) return true;
  if (skipPreloader || deepTarget) return false;
  try { return localStorage.getItem(DONE_KEY) !== "1"; } catch { return false; }
}

/* ── мелкие части ── */
function Steps({ at }: { at: number }) {
  return <div className="onb-steps" aria-label={`Шаг ${at + 1} из 5`}>{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i === at ? "is-on" : ""} />)}</div>;
}
function Label({ children }: { children: ReactNode }) { return <span className="t-overline onb-label">{children}</span>; }
function Divider() { return <div className="onb-divider"><i /><span className="t-overline">Сводка</span><i /></div>; }
function Check({ on }: { on: boolean }) {
  return <span className={`onb-check${on ? " is-on" : ""}`} aria-hidden="true">{on && <svg viewBox="0 0 16 16" width="16" height="16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>;
}
function Option({ title, sub, on, onClick }: { title: string; sub?: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} className="onb-opt" onClick={() => { tick(); onClick(); }}>
      <span className="list-row__text"><span className="t-body-l">{title}</span>{sub && <span className="t-body-m c-secondary">{sub}</span>}</span>
      <Check on={on} />
    </button>
  );
}
function Chips({ items, at, onPick, spread }: { items: string[]; at: number; onPick: (i: number) => void; spread?: boolean }) {
  return (
    <div className={`onb-chips${spread ? " onb-chips--spread" : ""}`}>
      {items.map((c, i) => <button key={c} type="button" className={`nt-chip t-body-m-medium${i === at ? " is-on" : ""}`} onClick={() => { if (i !== at) tick(); onPick(i); }}>{c}</button>)}
    </div>
  );
}
function ToggleCard({ title, sub, on, onChange }: { title: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div className="list-row__text"><span className="t-body-l">{title}</span>{sub && <span className="t-body-m c-secondary">{sub}</span>}</div>
      <Toggle on={on} onChange={(v) => { tick(); onChange(v); }} label={title} />
    </div>
  );
}
/** Ползунок с пятью рисками: останавливается только на них (как выбор уровня модели) */
function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const at = (x: number) => { const r = box.current!.getBoundingClientRect(); return Math.max(0, Math.min(4, Math.round(((x - r.left - 14) / (r.width - 28)) * 4))); };
  const set = (x: number) => { const v = at(x); if (v !== value) { tick(); onChange(v); } };
  return (
    <div ref={box} className="onb-slider" role="slider" aria-valuemin={0} aria-valuemax={4} aria-valuenow={value}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); set(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons) set(e.clientX); }}>
      <span className="onb-slider__track" />
      <span className="onb-slider__fill" style={{ width: `calc((100% - 28px) * ${value / 4})` }} />
      {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`onb-slider__notch${i <= value ? " is-on" : ""}`} style={{ left: `calc(14px + (100% - 28px) * ${i / 4})` }} />)}
      <span className="onb-slider__thumb" style={{ left: `calc(14px + (100% - 28px) * ${value / 4})` }} />
    </div>
  );
}

/* ── данные ── */
const STATUSES = ["Актуален", "Заморожен", "Не нужен", "Позже"];
const PROJECTS: { name: string; tags: string[]; status: number; hint?: string }[] = [
  { name: "«Ромашка-Ритейл»", tags: ["пилот 11 дек", "основание: встреча «Интеграция», 4 дек"], status: 0 },
  { name: "«ТехноСтрой»", tags: ["КП на 40 лицензий", "основание: цепочка писем, 3 дек"], status: 0 },
  { name: "Партнёрский канал", tags: ["план Q1 до 21 дек", "основание: поручение Сергею Морозову"], status: 0 },
  { name: "«Ромашка Ритейл» · поддержка", tags: ["нагрузка на поддержку", "основание: поручение Марии, 4 дек"], status: 1, hint: "похоже на «Ромашка-Ритейл» — объединить?" },
];
const LEVELS = ["Совсем неважно", "Неважно", "Средне", "Важно", "Очень важно"];
const KINDS = [
  { title: "Встречи с партнёрами", sub: "пример: Партнёрский канал, четверг 15:00", on: true },
  { title: "Согласование бюджетов", sub: "пример: перенос 400 тыс. ₽ в digital", on: true },
  { title: "КП и скидки клиентам", sub: "пример: скидка 12% для «ТехноСтрой»", on: true },
  { title: "Найм", sub: "пример: оффер аккаунт-менеджеру", on: true },
  { title: "Планёрки команды", sub: "пример: e-com, понедельник", on: false },
];
const BUDGET = ["20 тыс. ₽", "100 тыс. ₽", "Любая", "Другое"];
const DISCOUNT = ["5%", "10%", "Любая", "Другое"];
const IMPORTANCE = ["Очень важно", "Важно и выше", "Средне и выше", "Любая"];
const LEADS = ["за 30 мин", "за 1 час", "за 2 часа", "Зависит от проекта"];
const LEAD_MIN = [30, 60, 120, 60];
const CONSEQ = [
  { title: "Сорвём срок клиенту", sub: "например, пилот «Ромашка-Ритейл» 11 декабря" },
  { title: "Команда будет ждать", sub: "коллеги не начнут работу без вашего решения" },
  { title: "Потеряем деньги", sub: "сделка или бюджет под риском" },
  { title: "Другое", sub: "опишу сам" },
  { title: "Пока не знаю", sub: "спрошу позже, когда появятся данные" },
];
const NOTIFY = [
  { title: "Сразу", sub: "напишу, даже если вы на встрече" },
  { title: "В ближайший перерыв", sub: "в 16:00, между встречами" },
  { title: "В сводке", sub: "вечером, одним списком" },
];
const AUTH_PROJECTS = ["«Ромашка-Ритейл»", "«ТехноСтрой»", "Партнёрский канал"];
const ACTIONS = ["Переносы встреч", "Напоминания", "Условия клиенту"];
const ACTION_GEN = ["переносы встреч", "напоминания исполнителям", "изменения условий клиенту"];
const MODES = ["Только предложить", "Спросить перед выполнением", "Выполнить и сообщить"];

const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const lower = (s: string) => s[0].toLowerCase() + s.slice(1);

/** Шаги: заголовок, подзаголовок, номер точки в степпере */
const SCREENS = [
  { title: "Подключения", sub: "Дайте доступ — по ним я соберу ваши проекты и встречи", step: 0 },
  { title: "Найденные проекты", sub: "Отметьте, что из этого сейчас в работе", step: 1 },
  { title: "Важность проектов", sub: "От этого зависит, с чем я прихожу к вам, а что решаю сам", step: 1 },
  { title: "Виды работы", sub: "Какие из этих дел требуют вашего времени?", step: 1 },
  { title: "Когда приходить к вам", sub: "Остальное решаю сам и сообщаю в вечерней сводке", step: 1 },
  { title: "Подготовка", sub: "Встречи с партнёрами", step: 2 },
  { title: "Что пострадает", sub: "Если вы ответите партнёру только после встречи — чем это грозит?", step: 2 },
  { title: "Когда сообщить", sub: "Если после вашей встречи подходящего окна уже не останется", step: 2 },
  { title: "Что Vilar может сам", sub: "Выберите проект и действие — и как мне поступать", step: 3 },
  { title: "План на завтра", sub: "Подготовку я поставил в свободное окно", step: 4 },
];

export function Onboarding({ active, onDone }: { active: boolean; onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { playGlow(video.current); }, []);
  const [back, setBack] = useState<number | null>(null);   // пришли поправить шаг с последнего экрана — после сохранения сразу туда
  const go = (n: number) => { whoop(); setI(n); body.current?.scrollTo({ top: 0 }); };
  const next = () => { if (back !== null) { const b = back; setBack(null); go(b); } else go(i + 1); };
  const finish = () => {
    buzzSent();
    try { localStorage.setItem(DONE_KEY, "1"); } catch { /* приватный режим */ }
    setLeaving(true); setTimeout(onDone, 600);
  };

  // состояние ответов
  const [projects, setProjects] = useState(PROJECTS);
  const [proj, setProj] = useState(PROJECTS.map((p) => p.status));
  const active3 = projects.map((p, k) => ({ ...p, k })).filter((p) => proj[p.k] === 0);
  const [imp, setImp] = useState<number[]>([4, 3, 2, 2]);
  const [newProject, setNewProject] = useState<string | null>(null);   // null — поле закрыто
  const addProject = () => { const n = (newProject ?? "").trim(); if (n) { buzz("light"); setProjects((a) => [...a, { name: n, tags: ["добавлен вами"], status: 0 }]); setProj((a) => [...a, 0]); setImp((a) => [...a, 2]); } setNewProject(null); };
  const [kindList, setKindList] = useState(KINDS);
  const [kinds, setKinds] = useState(KINDS.map((k) => k.on));
  const [newKind, setNewKind] = useState<string | null>(null);
  const addKind = () => { const n = (newKind ?? "").trim(); if (n) { buzz("light"); setKindList((a) => [...a, { title: n, sub: "добавлено вами", on: true }]); setKinds((a) => [...a, true]); } setNewKind(null); };
  const [budgetOwn, setBudgetOwn] = useState(""), [discOwn, setDiscOwn] = useState("");
  const [budget, setBudget] = useState(0), [disc, setDisc] = useState(1), [impMin, setImpMin] = useState(1);
  const [always, setAlways] = useState([true, true]);
  const [mins, setMins] = useState("40"), [oneBlock, setOneBlock] = useState(true), [lead, setLead] = useState(1);
  const [conseq, setConseq] = useState([true, true, false, false, false]);
  const [notify, setNotify] = useState(1);
  const [ap, setAp] = useState(0), [act, setAct] = useState(0);
  const [modes, setModes] = useState<Record<string, number>>({ "0:0": 1 });
  const mode = modes[`${ap}:${act}`] ?? 2;

  const m = Math.max(10, Math.min(240, parseInt(mins, 10) || 40));
  const end = 15 * 60 - LEAD_MIN[lead], start = end - m;
  const nKinds = kinds.filter(Boolean).length + 1;   // + «Совет директоров» — редкое, но важное
  const alwaysList = ["письма руководству", "обязательства клиентам"].filter((_, k) => always[k]);
  const money = (v: string) => Number(v).toLocaleString("ru-RU");
  const rules = [
    budget < 2 ? `бюджет больше ${BUDGET[budget]}` : budget === 3 && budgetOwn ? `бюджет больше ${money(budgetOwn)} ₽` : "любой бюджет",
    disc < 2 ? `скидка больше ${DISCOUNT[disc]}` : disc === 3 && discOwn ? `скидка больше ${discOwn}%` : "любая скидка",
    ["проект «очень важно»", "проект «важно» и выше", "проект «средне» и выше", "любой проект"][impMin],
  ];
  const modeLine = (k: number) => k === 0 ? "только предложу и ничего не сделаю сам" : k === 1 ? "сначала согласую с вами" : "сделаю сам и сообщу";

  const s = SCREENS[i];
  let content: ReactNode;
  switch (i) {
    case 0: content = (<>
      <div className="onb-card onb-card--row">
        <img src="./assets/logos/telegram.svg" width={32} height={32} alt="" />
        <span className="list-row__text"><span className="t-body-l">Telegram</span><span className="t-body-m c-secondary">Бот и мини-апп Vilar</span></span>
      </div>
      <OutlookConnections />
      <Button label="Дальше" fill onClick={next} />
    </>); break;
    case 1: content = (<>
      {projects.map((p, k) => (
        <div key={p.name} className="onb-card">
          <span className="t-body-l">{p.name}</span>
          <Tags items={p.tags} />
          {p.hint && <VilarHint text={p.hint} />}
          <Chips items={STATUSES} at={proj[k]} spread onPick={(v) => setProj((a) => a.map((x, j) => (j === k ? v : x)))} />
        </div>
      ))}
      {newProject !== null
        ? <div className="onb-card"><FloatField label="Название проекта" value={newProject} onChange={setNewProject} autoFocus onDone={addProject} className="onb-field" /><Button label="Добавить" size="s" fill onClick={addProject} /></div>
        : <Button label="Добавить проект" variant="secondary" fill onClick={() => { tick(); setNewProject(""); }} />}
      <Button label={active3.length ? `Дальше · ${active3.length} ${active3.length === 1 ? "актуальный" : "актуальных"}` : "Дальше"} fill onClick={() => go(active3.length ? 2 : 3)} />
    </>); break;
    case 2: content = (<>
      {active3.map((p) => (
        <div key={p.name} className="onb-card onb-card--gap16">
          <div className="onb-head"><span className="t-body-l">{p.name}</span><span className="t-body-l c-secondary">{LEVELS[imp[p.k]]}</span></div>
          <Slider value={imp[p.k]} onChange={(v) => setImp((a) => a.map((x, j) => (j === p.k ? v : x)))} />
          <div className="onb-head t-caption-medium c-tertiary"><span>неважно</span><span>очень важно</span></div>
        </div>
      ))}
      <VilarHint text="Порог важности, с которого прихожу к вам, настроим чуть дальше" />
      <Button label="Дальше" fill onClick={next} />
    </>); break;
    case 3: content = (<>
      {kindList.map((k, n) => <ToggleCard key={k.title} title={k.title} sub={k.sub} on={kinds[n]} onChange={(v) => setKinds((a) => a.map((x, j) => (j === n ? v : x)))} />)}
      <div className="onb-card">
        <div className="onb-head onb-head--start"><span className="t-body-l">Совет директоров</span><Tag label="редкое" /></div>
        <Tags items={["раз в квартал", "источник: письмо Виктора Орлова"]} />
        <VilarHint text="редкое, но важное — не теряю среди частых дел" />
      </div>
      {newKind !== null
        ? <div className="onb-card"><FloatField label="Вид работы" value={newKind} onChange={setNewKind} autoFocus onDone={addKind} className="onb-field" /><Button label="Добавить" size="s" fill onClick={addKind} /></div>
        : <Button label="Ввести свой вид работы" variant="secondary" fill onClick={() => { tick(); setNewKind(""); }} />}
      <Button label={`Подтвердить ${nKinds} ${nKinds % 10 >= 2 && nKinds % 10 <= 4 && (nKinds < 10 || nKinds > 20) ? "вида" : nKinds % 10 === 1 && nKinds !== 11 ? "вид" : "видов"}`} fill onClick={next} />
    </>); break;
    case 4: content = (<>
      <Label>Деньги</Label>
      <div className="onb-card"><span className="t-body-l">Согласование бюджета</span><span className="t-body-m c-secondary">прихожу, если сумма больше</span><Chips items={BUDGET} at={budget} onPick={setBudget} />{budget === 3 && <FloatField label="Сумма, ₽" inputMode="numeric" value={budgetOwn} onChange={(v) => setBudgetOwn(v.replace(/\D/g, "").slice(0, 9))} autoFocus className="onb-field" />}</div>
      <div className="onb-card"><span className="t-body-l">Скидки клиентам</span><span className="t-body-m c-secondary">прихожу, если скидка больше</span><Chips items={DISCOUNT} at={disc} onPick={setDisc} />{disc === 3 && <FloatField label="Скидка, %" inputMode="numeric" value={discOwn} onChange={(v) => setDiscOwn(v.replace(/\D/g, "").slice(0, 2))} autoFocus className="onb-field" />}</div>
      <Label>Проекты</Label>
      <div className="onb-card"><span className="t-body-l">Вопросы по проекту</span><span className="t-body-m c-secondary">прихожу, если важность проекта</span><Chips items={IMPORTANCE} at={impMin} onPick={setImpMin} /></div>
      <Label>Всегда к вам</Label>
      <ToggleCard title="Письма руководству" sub="отправляю только после вашего «да»" on={always[0]} onChange={(v) => setAlways([v, always[1]])} />
      <ToggleCard title="Обязательства клиентам" sub="сроки, условия договора" on={always[1]} onChange={(v) => setAlways([always[0], v])} />
      <Divider />
      <VilarMessage text={`Свод правил для вас: прихожу, если ${rules.join(", ").replace(/, ([^,]*)$/, " или $1")}.${alwaysList.length ? ` ${alwaysList.join(" и ").replace(/^./, (c) => c.toUpperCase())} — всегда к вам.` : ""}`} />
      <Button label="Сохранить правила" fill onClick={next} />
    </>); break;
    case 5: content = (<>
      <Label>Сколько минут вы обычно готовитесь?</Label>
      <FloatField label="Минуты" inputMode="numeric" value={mins} onChange={(v) => setMins(v.replace(/\D/g, "").slice(0, 3))} />
      <ToggleCard title="Нужен один свободный блок" sub="не дробить подготовку на куски" on={oneBlock} onChange={setOneBlock} />
      <Label>За сколько до встречи закончить?</Label>
      <Chips items={LEADS} at={lead} onPick={setLead} />
      <Divider />
      <VilarMessage text={`Итог: ${m} минут${oneBlock ? " подряд" : ""}, закончить ${LEADS[lead === 3 ? 1 : lead]} до встречи. Для четверга в 15:00 — с ${hhmm(start)} до ${hhmm(end)}.`} />
      <Button label="Сохранить" fill onClick={next} />
    </>); break;
    case 6: content = (<>
      {CONSEQ.map((c, n) => <Option key={c.title} title={c.title} sub={c.sub} on={conseq[n]} onClick={() => setConseq((a) => a.map((x, j) => (j === n ? !x : x)))} />)}
      <VilarHint text="ваша оценка сохраняется отдельно от того, что я нашёл в источниках" />
      <Button label="Дальше" fill onClick={next} />
    </>); break;
    case 7: content = (<>
      <VilarMessage text="Пример: встреча с партнёром до 16:00, а решение по скидке «ТехноСтрой» нужно до 17:00. После встречи окна на подготовку ответа уже не будет." />
      {NOTIFY.map((o, n) => <Option key={o.title} title={o.title} sub={o.sub} on={notify === n} onClick={() => setNotify(n)} />)}
      <Button label="Сохранить" fill onClick={next} />
    </>); break;
    case 8: content = (<>
      <Label>Проект</Label>
      <Chips items={AUTH_PROJECTS} at={ap} onPick={setAp} />
      <Label>Действие</Label>
      <Chips items={ACTIONS} at={act} onPick={setAct} />
      <Label>Режим</Label>
      {MODES.map((o, n) => <Option key={o} title={o} on={mode === n} onClick={() => setModes((r) => ({ ...r, [`${ap}:${act}`]: n }))} />)}
      <Divider />
      <VilarMessage text={`В ${AUTH_PROJECTS[ap]} ${ACTION_GEN[act]} — ${modeLine(mode)}.`} />
      <Button label="Сохранить правило" fill onClick={next} />
    </>); break;
    default: content = (<>
      <VilarMessage text={`Подготовку к встрече с партнёром поставил на ${hhmm(start)}–${hhmm(end)} — закончите ${lower(LEADS[lead === 3 ? 1 : lead])} до начала.`} />
      <div className="onb-day">
        {[["10:00–11:00", "Планёрка e-com"], ["12:00–12:30", "1:1 с Ольгой"], [`${hhmm(start)}–${hhmm(end)}`, "Подготовка к встрече с партнёром", "new"], ["15:00–16:00", "Встреча с партнёром"]]
          .sort((a, b) => parseInt(a[0]) * 60 + parseInt(a[0].split(":")[1]) - (parseInt(b[0]) * 60 + parseInt(b[0].split(":")[1])))
          .map(([t, w, isNew]) => <div key={t + w} className={`onb-slot${isNew ? " is-new" : ""}`}><span className="t-body-m">{t}</span><span className="t-body-l">{w}</span></div>)}
      </div>
      <div className="onb-actions">
        <Button label="Изменить подготовку" variant="secondary" fill onClick={() => { setBack(9); go(5); }} />
        <Button label="Подходит" fill onClick={finish} />
      </div>
    </>);
  }

  return (
    <div className={`onb${active ? " is-active" : ""}${leaving ? " is-leaving" : ""}`} style={{ backgroundColor: glow.base, backgroundImage: `url(${glow.poster})` }}>
      <video ref={video} className="preloader__glow" disablePictureInPicture controls={false} autoPlay muted loop playsInline preload="auto" poster={glow.poster} aria-hidden="true">
        <source src={glow.webm} type="video/webm" />
        <source src={glow.mp4} type="video/mp4" />
      </video>
      <div className="onb__top">
        <div key={`h${i}`} className="onb__header">
          <h1 className="t-title-l">{s.title}</h1>
          <p className="t-body-m c-secondary">{s.sub}</p>
        </div>
        <Steps at={s.step} />
      </div>
      <div ref={body} className="onb__block">
        <div key={`b${i}`} className="onb__content">{content}</div>
      </div>
    </div>
  );
}
