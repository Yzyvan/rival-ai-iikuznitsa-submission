// Компоненты дизайн-системы Vilar. Имена и свойства повторяют компоненты в Figma.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, Mark, Wordmark, type IconName } from "./Icon";
import { buzz, buzzSent, tick, whoop } from "../haptics";

export { Icon, Mark, Wordmark };
export type { IconName };

/* ── Button ── */
type ButtonProps = { label: string; disabled?: boolean; variant?: "primary" | "secondary" | "ghost"; size?: "m" | "s"; fill?: boolean; icon?: IconName; onClick?: () => void };
export function Button({ label, variant = "primary", size = "m", fill, icon, disabled, onClick }: ButtonProps) {
  return (
    <button type="button" disabled={disabled} className={`btn btn--${variant}${size === "s" ? " btn--s" : ""}${fill ? " btn--fill" : ""}`} onClick={onClick}>
      {label}
      {icon && <Icon name={icon} size={size === "s" ? 16 : 20} />}
    </button>
  );
}

/* ── Icon Button ── */
export function IconButton({ icon, size = 44, label, onClick }: { icon: IconName | string; size?: 44 | 36; label: string; onClick?: () => void }) {
  return (
    <button type="button" className={`icon-btn${size === 36 ? " icon-btn--36" : ""}`} aria-label={label} onClick={onClick}>
      <Icon name={icon} size={size === 36 ? 20 : 24} />
    </button>
  );
}

/* ── Avatar / AI Avatar ── */
// цвет аватара — из палитры дизайн-системы, постоянный для человека (по инициалам)
const avatarTones = ["crimson", "rose", "pink", "yellow", "green"] as const;
export const toneOf = (initials: string) => avatarTones[[...initials].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % avatarTones.length];
export function Avatar({ initials, size = 44, onClick }: { initials: string; size?: 44 | 28; onClick?: () => void }) {
  const cls = `avatar avatar--${toneOf(initials)} ${size === 28 ? "avatar--28 t-caption-medium" : "t-body-m-medium"}`;
  return onClick ? <button type="button" className={cls} onClick={onClick} aria-label="Профиль">{initials}</button> : <span className={cls}>{initials}</span>;
}
export function AIAvatar() {
  // аватар Vilar — картинка от Антона (design: знак на красном), уменьшена до 128×128
  return <img className="ai-avatar" src="./assets/vilar-avatar.jpg" width={32} height={32} alt="" aria-hidden="true" />;
}

/* ── Status: пять типов, две насыщенности ── */
export type StatusType = "Решение" | "Проблема" | "Внимание" | "Готово" | "Нейтрально";
export type StatusTone = "Яркая" | "Темная";
export type StatusSpec = [label: string, type: StatusType, tone: StatusTone];
const statusClass: Record<StatusType, string> = { "Решение": "decision", "Проблема": "problem", "Внимание": "attention", "Готово": "done", "Нейтрально": "neutral" };
export function Status({ label, type, tone, icon }: { label: string; type: StatusType; tone: StatusTone; icon?: IconName }) {
  // в системе есть только эти сочетания: у «Решения» — яркая, у «Проблемы» и «Нейтрально» — тёмная
  const t = type === "Решение" ? "bright" : type === "Проблема" || type === "Нейтрально" ? "dark" : tone === "Яркая" ? "bright" : "dark";
  return <span className={`status status--${statusClass[type]}-${t} t-body-m-medium`}>{label}{icon && <Icon name={icon} size={18} />}</span>;
}

/* ── Tag ── */
export function Tag({ label }: { label: string }) {
  return <span className="tag t-caption-medium">{label}</span>;
}
export function Tags({ items }: { items: string[] }) {
  return <div className="tags">{items.map((t) => <Tag key={t} label={t} />)}</div>;
}

/* ── Load Badge ── */
export function LoadBadge({ count }: { count: number | string }) {
  return <span className="load-badge t-caption-medium">{count}</span>;
}

