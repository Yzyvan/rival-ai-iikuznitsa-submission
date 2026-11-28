import { useEffect, useRef, useState, type ReactNode } from "react";
import { glow, playGlow } from "../data/content";
import { Button, Icon, Tag, Tags, Toggle, VilarHint, VilarMessage } from "../ui";
import { buzz, buzzSent, tick, whoop } from "../haptics";
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
/** Правило, которое нельзя отключить: та же карточка, но без переключателя */
function FixedCard({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="toggle-row">
      <div className="list-row__text"><span className="t-body-l">{title}</span>{sub && <span className="t-body-m c-secondary">{sub}</span>}</div>
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
  // fixed — решает только руководитель (деньги, обязательства клиентам, кадры): отключить нельзя
  { title: "Согласование бюджетов", sub: "пример: перенос 400 тыс. ₽ в digital", on: true, fixed: true },
  { title: "КП и скидки клиентам", sub: "пример: скидка 12% для «ТехноСтрой»", on: true, fixed: true },
  { title: "Найм", sub: "пример: оффер аккаунт-менеджеру", on: true, fixed: true },
  { title: "Планёрки команды", sub: "пример: e-com, понедельник", on: false },
];
// То, что Vilar никогда не решает сам. Порогов по сумме нет: деньги и бюджеты — к руководителю при любой сумме.
const ALWAYS = [
  { title: "Деньги и бюджеты", sub: "скидки, перераспределения, закупки — любая сумма" },
  { title: "Кадры", sub: "найм, офферы, отпуска, увольнения" },
  { title: "Обязательства клиентам", sub: "сроки, условия, гарантии" },
  { title: "Письма руководству", sub: "коммерческому директору и выше" },
];
const IMPORTANCE = ["Очень важно", "Важно и выше", "Средне и выше", "Любая"];
const LEADS = ["за 15 мин", "за 30 мин", "за 1 час", "Другое"];
const LEAD_MIN = [15, 30, 60];
const MEET_KINDS = [
  { title: "Встречи с партнёрами", sub: "Партнёрский канал, четверг 15:00", on: true },
  { title: "Встречи с клиентами", sub: "«Ромашка-Ритейл», «ТехноСтрой»", on: true },
  { title: "Комитеты и советы", sub: "бюджет, совет директоров", on: true },
  { title: "Планёрки и 1:1", sub: "с командой", on: false },
];
/** Встречи завтрашнего дня и их тип (индекс в MEET_KINDS) — для последнего экрана */
const TOMORROW: [from: number, to: number, title: string, kind: number][] = [
  [600, 660, "Планёрка e-com", 3], [720, 750, "1:1 с Ольгой", 3], [900, 960, "Встреча с партнёром", 0], [990, 1050, "Комитет по бюджету Q1", 2],
];
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
const ACTIONS = ["Переносы внутренних встреч", "Напоминания исполнителям", "Передача запросов команде"];
const MODES = ["Предложить", "Спросить", "Сделать сам"];
const VERB = ["только предлагаю", "сначала согласую с вами", "делаю сам и сообщаю"];
const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const NUM = ["ни одной", "одной", "двум", "трём", "четырём"];

const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const joinAnd = (a: string[]) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} и ${a[a.length - 1]}`);

/** Шаги: заголовок, подзаголовок, номер точки в степпере */
const SCREENS = [
  { title: "Подключения", sub: "Дайте доступ — по ним я соберу ваши проекты и встречи", step: 0 },
  { title: "Найденные проекты", sub: "Отметьте, что из этого сейчас в работе", step: 1 },
  { title: "Важность проектов", sub: "От этого зависит, с чем я прихожу к вам, а что решаю сам", step: 1 },
  { title: "Виды работы", sub: "Какие из этих дел требуют вашего времени?", step: 1 },
  { title: "Что делать не смогу", sub: "Это решаете только вы. Остальное делаю сам и сообщаю в утренней сводке", step: 1 },
  { title: "Резюме перед встречей", sub: "Пришлю, кто будет, о чём договорились в прошлый раз и что нужно решить", step: 2 },
  { title: "Что пострадает", sub: "Если вы ответите партнёру только после встречи — чем это грозит?", step: 2 },
  { title: "Когда вам писать", sub: "Если после вашей встречи подходящего окна уже не останется", step: 2 },
  { title: "Что Vilar делает сам", sub: "Как поступать с каждым видом действий — для всех проектов и отдельно", step: 3 },
  { title: "Всё готово", sub: "Так я помогу вам завтра", step: 4 },
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
  const [outlook, setOutlook] = useState(false);
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
  const [impMin, setImpMin] = useState(1);
  const [lead, setLead] = useState(1), [leadOwn, setLeadOwn] = useState("");
  const [meetKinds, setMeetKinds] = useState(MEET_KINDS.map((k) => k.on));
  const [conseq, setConseq] = useState([true, true, false, false, false]);
  const [notify, setNotify] = useState(1);
  // полномочия: общий режим для всех проектов и отличия по проектам (null — как для всех)
  const [allModes, setAllModes] = useState([2, 2, 2]);
  const [own, setOwn] = useState<(number | null)[][]>([[1, null, null], [null, null, null], [null, null, null]]);
  const [open, setOpen] = useState<number | null>(0);
  const modeOf = (p: number, a: number) => own[p][a] ?? allModes[a];
  const setMode = (p: number | null, a: number, v: number) => {
    if (p === null) setAllModes((m) => m.map((x, k) => (k === a ? v : x)));
    else setOwn((o) => o.map((r, k) => (k === p ? r.map((x, j) => (j === a ? (v === allModes[a] ? null : v) : x)) : r)));
  };
  const differs = (p: number, a: number) => own[p][a] !== null && own[p][a] !== allModes[a];
  const diffs = (p: number) => ACTIONS.filter((_, a) => differs(p, a)).length;
  const diffLabel = (p: number) => (diffs(p) ? `${diffs(p)} ${plural(diffs(p), "отличие", "отличия", "отличий")}` : "как для всех");
  const authSummary = (() => {
    const byMode = [2, 1, 0].map((v) => [v, ACTIONS.filter((_, a) => allModes[a] === v).map((t) => t.toLowerCase())] as const).map(([v, acts]) => (acts.length ? `${joinAnd([...acts])} ${VERB[v]}` : "")).filter(Boolean);
    const ex = AUTH_PROJECTS.map((p, k) => { const d = ACTIONS.map((t, a) => (differs(k, a) ? `${t.toLowerCase()} ${VERB[own[k][a]!]}` : "")).filter(Boolean); return d.length ? `В ${p} ${joinAnd(d)}.` : ""; }).filter(Boolean);
    return `${cap(byMode.join(", "))}.${ex.length ? " " + ex.join(" ") : ""}`;
  })();
  const leadMin = lead < 3 ? LEAD_MIN[lead] : Math.max(5, Math.min(240, parseInt(leadOwn, 10) || 30));
  const leadText = lead < 3 ? LEADS[lead] : `за ${leadMin} мин`;
  const resumeAt = (from: number) => hhmm(from - leadMin);
  const withResume = TOMORROW.filter(([, , , k]) => meetKinds[k]);
  const nKinds = kinds.filter(Boolean).length + 1;   // + «Совет директоров» — редкое, но важное
  const projectRule = ["проект «очень важно»", "проект «важно» и выше", "проект «средне» и выше", "любой проект"][impMin];

  const s = SCREENS[i];
  let content: ReactNode;
  switch (i) {
    case 0: content = (<>
      {[["telegram", "Telegram", "приходят решения и сводки"], ["outlook-calendar", "Календарь Outlook", "для анализа встреч и свободных окон"]].map(([logo, t, sub]) => (
        <div key={t} className="onb-card onb-card--row">
          <img src={`./assets/logos/${logo}.svg`} width={32} height={32} alt="" />
          <span className="list-row__text"><span className="t-body-l">{t}</span><span className="t-body-m c-secondary">{sub}</span></span>
          <span className="status status--done-dark"><Icon name="check-circle" size={18} /></span>
        </div>
      ))}
      <div className="onb-card">
        <div className="onb-card--row">
          <img src="./assets/logos/outlook.svg" width={32} height={32} alt="" />
          <span className="list-row__text"><span className="t-body-l">Почта Outlook</span><span className="t-body-m c-secondary">читать почту; отвечаю от вашего имени только после подтверждения</span></span>
          {outlook && <span className="status status--done-dark onb-pop"><Icon name="check-circle" size={18} /></span>}
        </div>
        {outlook
          ? <div className="btn btn--secondary btn--s btn--fill is-static">Почта подключена</div>
          : <Button label="Войти в Microsoft" variant="secondary" size="s" fill onClick={() => { buzz("light"); setOutlook(true); }} />}
      </div>
      <VilarHint text={outlook ? "дела из писем соберу сам" : "без почты тоже можно — дела добавите вручную"} />
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
      {kindList.map((k, n) => "fixed" in k && k.fixed
        ? <FixedCard key={k.title} title={k.title} sub={k.sub} />
        : <ToggleCard key={k.title} title={k.title} sub={k.sub} on={kinds[n]} onChange={(v) => setKinds((a) => a.map((x, j) => (j === n ? v : x)))} />)}
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
      <Label>Всегда к вам</Label>
      {ALWAYS.map((r) => <FixedCard key={r.title} title={r.title} sub={r.sub} />)}
      <Label>Проекты</Label>
      <div className="onb-card"><span className="t-body-l">Вопросы по проекту</span><span className="t-body-m c-secondary">прихожу, если важность проекта</span><Chips items={IMPORTANCE} at={impMin} onPick={setImpMin} /></div>
      <Divider />
      <VilarMessage text={`Свод правил для вас: деньги и бюджеты, кадры, обязательства клиентам и письма руководству — всегда к вам, без вашего «да» ничего не отправляю. По проектам прихожу, если ${projectRule}.`} />
      <Button label="Сохранить правила" fill onClick={next} />
    </>); break;
    case 5: content = (<>
      <Label>За сколько до встречи прислать</Label>
      <Chips items={LEADS} at={lead} onPick={setLead} />
      {lead === 3 && <FloatField label="Минуты до встречи" inputMode="numeric" value={leadOwn} onChange={(v) => setLeadOwn(v.replace(/\D/g, "").slice(0, 3))} autoFocus />}
      <Label>Для каких встреч</Label>
      {MEET_KINDS.map((k, n) => <ToggleCard key={k.title} title={k.title} sub={k.sub} on={meetKinds[n]} onChange={(v) => setMeetKinds((a) => a.map((x, j) => (j === n ? v : x)))} />)}
      <Divider />
      <VilarMessage text={meetKinds[0]
        ? `Перед встречей с партнёром в 15:00 пришлю резюме в ${resumeAt(900)}: кто будет, что обещали в прошлый раз и какое решение от вас ждут.`
        : meetKinds.some(Boolean) ? `Резюме пришлю ${leadText} до начала: кто будет, что обещали в прошлый раз и какое решение от вас ждут.` : "Резюме перед встречами присылать не буду — включите хотя бы один вид встреч."} />
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
      <Label>Для всех проектов</Label>
      <div className="onb-card onb-card--gap12">
        {ACTIONS.map((t, a) => (
          <div key={t} className="onb-action"><span className="t-body-l">{t}</span><Chips items={MODES} at={allModes[a]} spread onPick={(v) => setMode(null, a, v)} /></div>
        ))}
      </div>
      <Label>Отдельно для проектов</Label>
      {AUTH_PROJECTS.map((p, k) => open === k ? (
        <div key={p} className="onb-card onb-card--gap12">
          <button type="button" className="onb-head onb-head--btn" onClick={() => { tick(); setOpen(null); }}><span className="t-body-l">{p}</span><Tag label={diffLabel(k)} /></button>
          {ACTIONS.map((t, a) => (
            <div key={t} className="onb-action"><span className="t-body-l">{t}{differs(k, a) ? " · не как для всех" : ""}</span><Chips items={MODES} at={modeOf(k, a)} spread onPick={(v) => setMode(k, a, v)} /></div>
          ))}
        </div>
      ) : (
        <button key={p} type="button" className="onb-opt" onClick={() => { tick(); setOpen(k); }}>
          <span className="list-row__text"><span className="t-body-l">{p}</span><span className="t-body-m c-secondary">{diffLabel(k)}</span></span>
          <Icon name="chevron-right" size={20} />
        </button>
      ))}
      <Divider />
      <VilarMessage text={authSummary} />
      <Button label="Сохранить правила" fill onClick={next} />
    </>); break;
    default: content = (<>
      <VilarMessage text={`Завтра ${TOMORROW.length} ${plural(TOMORROW.length, "встреча", "встречи", "встреч")}. ${withResume.length ? `Резюме пришлю к ${NUM[withResume.length] ?? withResume.length} — ${leadText} до начала.` : "Резюме не пришлю: все виды встреч выключены."}`} />
      <div className="onb-day">
        {TOMORROW.map(([from, to, title, k]) => (
          <div key={title} className="onb-slot">
            <span className="t-body-m">{hhmm(from)}–{hhmm(to)}</span>
            <span className="t-body-l onb-slot__what">{title}</span>
            {meetKinds[k] && <span className="t-caption-medium c-brand">резюме в {resumeAt(from)}</span>}
          </div>
        ))}
      </div>
      <div className="onb-actions">
        <Button label="Изменить время резюме" variant="secondary" fill onClick={() => { setBack(9); go(5); }} />
        <Button label="Начать" fill onClick={finish} />
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
