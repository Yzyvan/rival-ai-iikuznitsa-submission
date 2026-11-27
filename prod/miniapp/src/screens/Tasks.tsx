import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { columns as initialColumns, plural, type Task } from "../data/content";
import { Button, Icon, IconButton, TaskCard } from "../ui";
import { useNav } from "../nav";
import { buzz, tick } from "../haptics";
import { openNewTask } from "./NewTaskSheet";
import { taskSheet } from "../data/sheets";
import { activeCount, matches, setFilter, useFilter } from "../data/filters";

// В колонке задачи всегда отсортированы по сроку — перенесённая задача сама встаёт на своё место.
const MONTH: Record<string, number> = { ноя: 11, дек: 12 };
const dayKey = (d: string) => { const m = d.match(/(\d+)\s+(ноя|дек)/); return m ? MONTH[m[2]] * 100 + Number(m[1]) : 9999; };
const byDate = (a: Task, b: Task) => dayKey(a.date) - dayKey(b.date);

const LONG_PRESS_MS = 350;   // столько держать палец, чтобы поднять задачу
const MOVE_TOLERANCE = 8;    // сдвиг пальца до срабатывания — значит, человек листает, а не берёт задачу
const FLIP = 0.3;            // сдвинул поднятую задачу на 30% ширины колонки — лента переезжает к соседней

type Drag = { task: Task; from: number; x: number; y: number; dx: number; dy: number; w: number; over: number | null };