/* ── Подпись Vilar: знак продукта и текст одним бегущим красным градиентом.
      Используется везде, где говорит сам Vilar: «Vilar решил сам», подсказки («ведёт договор с клиентом») и т. п. ── */
export function VilarInk({ children, className = "t-body-m", top }: { children: ReactNode; className?: string; top?: boolean }) {
  return (
    <span className={`vilar-ink${top ? " vilar-ink--top" : ""}`}>
      <span className="vilar-ink__mark" aria-hidden="true" />
      <span className={`vilar-ink__text ${className}`}>{children}</span>
    </span>
  );
}
/** Подсказка Vilar (компонент Vilar Hint): короткая причина, почему он предложил именно это */
export function VilarHint({ text }: { text: string }) {
  return <VilarInk top>{text}</VilarInk>;
}

/* ── Section: контейнер списка с заголовком ── */
export function Section({ title, vilar, children }: { title: string; vilar?: boolean; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-caption">
        {vilar ? <VilarInk className="t-overline">{title}</VilarInk> : <span className="t-overline">{title}</span>}
      </div>
      {children}
    </section>
  );
}

/* ── List Row ── */
type ListRowProps = { title: string; subtitle?: string; status?: StatusSpec; value?: string; valueSub?: string; urgent?: boolean; leading?: ReactNode; onClick?: () => void };
export function ListRow({ title, subtitle, status, value, valueSub, urgent, leading, onClick }: ListRowProps) {
  const row = (
    <span className="list-row">
      {leading && <span className="list-row__leading">{leading}</span>}
      <span className="list-row__text">
        <span className="t-body-l">{title}</span>
        {subtitle && <Tags items={subtitle.split(" · ")} />}
      </span>
      {value && (
        <span className="list-row__trailing">
          <span className="t-body-m-medium">{value}</span>
          {valueSub && <span className="t-caption c-tertiary">{valueSub}</span>}
        </span>
      )}
      {status && <Status label={status[0]} type={status[1]} tone={status[2]} />}
    </span>
  );
  // строка без действия — не кнопка: не реагирует на нажатие и не притворяется кликабельной
  if (!onClick) return <div className={urgent ? "list-row-urgent" : ""} style={urgent ? undefined : { display: "block", width: "100%" }}>{row}</div>;
  // «требует решения» — тот же ряд на тёмной подложке, с охранными полями сверху и снизу
  return <button type="button" className={urgent ? "list-row-urgent" : ""} style={urgent ? undefined : { display: "block", width: "100%" }} onClick={onClick}>{row}</button>;
}

/* ── Task Card ── */
export function TaskCard({ date, title, assignee, onClick }: { date: string; title: string; assignee: string; onClick?: () => void }) {
  const initials = assignee.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <button type="button" className="task-card" onClick={onClick}>
      <span className="row c-secondary" style={{ gap: 4 }}><Icon name="calendar" size={16} /><span className="t-caption">{date}</span></span>
      <span className="t-body-l">{title}</span>
      <span className="row" style={{ gap: 8 }}><Avatar initials={initials} size={28} /><span className="t-body-m c-secondary">{assignee}</span></span>
    </button>
  );
}

/* ── Stat Tile ── */
const glow = { "Хорошо": "#3deb8c", "Внимание": "#eee65a", "Плохо": "#b50028" } as const;
export function StatTile({ label, value, caption, icon, level }: { label: string; value: string; caption: string; icon: IconName; level: keyof typeof glow }) {
  return (
    <div className="stat-tile" style={{ ["--glow" as string]: glow[level] }}>
      <div className="stat-tile__content">
        <span className="row" style={{ gap: 8 }}><Icon name={icon} size={16} /><span className="t-caption-medium">{label}</span></span>
        <span className="t-numeric">{value}</span>
        <span className="t-caption c-secondary">{caption}</span>
      </div>
    </div>
  );
}

/* ── Едущая подложка: одна плашка под активным пунктом, переезжает при переключении.
      Пункты помечены data-slide; плашка меряет активный и встаёт под него. ── */