/** Таски: канбан. Колонки листаются по одной, с отсечкой («буп»). Задачу можно зажать и перенести в другую колонку. */
export function Tasks() {
  const nav = useNav();
  const [cols, setCols] = useState(() => initialColumns.map((c) => ({ ...c, tasks: [...c.tasks].sort(byDate) })));
  const [drag, setDrag] = useState<Drag | null>(null);
  // фильтр: что видно в колонках; перенос задачи работает с видимыми задачами
  const f = useFilter();
  const active = activeCount(f);
  const vis = (tasks: Task[]) => tasks.filter((t) => matches(t, f));
  const shown = cols.reduce((n, c) => n + vis(c.tasks).length, 0);
  const quick = [
    { label: "Сегодня", on: f.term === "today", toggle: () => setFilter({ term: f.term === "today" ? "any" : "today" }) },
    { label: "Эта неделя", on: f.term === "week", toggle: () => setFilter({ term: f.term === "week" ? "any" : "week" }) },
    { label: "Поручения", on: f.kind === "assign", toggle: () => setFilter({ kind: f.kind === "assign" ? "all" : "assign", project: null }) },
    ...(f.person ? [{ label: f.person.split(" ")[0], on: true, removable: true, toggle: () => setFilter({ person: null }) }] : []),
    ...(f.project ? [{ label: f.project, on: true, removable: true, toggle: () => setFilter({ project: null }) }] : []),
  ];
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const scroller = useRef<HTMLDivElement>(null);

  // Плавная перестановка (FLIP): после каждой отрисовки карточки, которые сдвинулись внутри колонки,
  // стартуют со старого места и доезжают до нового; новые — мягко проявляются. Позиции — относительно колонки,
  // поэтому горизонтальное листание ленты не анимируется.
  const flipPrev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const next = new Map<string, number>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const key = el.dataset.flip!, top = el.offsetTop;
      next.set(key, top);
      const was = flipPrev.current.get(key);
      if (was === undefined) {
        if (flipPrev.current.size && !key.endsWith(":drop")) el.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(0.25, 1, 0.5, 1)" });
        return;
      }
      const dy = was - top;
      if (Math.abs(dy) > 0.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 280, easing: "cubic-bezier(0.25, 1, 0.5, 1)" });
    });
    flipPrev.current = next;
  });
  const colRefs = useRef<(HTMLElement | null)[]>([]);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const current = useRef(0);
  const lastEdge = useRef(0);
  const anchorX = useRef<number | null>(null);   // откуда считаем сдвиг для перелистывания при переносе
  const flipTo = useRef<number | null>(null);    // куда уже листаем — лента может ещё ехать

  // колонка, чей центр ближе всего к центру экрана (крайние встают к краю, средние — по центру)
  const nearest = () => {
    const el = scroller.current;
    if (!el) return 0;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0, dist = Infinity;
    colRefs.current.forEach((c, i) => { if (c) { const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (d < dist) { dist = d; best = i; } } });
    return best;
  };
  const goTo = (i: number) => {
    const el = scroller.current, c = colRefs.current[Math.max(0, Math.min(cols.length - 1, i))];
    if (!el || !c) return;
    el.scrollTo({ left: c.offsetLeft + c.offsetWidth / 2 - el.clientWidth / 2, behavior: "smooth" });   // точное место доведёт прилипание
  };

  // отсечка при листании: как только лента встала на новую колонку — «буп»
  const onScroll = () => {
    const i = nearest();
    if (i !== current.current) { current.current = i; tick(); }
    // во время переноса лента едет под неподвижным пальцем — подсвечиваем колонку, которая теперь под ним
    const d = dragRef.current;
    if (d) {
      let over: number | null = null;
      colRefs.current.forEach((c, k) => { if (c) { const r = c.getBoundingClientRect(); if (d.x >= r.left && d.x <= r.right) over = k; } });
      if (over !== null && over !== d.over) setDrag({ ...d, over });
    }
  };

  // новая задача из шторки «Новая задача» — встаёт в свою колонку по сроку
  useEffect(() => {
    const add = (e: Event) => {
      const { column, task } = (e as CustomEvent<{ column: number; task: Task }>).detail;
      setCols((cs) => cs.map((c, i) => (i === column ? { ...c, tasks: [...c.tasks, task].sort(byDate) } : c)));
    };
    window.addEventListener("vilar:task", add);
    return () => window.removeEventListener("vilar:task", add);
  }, []);

  /* ── перетаскивание ── */
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };

  const startPress = (e: React.PointerEvent, task: Task, from: number) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const x = e.clientX, y = e.clientY;
    cancelPress();
    press.current = {
      x, y,
      timer: window.setTimeout(() => {
        press.current = null;
        const r = el.getBoundingClientRect();
        setDrag({ task, from, x, y, dx: x - r.left, dy: y - r.top, w: r.width, over: from });
        anchorX.current = x;   // сдвиг для перелистывания считаем от точки, где взяли задачу
        suppressClick.current = true;
        buzz("medium");
      }, LONG_PRESS_MS),
    };
  };
  const movePress = (e: React.PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) cancelPress();
  };

  const dragging = !!drag;
  useEffect(() => { if (!dragging) { anchorX.current = null; flipTo.current = null; } }, [dragging]);   // новая задача — новая точка отсчёта

  useEffect(() => {
    if (!drag) return;
    const move = (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      let over: number | null = null;
      colRefs.current.forEach((c, i) => { if (c) { const r = c.getBoundingClientRect(); if (x >= r.left && x <= r.right) over = i; } });
      if (over !== d.over && over !== null) tick();
      setDrag({ ...d, x, y, over });
      // сдвиг на 30% ширины колонки от точки, где взяли задачу (или от прошлого перелистывания) — листаем
      const colW = colRefs.current[current.current]?.getBoundingClientRect().width ?? scroller.current?.clientWidth ?? 0;
      const now = performance.now();
      const target = flipTo.current ?? current.current;
      if (over !== null && over !== target && now - lastEdge.current > 350) {
        // палец уже над соседней колонкой (там появилась полоска вставки) — ставим её по центру
        lastEdge.current = now; anchorX.current = x; flipTo.current = over; goTo(over);
      } else if (colW && now - lastEdge.current > 350) {
        const shift = x - (anchorX.current ?? x);
        const dir = shift > colW * FLIP ? 1 : shift < -colW * FLIP ? -1 : 0;
        if (dir) {
          const to = Math.max(0, Math.min(cols.length - 1, (flipTo.current ?? current.current) + dir));
          lastEdge.current = now; anchorX.current = x; flipTo.current = to; goTo(to);
        }
      }
    };
    const drop = () => {
      const d0 = dragRef.current;
      // лента могла доехать уже после последнего движения пальца — колонку под пальцем считаем заново
      let under: number | null = d0?.over ?? null;
      if (d0) colRefs.current.forEach((c, i) => { if (c) { const r = c.getBoundingClientRect(); if (d0.x >= r.left && d0.x <= r.right) under = i; } });
      const d = d0 && { ...d0, over: under };
      if (d && d.over !== null && d.over !== d.from) {
        const to = d.over;
        setCols((cs) => cs.map((c, i) => {
          if (i === d.from) return { ...c, tasks: c.tasks.filter((t) => t !== d.task) };
          if (i === to) return { ...c, tasks: [...c.tasks, d.task].sort(byDate) };
          return c;
        }));
      }
      buzz("light");
      setDrag(null);
      setTimeout(() => { suppressClick.current = false; }, 50);
    };
    const onPointerMove = (e: PointerEvent) => { if (e.pointerType !== "touch") move(e.clientX, e.clientY); };
    const onTouchMove = (e: TouchEvent) => { e.preventDefault(); const t = e.touches[0]; if (t) move(t.clientX, t.clientY); };
    const onUp = () => drop();
    const onTouchCancel = () => { setDrag(null); suppressClick.current = false; };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("touchmove", onTouchMove, { passive: false });   // пока задача в руке — страница не листается
    window.addEventListener("pointerup", onUp);
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onTouchCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  return (
    <div className="screen">
      <div className="scroll">
        <header className="header">
          <span className="header__title t-body-l">{active ? `Найдено: ${plural(shown)}` : "Все задачи"}</span>
          <span className="flt-btn">
            <IconButton icon="settings-sliders" label="Фильтр" onClick={() => nav("sheet:filter")} />
            {active > 0 && <span className="flt-badge t-caption-medium">{active}</span>}
          </span>
        </header>
        <div className="flt-quick">
          {quick.map((q) => (
            <button key={q.label} type="button" className={`nt-chip t-body-m-medium${q.on ? " is-on" : ""}`} onClick={() => { tick(); q.toggle(); }}>
              {q.label}{"removable" in q && q.removable && <Icon name="close" size={16} />}
            </button>
          ))}
        </div>
        <div ref={scroller} className={`hscroll kanban pad-for-bar${drag ? " is-dragging" : ""}`} style={{ paddingTop: 16 }} onScroll={onScroll}>
          <div className="columns" style={{ width: "max-content" }}>
            {cols.map((c, ci) => {
              // куда встанет задача: место по сроку среди остальных задач колонки
              const others = drag ? vis(c.tasks).filter((t) => t !== drag.task) : vis(c.tasks);
              const slot = drag && drag.over === ci ? (() => { const i = others.findIndex((t) => byDate(drag.task, t) < 0); return i < 0 ? others.length : i; })() : -1;
              let k = 0;
              return (
                <section key={c.title} ref={(el) => (colRefs.current[ci] = el)} className={`column${drag && drag.over === ci ? " is-over" : ""}`}
                         style={{ ["--glow" as string]: c.glow, ["--glow-dot" as string]: c.dot }}>
                  <div className="column__glow" />
                  <div className="column__head">
                    <div className="row" style={{ gap: 8 }}><span className="column__dot" /><span className="t-title-s">{c.title}</span></div>
                    <span className="t-body-m c-secondary">{plural(vis(c.tasks).length)}</span>
                  </div>
                  <Button label="Добавить" variant="secondary" size="s" fill icon="plus" onClick={() => { openNewTask(ci); nav("sheet:newtask"); }} />
                  {vis(c.tasks).map((t) => {
                    const ghost = drag?.task === t;
                    const line = !ghost && slot === k ? <span key="drop" data-flip={`${ci}:drop`} className="drop-line" /> : null;
                    if (!ghost) k++;
                    return [
                      line,
                      <div key={t.title} data-flip={`${ci}:${t.title}`} className={`task-slot${ghost ? " is-ghost" : ""}`}
                           onPointerDown={(e) => startPress(e, t, ci)} onPointerMove={movePress} onPointerUp={cancelPress} onPointerCancel={cancelPress}
                           onContextMenu={(e) => e.preventDefault()}>
                        <TaskCard date={t.date} title={t.title} assignee={t.assignee} onClick={() => { if (!suppressClick.current) nav(t.open ?? taskSheet(t, c.title)); }} />
                      </div>,
                    ];
                  })}
                  {slot === others.length && <span data-flip={`${ci}:drop`} className="drop-line" />}
                </section>
              );
            })}
          </div>
        </div>
      </div>
      {drag && createPortal(
        <div className="drag-float" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          <div className="drag-float__card"><TaskCard date={drag.task.date} title={drag.task.title} assignee={drag.task.assignee} /></div>
        </div>,
        document.body,
      )}
    </div>
  );
}