function useSlider(index: number) {
  const box = useRef<HTMLElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  const ready = useRef(false);
  useEffect(() => {   // первая расстановка — без анимации, дальше плашка едет
    const t = setTimeout(() => { ready.current = true; }, 60);
    return () => clearTimeout(t);
  }, []);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-slide]"));
    const measure = () => {
      const a = items[index];
      if (!a) return;
      setStyle({ width: a.offsetWidth, height: a.offsetHeight, top: a.offsetTop, transform: `translateX(${a.offsetLeft}px)`, transition: ready.current ? undefined : "none" });
    };
    measure();
    const ro = new ResizeObserver(measure);   // ширины пунктов меняются (активный шире) — перемеряем
    items.forEach((i) => ro.observe(i));
    return () => ro.disconnect();
  }, [index]);
  return { box, style };
}

/* ── Tab Bar + Bottom Fade ── */
export type TabId = "board" | "tasks" | "stats";
const tabs: { id: TabId; label: string; icon: IconName }[] = [
  { id: "board", label: "Доска", icon: "inbox" },
  { id: "tasks", label: "Таски", icon: "dashboard" },
  { id: "stats", label: "Статы", icon: "chart" },
];
export function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  const { box, style } = useSlider(tabs.findIndex((t) => t.id === active));
  return (
    <>
      <div className="bottom-fade" />
      <nav className="tab-bar" aria-label="Разделы" ref={box}>
        <span className="slider tab-bar__slider" style={style} aria-hidden="true" />
        {tabs.map((t) => (
          <button key={t.id} data-slide type="button" className={`tab-item t-body-m-medium${t.id === active ? " is-active" : ""}`} aria-current={t.id === active ? "page" : undefined} onClick={() => { if (t.id !== active) whoop(); onChange(t.id); }}>
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}

/* ── Сообщение Vilar: сводка в шторке — одним сообщением, как в чате Telegram: аватар Vilar слева, пузырь справа ── */
export function VilarMessage({ text }: { text: string }) {
  return (
    <div className="vilar-msg">
      <AIAvatar />
      <div className="vilar-msg__bubble">
        <span className="t-caption-medium c-brand">Vilar</span>
        <p className="t-body-l">{text}</p>
      </div>
    </div>
  );
}

/* ── Draft Card: черновик, который уйдёт от имени пользователя. Карандаш — поправить текст перед отправкой ── */
/** onSave — правку нужно сохранить (живые данные); readOnly — без карандаша; empty — что написать, если текста ещё нет */
export function DraftCard({ caption, text, onSave, readOnly, empty }: { caption: string; text: string; onSave?: (text: string) => void; readOnly?: boolean; empty?: string }) {
  const [value, setValue] = useState(text);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const pressing = useRef(false);   // палец на галочке: блюр поля не должен закрывать правку раньше нажатия
  // поле растёт по высоте вместе с текстом
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);
  useEffect(() => {
    const el = input.current;
    if (editing && el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, [editing]);
  const finish = () => { setEditing(false); if (!value.trim()) setValue(text); else if (value.trim() !== text.trim()) onSave?.(value); };
  const toggle = () => { pressing.current = false; tick(); if (editing) finish(); else setEditing(true); };
  const edited = !editing && value.trim() !== text;
  return (
    <div className={`draft-card${editing ? " is-editing" : ""}`}>
      <div className="draft-card__head">
        <span className="row" style={{ gap: 8 }}>
          <span className="t-caption c-secondary">{caption}</span>
          {edited && <Tag label="изменено" />}
        </span>
        {!readOnly && <button type="button" className="draft-card__edit" aria-label={editing ? "Готово" : "Изменить текст"}
          onPointerDown={(e) => { pressing.current = true; e.preventDefault(); }} onPointerCancel={() => { pressing.current = false; }} onClick={toggle}>
          <Icon name={editing ? "check" : "edit"} size={24} />
        </button>}
      </div>
      {editing
        ? <textarea ref={input} className="draft-card__input t-body-l" rows={1} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => { if (!pressing.current) finish(); }} />
        : value ? <span className="t-body-l" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value}</span> : <span className="t-body-l c-secondary">{empty}</span>}
    </div>
  );
}

/* ── Toast ── */
export function Toast({ type, text }: { type: "Success" | "Error"; text: string }) {
  return (
    <div className={`toast toast--${type === "Success" ? "success" : "error"} t-body-m-medium`} role="status">
      <Icon name={type === "Success" ? "check-circle" : "close-circle"} size={20} />
      <span>{text}</span>
    </div>
  );
}

/* ── Toast Countdown: важное решение можно отменить за 2,25 секунды.
      Баранка белая, заполняется по кругу, внутри счёт 3 → 2 → 1 (по 0,75 с на цифру).
      Всё время отсчёта вибрация нарастает, в момент срабатывания — «ту-ту», как отправка сообщения. ── */
const STEP_MS = 750;
const STEPS = 3;
const UNDO_MS = STEP_MS * STEPS;
const RING_R = 10.5;
const RING_C = 2 * Math.PI * RING_R;
export function UndoToast({ text, onCommit, onCancel }: { text: string; onCommit: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(STEPS);
  const [out, setOut] = useState(false);
  const [cancelled, setCancelled] = useState(false);   // нажали крестик: баранка уходит, текст меняется, тост висит и только потом улетает
  const arc = useRef<SVGCircleElement>(null);
  const stopped = useRef(false);

  const leave = (then: () => void) => { stopped.current = true; setOut(true); setTimeout(then, 240); };

  useEffect(() => {
    stopped.current = false;   // в StrictMode эффект запускается повторно после очистки
    const start = performance.now();
    let raf = 0, lastBuzz = -Infinity;
    // баранка — на кадрах, плавно
    const frame = (now: number) => {
      if (stopped.current) return;
      const p = Math.min((now - start) / UNDO_MS, 1);
      arc.current?.setAttribute("stroke-dashoffset", String(RING_C * (1 - p)));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // счёт, вибрация и срабатывание — на таймере, чтобы не вставали, если кадры не рисуются
    const timer = setInterval(() => {
      if (stopped.current) return;
      const now = performance.now();
      const t = now - start;
      setLeft(Math.max(1, STEPS - Math.floor(t / STEP_MS)));
      if (t < UNDO_MS) {
        const k = t / UNDO_MS;                       // 0 → 1 за весь отсчёт
        const gap = 260 - 180 * k;                   // толчки всё чаще…
        if (now - lastBuzz >= gap) { lastBuzz = now; buzz(k < 0.34 ? "light" : k < 0.67 ? "medium" : "heavy"); }   // …и всё сильнее
      } else {
        clearInterval(timer);
        buzzSent();
        leave(onCommit);
      }
    }, 20);
    return () => { stopped.current = true; cancelAnimationFrame(raf); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const CANCEL_HOLD = 1400;
  const cancel = () => {
    if (stopped.current) return;
    stopped.current = true;   // отсчёт встаёт — действие на сервер не уйдёт
    setCancelled(true);
    buzz("light");
    setTimeout(() => leave(onCancel), CANCEL_HOLD);
  };

  return (
    <div className={`undo-toast${out ? " is-out" : ""}${cancelled ? " is-cancelled" : ""}`} role="status">
      <div className="undo-toast__body t-body-m-medium">
        <span className="undo-ring" aria-hidden={cancelled} aria-label={`Отмена ещё доступна: ${left}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r={RING_R} fill="none" stroke="currentColor" strokeWidth="3" opacity="0.12" />
            <circle ref={arc} cx="12" cy="12" r={RING_R} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
              strokeDasharray={RING_C} strokeDashoffset={RING_C} transform="rotate(-90 12 12)" />
          </svg>
          <span className="undo-ring__num t-caption-medium">{left}</span>
        </span>
        <span key={cancelled ? "c" : "t"} className="undo-toast__text">{cancelled ? "Действие отменено" : text}</span>
        <button type="button" className="undo-toast__cancel" aria-label="Отменить" tabIndex={cancelled ? -1 : 0} onClick={cancel}><Icon name="close" size={20} /></button>
      </div>
    </div>
  );
}

/* ── Шапка вложенного экрана: слева действие, по центру заголовок, справа действие или пусто ── */
export function ScreenHeader({ title, subtitle, left, right }: { title: string; subtitle?: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="header">
      {left ?? <span className="header__spacer" />}
      {subtitle
        ? <span className="header__title header__title--center header__title--stack"><span className="t-body-l">{title}</span><span className="t-caption-medium c-tertiary">{subtitle}</span></span>
        : <span className="header__title header__title--center t-body-l">{title}</span>}
      {right ?? <span className="header__spacer" />}
    </header>
  );
}

/* ── Нижняя панель с кнопками: закреплена, под ней градиент к чёрному ── */
export function ActionBar({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <>
      <div className="bottom-fade bottom-fade--tall" />
      <div className="action-bar">
        {caption && (caption.includes(" · ") ? <Tags items={caption.split(" · ")} /> : <span className="t-caption c-secondary">{caption}</span>)}
        <div className="action-bar__row">{children}</div>
      </div>
    </>
  );
}

/* ── Toggle и Toggle Row ── */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? " is-on" : ""}`} onClick={() => onChange(!on)}><span className="toggle__knob" /></button>;
}
export function ToggleRow({ title, subtitle, defaultOn = true }: { title: string; subtitle?: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="toggle-row">
      <div className="list-row__text">
        <span className="t-body-l">{title}</span>
        {subtitle && <span className="t-body-m c-secondary">{subtitle}</span>}
      </div>
      <Toggle on={on} onChange={setOn} label={title} />
    </div>
  );
}

/* ── Segmented: переключатель из трёх вариантов ── */
export function Segmented({ options, defaultIndex = 0, index, onChange }: { options: string[]; defaultIndex?: number; index?: number; onChange?: (i: number) => void }) {
  const [own, setOwn] = useState(defaultIndex);
  const i = index ?? own;   // можно управлять снаружи (index + onChange)
  const setI = (k: number) => { if (onChange) onChange(k); else setOwn(k); };
  const { box, style } = useSlider(i);
  return (
    <div className="segmented" role="tablist" ref={box as React.RefObject<HTMLDivElement>}>
      <span className="slider segmented__slider" style={style} aria-hidden="true" />
      {options.map((o, k) => <button key={o} data-slide type="button" role="tab" aria-selected={k === i} className={`segmented__option t-body-m-medium${k === i ? " is-on" : ""}`} onClick={() => { if (k !== i) whoop(); setI(k); }}>{o}</button>)}
    </div>
  );
}

/* ── Person Chip ── */
export function PersonChip({ name, initials, onClick }: { name: string; initials?: string; onClick?: () => void }) {
  return (
    <button type="button" className="person-chip" onClick={onClick}>
      {initials ? <Avatar initials={initials} size={28} /> : <span className="person-chip__plus"><Icon name="plus" size={16} /></span>}
      <span className="t-body-m-medium">{name}</span>
    </button>
  );
}

/* ── Input (состояние Default: поле с текстом) ── */
export function Field({ value }: { value: string }) {
  return <div className="field t-body-m c-secondary">{value}</div>;
}

/* ── Insight Card ── */
export function InsightCard({ title, body, action, icon = "warning-triangle", onAction }: { title: string; body: string; action: string; icon?: IconName; onAction?: () => void }) {
  return (
    <div className="insight">
      <div className="insight__content">
        <Icon name={icon} size={60} />
        <span className="t-title-m">{title}</span>
        <span className="t-body-l c-secondary">{body}</span>
        <Button label={action} variant="secondary" fill onClick={onAction} />
      </div>
    </div>
  );
}
